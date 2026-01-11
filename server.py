#!/usr/bin/env python3
import base64
import copy
import email.message
import email.utils
import json
import mimetypes
import os
import smtplib
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB_ROOT = os.path.join(os.path.dirname(__file__), "web")
RETENTION_SECONDS = 48 * 60 * 60
DEFAULT_MONITOR_INTERVAL = 180
MIN_MONITOR_INTERVAL = 10
OLLAMA_RESPONSES = []
SESSIONS = {}
ACTIVE_SESSION = {"token": None}
SESSION_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
RESPONSE_LOCK = threading.Lock()
SERVER_STATE = {"armed": False, "armed_at": 0, "armed_by": "", "config": {}}
MONITOR_STATE = {
    "running": False,
    "last_run": 0,
    "last_success": 0,
    "last_error": "",
    "last_error_at": 0,
    "consecutive_timeouts": 0,
}
MONITOR_LOCK = threading.Lock()
MONITOR_STOP = threading.Event()
MONITOR_THREAD = None
PULL_STATE = {
    "in_progress": False,
    "status": "Idle.",
    "completed": 0,
    "total": 0,
    "model": "",
    "host": "",
    "port": 0,
    "error": "",
    "started_at": 0,
}
PULL_LOCK = threading.Lock()
PULL_CANCEL = False
PULL_RESPONSE = None


def _json_response(handler, payload, status=200):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    try:
        handler.wfile.write(data)
    except BrokenPipeError:
        if hasattr(handler, "_log_broken_pipe"):
            handler._log_broken_pipe()
        return None


def _prune_responses_locked():
    cutoff = time.time() - RETENTION_SECONDS
    OLLAMA_RESPONSES[:] = [
        item for item in OLLAMA_RESPONSES if item.get("timestamp", 0) >= cutoff
    ]


def prune_responses():
    with RESPONSE_LOCK:
        _prune_responses_locked()


def store_response(entry):
    with RESPONSE_LOCK:
        _prune_responses_locked()
        OLLAMA_RESPONSES.insert(0, entry)


def get_responses_snapshot():
    with RESPONSE_LOCK:
        _prune_responses_locked()
        return list(OLLAMA_RESPONSES)


def extract_mjpeg_frame(response):
    buffer = b""
    max_bytes = 1024 * 1024
    while len(buffer) < max_bytes:
        chunk = response.read(4096)
        if not chunk:
            break
        buffer += chunk
        start = buffer.find(b"\xff\xd8")
        if start == -1:
            continue
        end = buffer.find(b"\xff\xd9", start + 2)
        if end == -1:
            continue
        return buffer[start : end + 2]
    raise RuntimeError("Failed to extract MJPEG frame")


def fetch_preview_image(url):
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=5) as response:
        content_type = (response.headers.get("Content-Type", "") or "").lower()
        if content_type.startswith("image/"):
            return response.read()
        if "multipart" in content_type or "mjpeg" in content_type:
            return extract_mjpeg_frame(response)
        raise RuntimeError(f"Unsupported content type: {content_type or 'unknown'}")


def capture_rtsp_jpeg(rtsp_url):
    try:
        import cv2  # type: ignore
    except Exception:
        raise RuntimeError("opencv-python is not installed")

    cap = cv2.VideoCapture(rtsp_url)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, frame = cap.read()
        if not ok or frame is None:
            return None
        ok, jpeg = cv2.imencode(".jpg", frame)
        if not ok:
            raise RuntimeError("Failed to encode JPEG")
        return jpeg.tobytes()
    finally:
        cap.release()


def ollama_analyze_payload(payload):
    host = str(payload.get("host", "")).strip()
    port = payload.get("port")
    model = str(payload.get("model", "")).strip()
    prompt = str(payload.get("prompt", "")).strip()
    trigger = str(payload.get("trigger", "")).strip()
    preview_mode = str(payload.get("previewMode", "")).strip()
    timeout_seconds = payload.get("timeoutSeconds")
    stream_url = str(payload.get("streamUrl", "")).strip()
    preview_url = str(payload.get("previewUrl", "")).strip()
    camera_id = str(payload.get("cameraId", "")).strip()
    camera_name = str(payload.get("cameraName", "")).strip()
    camera_model = str(payload.get("cameraModel", "")).strip()

    if not host or not model or not prompt:
        return {"ok": False, "error": "Missing host, model, or prompt"}, 400
    try:
        port_num = int(port)
    except Exception:
        return {"ok": False, "error": "Invalid port"}, 400

    image_bytes = None
    try:
        if preview_mode == "rtsp" and stream_url.startswith("rtsp://"):
            image_bytes = capture_rtsp_jpeg(stream_url)
        elif preview_url:
            image_bytes = fetch_preview_image(preview_url)
    except Exception as exc:  # pylint: disable=broad-except
        return {"ok": False, "error": str(exc)}, 502

    if not image_bytes:
        return {"ok": False, "error": "No preview image available"}, 400

    try:
        timeout_seconds = float(timeout_seconds)
    except Exception:
        timeout_seconds = 60
    if timeout_seconds <= 0:
        timeout_seconds = 60

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    ollama_payload = {
        "model": model,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
    }

    url = f"http://{host}:{port_num}/api/generate"
    try:
        print(
            (
                "Ollama analyze start: "
                f"model={model} host={host} port={port_num} "
                f"timeout={timeout_seconds}s images=1 bytes={len(image_bytes)}"
            ),
            file=sys.stderr,
        )
        started_at = time.time()
        request = urllib.request.Request(
            url,
            data=json.dumps(ollama_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
            response_payload = json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")
        except Exception:  # pylint: disable=broad-except
            detail = ""
        message = f"HTTP {exc.code}: {exc.reason}"
        if detail:
            message = f"{message} ({detail})"
        print(f"Ollama analyze failed: {message}", file=sys.stderr)
        return {"ok": False, "error": message}, 502
    except Exception as exc:  # pylint: disable=broad-except
        message = str(exc)
        print(f"Ollama analyze failed: {message}", file=sys.stderr)
        return {"ok": False, "error": message}, 502

    duration = time.time() - started_at
    text = str(response_payload.get("response", "")).strip()
    triggered = False
    if trigger:
        triggered = trigger.lower() in text.lower()
    print(
        (
            "Ollama analyze complete: "
            f"model={model} triggered={triggered} chars={len(text)} "
            f"duration={duration:.1f}s"
        ),
        file=sys.stderr,
    )

    entry = {
        "timestamp": time.time(),
        "text": text,
        "model": model,
        "triggered": triggered,
        "camera_id": camera_id,
        "camera_name": camera_name,
        "camera_model": camera_model,
    }
    store_response(entry)
    return (
        {
            "ok": True,
            "response": text,
            "triggered": triggered,
            "image": image_b64,
            "image_type": "image/jpeg",
            "camera_id": camera_id,
            "camera_name": camera_name,
            "camera_model": camera_model,
        },
        200,
    )


def send_email_alert_payload(payload):
    smtp_user = str(payload.get("smtp_user", "")).strip()
    smtp_password = str(payload.get("smtp_password", "")).strip()
    sender_email = str(payload.get("sender_email", "")).strip() or smtp_user
    sender_name = str(payload.get("sender_name", "")).strip()
    recipients = payload.get("recipients")
    subject = str(payload.get("subject", "")).strip() or "Fall Detector Alert"
    body = str(payload.get("body", "")).strip()
    image_b64 = payload.get("image_b64")
    image_type = str(payload.get("image_type", "")).strip() or "image/jpeg"

    if not smtp_user or not smtp_password:
        return {"ok": False, "error": "Missing Gmail credentials"}, 400
    if not sender_email:
        return {"ok": False, "error": "Missing sender email"}, 400
    if not isinstance(recipients, list) or not recipients:
        return {"ok": False, "error": "Missing recipients"}, 400

    message = email.message.EmailMessage()
    from_name = sender_name if sender_name else sender_email
    message["From"] = f"{from_name} <{sender_email}>"
    message["To"] = ", ".join([str(item) for item in recipients])
    message["Subject"] = subject
    text_body = body or "Fall Detector alert triggered."
    message.set_content(text_body)
    if image_b64:
        try:
            image_bytes = base64.b64decode(image_b64)
        except Exception:  # pylint: disable=broad-except
            return {"ok": False, "error": "Invalid image data"}, 400
        if "/" in image_type:
            maintype, subtype = image_type.split("/", 1)
        else:
            maintype, subtype = ("image", "jpeg")
        image_cid = email.utils.make_msgid(domain="falldetector.local")
        html_body = (
            "<html><body>"
            f"<p>{text_body}</p>"
            f"<p><img src='cid:{image_cid[1:-1]}' "
            "style='max-width: 100%; height: auto;' alt='Alert image' /></p>"
            "</body></html>"
        )
        message.add_alternative(html_body, subtype="html")
        html_part = message.get_body(preferencelist=("html",))
        if html_part is None:
            return {"ok": False, "error": "Failed to build HTML email"}, 500
        html_part.add_related(
            image_bytes,
            maintype=maintype,
            subtype=subtype,
            cid=image_cid,
            filename="alert-image.jpg",
        )

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(smtp_user, smtp_password)
            server.send_message(message)
        return {"ok": True, "message": "Email sent."}, 200
    except smtplib.SMTPException as exc:
        message = str(exc)
        print(f"Gmail send failed: {message}", file=sys.stderr)
        return {"ok": False, "error": message}, 502
    except Exception as exc:  # pylint: disable=broad-except
        message = str(exc)
        print(f"Gmail send failed: {message}", file=sys.stderr)
        return {"ok": False, "error": message}, 502


def _get_monitor_cameras(config):
    cameras = config.get("cameras")
    if isinstance(cameras, list) and cameras:
        if config.get("monitorAllCameras"):
            return [camera for camera in cameras if isinstance(camera, dict)]
        active_id = config.get("activeCameraId")
        if active_id:
            for camera in cameras:
                if isinstance(camera, dict) and camera.get("id") == active_id:
                    return [camera]
        for camera in cameras:
            if isinstance(camera, dict):
                return [camera]
        return []
    camera = config.get("camera")
    if isinstance(camera, dict):
        return [camera]
    return []


def _get_ollama_settings(config):
    ollama = config.get("ollama")
    if not isinstance(ollama, dict):
        return None, "Missing Ollama settings."
    host = str(ollama.get("host", "")).strip()
    model = str(ollama.get("model", "")).strip()
    prompt = str(ollama.get("prompt", "")).strip()
    trigger = str(ollama.get("trigger", "")).strip()
    if not host or not model or not prompt:
        return None, "Missing Ollama host, model, or prompt."
    try:
        port = int(ollama.get("port"))
    except Exception:
        return None, "Invalid Ollama port."
    return (
        {
            "host": host,
            "port": port,
            "model": model,
            "prompt": prompt,
            "trigger": trigger,
            "timeoutSeconds": ollama.get("timeoutSeconds"),
        },
        "",
    )


def _get_monitor_interval_seconds(config):
    interval = None
    ollama = config.get("ollama") if isinstance(config.get("ollama"), dict) else {}
    interval = ollama.get("intervalSeconds")
    if interval is None:
        interval = ollama.get("timeoutSeconds")
    try:
        interval_value = float(interval)
    except Exception:
        interval_value = float(DEFAULT_MONITOR_INTERVAL)
    if interval_value < MIN_MONITOR_INTERVAL:
        interval_value = float(MIN_MONITOR_INTERVAL)
    return interval_value


def _get_email_recipients(config):
    recipients = []
    for responder in config.get("responders") or []:
        if isinstance(responder, dict):
            email_addr = str(responder.get("email", "")).strip()
            if email_addr:
                recipients.append(email_addr)
    return recipients


def _build_alert_body(context):
    event = context.get("event") or "alert"
    response_text = context.get("response_text", "")
    camera_name = context.get("camera_name") or "Camera"
    camera_model = context.get("camera_model") or "Unknown model"
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    lines = [
        f"Event: {event}",
        f"Time: {timestamp}",
        f"Camera: {camera_name} ({camera_model})",
    ]
    if response_text:
        lines.extend(["", "Inference:", response_text])
    return "\n".join(lines)


def _build_email_payload(config, context):
    alerts = config.get("alerts")
    if not isinstance(alerts, dict):
        return None, "Missing alert settings."
    if not alerts.get("emailEnabled"):
        return None, "Email alerts disabled."
    smtp_user = str(alerts.get("gmailUser", "")).strip()
    smtp_password = str(alerts.get("gmailAppPassword", "")).strip()
    sender_email = str(alerts.get("senderEmail", "")).strip() or smtp_user
    sender_name = str(alerts.get("gmailSenderName", "")).strip()
    recipients = _get_email_recipients(config)
    if not smtp_user or not smtp_password:
        return None, "Missing Gmail credentials."
    if not sender_email:
        return None, "Missing sender email."
    if not recipients:
        return None, "No responder emails configured."
    subject = context.get("subject") or "Fall Detector Alert"
    body = _build_alert_body(context)
    return (
        {
            "smtp_user": smtp_user,
            "smtp_password": smtp_password,
            "sender_email": sender_email,
            "sender_name": sender_name,
            "recipients": recipients,
            "subject": subject,
            "body": body,
            "image_b64": context.get("image_b64") or "",
            "image_type": context.get("image_type") or "",
        },
        "",
    )


def _update_monitor_state(**updates):
    with MONITOR_LOCK:
        MONITOR_STATE.update(updates)


def _run_monitor_cycle(config):
    settings, error = _get_ollama_settings(config)
    if not settings:
        _update_monitor_state(last_error=error, last_error_at=time.time())
        print(f"Monitoring skipped: {error}", file=sys.stderr)
        return
    cameras = _get_monitor_cameras(config)
    if not cameras:
        error = "No cameras configured."
        _update_monitor_state(last_error=error, last_error_at=time.time())
        print(f"Monitoring skipped: {error}", file=sys.stderr)
        return

    had_success = False
    had_timeout = False
    for camera in cameras:
        payload = {
            "host": settings["host"],
            "port": settings["port"],
            "model": settings["model"],
            "prompt": settings["prompt"],
            "trigger": settings["trigger"],
            "timeoutSeconds": settings["timeoutSeconds"],
            "streamUrl": camera.get("streamUrl", ""),
            "previewUrl": camera.get("previewUrl", ""),
            "previewMode": camera.get("previewMode", "mjpeg"),
            "cameraId": camera.get("id", ""),
            "cameraName": camera.get("name", ""),
            "cameraModel": camera.get("model", ""),
        }
        result, _status = ollama_analyze_payload(payload)
        if result.get("ok"):
            had_success = True
            if result.get("triggered"):
                email_payload, email_error = _build_email_payload(
                    config,
                    {
                        "event": "fall_detected",
                        "subject": "Fall Detector Alert",
                        "response_text": result.get("response", ""),
                        "image_b64": result.get("image", ""),
                        "image_type": result.get("image_type", ""),
                        "camera_name": camera.get("name", ""),
                        "camera_model": camera.get("model", ""),
                    },
                )
                if email_payload:
                    send_email_alert_payload(email_payload)
                elif email_error and email_error != "Email alerts disabled.":
                    print(f"Email alert skipped: {email_error}", file=sys.stderr)
        else:
            message = str(result.get("error", "")).lower()
            if "timed out" in message or "timeout" in message:
                had_timeout = True

    now = time.time()
    _update_monitor_state(last_run=now)
    with MONITOR_LOCK:
        if had_timeout:
            MONITOR_STATE["consecutive_timeouts"] += 1
        elif had_success:
            MONITOR_STATE["consecutive_timeouts"] = 0
        if had_success:
            MONITOR_STATE["last_success"] = now

        if MONITOR_STATE["consecutive_timeouts"] >= 3:
            error = "Monitoring paused after repeated timeouts."
            MONITOR_STATE["last_error"] = error
            MONITOR_STATE["last_error_at"] = now
            with STATE_LOCK:
                SERVER_STATE["armed"] = False
                SERVER_STATE["armed_at"] = 0
                SERVER_STATE["armed_by"] = ""
            print(error, file=sys.stderr)


def _monitor_loop():
    next_run = 0
    while not MONITOR_STOP.is_set():
        with STATE_LOCK:
            armed = SERVER_STATE["armed"]
            config = copy.deepcopy(SERVER_STATE.get("config") or {})
        if not armed:
            _update_monitor_state(running=False)
            time.sleep(0.5)
            continue
        _update_monitor_state(running=True)
        interval_seconds = _get_monitor_interval_seconds(config)
        now = time.time()
        if now < next_run:
            time.sleep(min(0.5, next_run - now))
            continue
        try:
            _run_monitor_cycle(config)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            _update_monitor_state(last_error=message, last_error_at=time.time())
            print(f"Monitoring error: {message}", file=sys.stderr)
        next_run = time.time() + interval_seconds


def start_monitor_thread():
    global MONITOR_THREAD
    with MONITOR_LOCK:
        if MONITOR_THREAD and MONITOR_THREAD.is_alive():
            return
        MONITOR_STOP.clear()
        MONITOR_THREAD = threading.Thread(target=_monitor_loop, daemon=True)
        MONITOR_THREAD.start()


def stop_monitor_thread():
    MONITOR_STOP.set()
    thread = None
    with MONITOR_LOCK:
        thread = MONITOR_THREAD
    if thread:
        thread.join(timeout=2)


class RequestHandler(SimpleHTTPRequestHandler):
    def _get_client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if hasattr(self, "client_address"):
            return self.client_address[0]
        return ""

    def _log_browser_details(self, name, action):
        ip_addr = self._get_client_ip()
        user_agent = self.headers.get("User-Agent", "")
        languages = self.headers.get("Accept-Language", "")
        sec_ch = self.headers.get("Sec-CH-UA", "")
        sec_platform = self.headers.get("Sec-CH-UA-Platform", "")
        origin = self.headers.get("Origin", "")
        referer = self.headers.get("Referer", "")
        details = [
            f"{action}: name={name}",
            f"ip={ip_addr}",
            f"ua={user_agent}",
        ]
        if languages:
            details.append(f"lang={languages}")
        if sec_ch:
            details.append(f"ch_ua={sec_ch}")
        if sec_platform:
            details.append(f"platform={sec_platform}")
        if origin:
            details.append(f"origin={origin}")
        if referer:
            details.append(f"referer={referer}")
        print(" ".join(details), file=sys.stderr)

    def _get_session_token(self):
        token = (self.headers.get("X-Session-Token") or "").strip()
        if token:
            return token
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        return (query.get("session") or [""])[0].strip()

    def _require_active_session(self):
        token = self._get_session_token()
        if not token:
            return _json_response(
                self, {"ok": False, "error": "Missing session token."}, 401
            )
        with SESSION_LOCK:
            active_token = ACTIVE_SESSION["token"]
            if token == active_token:
                return None
            session = SESSIONS.get(token)
            if session and session.get("status") == "kicked":
                kicked_by = session.get("kicked_by") or "another operator"
                return _json_response(
                    self,
                    {
                        "ok": False,
                        "error": f"Session ended by {kicked_by}.",
                        "kicked_by": kicked_by,
                    },
                    403,
                )
            if active_token:
                active_name = SESSIONS.get(active_token, {}).get("name", "")
                return _json_response(
                    self,
                    {
                        "ok": False,
                        "error": "Another operator is active.",
                        "active_user": active_name,
                    },
                    403,
                )
        return _json_response(self, {"ok": False, "error": "Session inactive."}, 401)

    def _session_start(self, payload):
        name = str(payload.get("name", "")).strip()
        token = str(payload.get("token", "")).strip()
        if not name or not token:
            return _json_response(
                self, {"ok": False, "error": "Missing session name or token."}, 400
            )
        self._log_browser_details(name, "Session request")
        with SESSION_LOCK:
            active_token = ACTIVE_SESSION["token"]
            if active_token and active_token != token:
                active_name = SESSIONS.get(active_token, {}).get("name", "")
                return _json_response(
                    self,
                    {
                        "ok": False,
                        "status": "occupied",
                        "active_user": active_name,
                    },
                    409,
                )
            session = SESSIONS.get(token, {})
            session.update(
                {
                    "token": token,
                    "name": name,
                    "ip": self._get_client_ip(),
                    "user_agent": self.headers.get("User-Agent", ""),
                    "status": "active",
                    "started_at": time.time(),
                    "kicked_by": "",
                    "kicked_at": 0,
                }
            )
            SESSIONS[token] = session
            ACTIVE_SESSION["token"] = token
        return _json_response(self, {"ok": True, "status": "accepted", "name": name})

    def _session_takeover(self, payload):
        name = str(payload.get("name", "")).strip()
        token = str(payload.get("token", "")).strip()
        confirmed = bool(payload.get("confirm"))
        if not name or not token:
            return _json_response(
                self, {"ok": False, "error": "Missing session name or token."}, 400
            )
        if not confirmed:
            return _json_response(
                self, {"ok": False, "error": "Takeover not confirmed."}, 409
            )
        self._log_browser_details(name, "Session takeover")
        previous_name = ""
        with SESSION_LOCK:
            active_token = ACTIVE_SESSION["token"]
            if active_token and active_token != token:
                previous = SESSIONS.get(active_token, {})
                previous_name = previous.get("name", "")
                previous.update(
                    {
                        "status": "kicked",
                        "kicked_by": name,
                        "kicked_at": time.time(),
                    }
                )
                SESSIONS[active_token] = previous
            session = SESSIONS.get(token, {})
            session.update(
                {
                    "token": token,
                    "name": name,
                    "ip": self._get_client_ip(),
                    "user_agent": self.headers.get("User-Agent", ""),
                    "status": "active",
                    "started_at": time.time(),
                    "kicked_by": "",
                    "kicked_at": 0,
                }
            )
            SESSIONS[token] = session
            ACTIVE_SESSION["token"] = token
        if previous_name:
            print(
                f"Session takeover: {name} logged off {previous_name}.",
                file=sys.stderr,
            )
        return _json_response(
            self,
            {
                "ok": True,
                "status": "took_over",
                "previous_user": previous_name,
            },
        )

    def _session_close(self, payload):
        token = str(payload.get("token", "")).strip() or self._get_session_token()
        if not token:
            return _json_response(
                self, {"ok": False, "error": "Missing session token."}, 400
            )
        with SESSION_LOCK:
            if ACTIVE_SESSION["token"] == token:
                ACTIVE_SESSION["token"] = None
            session = SESSIONS.get(token)
            if session:
                session.update({"status": "closed", "ended_at": time.time()})
                SESSIONS[token] = session
        return _json_response(self, {"ok": True, "status": "closed"})

    def _state_get(self):
        with STATE_LOCK:
            armed = SERVER_STATE["armed"]
            armed_at = SERVER_STATE["armed_at"]
            armed_by = SERVER_STATE["armed_by"]
        return _json_response(
            self,
            {
                "ok": True,
                "armed": armed,
                "armed_at": armed_at,
                "armed_by": armed_by,
            },
        )

    def _state_set(self, payload):
        armed = bool(payload.get("armed"))
        armed_by = str(payload.get("armed_by", "")).strip()
        with STATE_LOCK:
            SERVER_STATE["armed"] = armed
            SERVER_STATE["armed_at"] = time.time() if armed else 0
            SERVER_STATE["armed_by"] = armed_by if armed else ""
        return self._state_get()

    def _config_get(self):
        with STATE_LOCK:
            config = copy.deepcopy(SERVER_STATE.get("config") or {})
        return _json_response(
            self,
            {
                "ok": True,
                "config": config,
            },
        )

    def _config_set(self, payload):
        if not isinstance(payload, dict):
            return _json_response(self, {"ok": False, "error": "Invalid config"}, 400)
        with STATE_LOCK:
            SERVER_STATE["config"] = payload
        return self._config_get()

    def translate_path(self, path):
        path = urllib.parse.urlparse(path).path
        if path == "/":
            path = "/index.html"
        safe_path = os.path.normpath(path).lstrip("/")
        return os.path.join(WEB_ROOT, safe_path)

    def _log_broken_pipe(self):
        client = ""
        if hasattr(self, "client_address"):
            client = f"{self.client_address[0]}:{self.client_address[1]}"
        path = getattr(self, "path", "")
        detail = " ".join(part for part in [client, path] if part)
        suffix = f" ({detail})" if detail else ""
        print(
            f"Client disconnected before response completed.{suffix}",
            file=sys.stderr,
        )

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            return self.handle_api(parsed)
        try:
            return super().do_GET()
        except BrokenPipeError:
            self._log_broken_pipe()
            return None

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            return self.handle_api_post(parsed)
        self.send_error(405)

    def handle_api(self, parsed):
        if not parsed.path.startswith("/api/session/"):
            denied = self._require_active_session()
            if denied is not None:
                return denied
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/state":
            return self._state_get()
        if parsed.path == "/api/config":
            return self._config_get()
        if parsed.path == "/api/check-preview":
            url = (query.get("url") or [""])[0]
            if not url:
                return _json_response(self, {"ok": False, "error": "Missing url"}, 400)
            return self._check_url(url)
        if parsed.path == "/api/check-ollama":
            host = (query.get("host") or [""])[0]
            port = (query.get("port") or [""])[0]
            if not host or not port:
                return _json_response(
                    self, {"ok": False, "error": "Missing host/port"}, 400
                )
            try:
                port_num = int(port)
            except ValueError:
                return _json_response(self, {"ok": False, "error": "Invalid port"}, 400)
            url = f"http://{host}:{port_num}/api/tags"
            return self._check_url(url)
        if parsed.path == "/api/rtsp-snapshot":
            rtsp = (query.get("rtsp") or [""])[0]
            if not rtsp:
                return _json_response(self, {"ok": False, "error": "Missing rtsp"}, 400)
            return self._snapshot_rtsp(rtsp)
        if parsed.path == "/api/ollama-responses":
            responses = get_responses_snapshot()
            return _json_response(self, {"ok": True, "responses": responses})
        if parsed.path == "/api/ollama-tags":
            host = (query.get("host") or [""])[0]
            port = (query.get("port") or [""])[0]
            if not host or not port:
                return _json_response(
                    self, {"ok": False, "error": "Missing host/port"}, 400
                )
            try:
                port_num = int(port)
            except ValueError:
                return _json_response(self, {"ok": False, "error": "Invalid port"}, 400)
            return self._fetch_ollama_tags(host, port_num)
        if parsed.path == "/api/ollama-pull-status":
            with PULL_LOCK:
                return _json_response(
                    self,
                    {
                        "ok": True,
                        "in_progress": PULL_STATE["in_progress"],
                        "status": PULL_STATE["status"],
                        "completed": PULL_STATE["completed"],
                        "total": PULL_STATE["total"],
                        "model": PULL_STATE["model"],
                        "host": PULL_STATE["host"],
                        "port": PULL_STATE["port"],
                        "error": PULL_STATE["error"],
                        "started_at": PULL_STATE["started_at"],
                    },
                )
        return _json_response(self, {"ok": False, "error": "Unknown endpoint"}, 404)

    def handle_api_post(self, parsed):
        if parsed.path == "/api/session/start":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._session_start(payload)
        if parsed.path == "/api/session/takeover":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._session_takeover(payload)
        if parsed.path == "/api/session/close":
            payload = self._read_json() or {}
            return self._session_close(payload)
        denied = self._require_active_session()
        if denied is not None:
            return denied
        if parsed.path == "/api/state":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._state_set(payload)
        if parsed.path == "/api/config":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._config_set(payload)
        if parsed.path == "/api/ollama-analyze":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._ollama_analyze(payload)
        if parsed.path == "/api/email-alert":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._send_email_alert(payload)
        if parsed.path == "/api/ollama-pull":
            payload = self._read_json()
            if payload is None:
                return _json_response(self, {"ok": False, "error": "Invalid JSON"}, 400)
            return self._ollama_pull(payload)
        if parsed.path == "/api/ollama-pull-cancel":
            return self._ollama_pull_cancel()
        return _json_response(self, {"ok": False, "error": "Unknown endpoint"}, 404)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return None
        try:
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw)
        except Exception:  # pylint: disable=broad-except
            return None

    def _prune_responses(self):
        prune_responses()

    def _store_response(self, entry):
        store_response(entry)

    def _check_url(self, url):
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as response:
                content_type = response.headers.get("Content-Type", "")
                return _json_response(
                    self,
                    {
                        "ok": True,
                        "status": response.status,
                        "content_type": content_type,
                    },
                )
        except Exception as exc:  # pylint: disable=broad-except
            try:
                return _json_response(self, {"ok": False, "error": str(exc)}, 502)
            except BrokenPipeError:
                self._log_broken_pipe()
                return None

    def _snapshot_rtsp(self, rtsp_url):
        try:
            data = capture_rtsp_jpeg(rtsp_url)
        except Exception as exc:  # pylint: disable=broad-except
            return _json_response(self, {"ok": False, "error": str(exc)}, 502)

        if data is None:
            return _json_response(
                self, {"ok": False, "error": "Failed to read RTSP frame"}, 502
            )
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            self._log_broken_pipe()
            return None
        return None

    def _ollama_analyze(self, payload):
        result, status = ollama_analyze_payload(payload)
        return _json_response(self, result, status)

    def _fetch_ollama_tags(self, host, port_num):
        tags_url = f"http://{host}:{port_num}/api/tags"
        ps_url = f"http://{host}:{port_num}/api/ps"
        print(f"Ollama tags request: {tags_url}", file=sys.stderr)
        try:
            req = urllib.request.Request(tags_url, method="GET")
            with urllib.request.urlopen(req, timeout=4) as response:
                raw = response.read().decode("utf-8")
                tags_payload = json.loads(raw)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")
            except Exception:  # pylint: disable=broad-except
                detail = ""
            message = f"HTTP {exc.code}: {exc.reason}"
            if detail:
                message = f"{message} ({detail})"
            print(f"Ollama tags fetch failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            print(f"Ollama tags fetch failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)

        running_payload = {}
        try:
            req = urllib.request.Request(ps_url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as response:
                raw = response.read().decode("utf-8")
                running_payload = json.loads(raw)
        except Exception as exc:  # pylint: disable=broad-except
            print(f"Ollama running models fetch skipped: {exc}", file=sys.stderr)

        models = []
        seen = set()
        for item in tags_payload.get("models", []) or []:
            name = item.get("name")
            if name and name not in seen:
                seen.add(name)
                models.append(name)
        running_names = []
        for item in running_payload.get("models", []) or []:
            name = item.get("name") or item.get("model")
            if name and name not in seen:
                seen.add(name)
                models.append(name)
            if name and name not in running_names:
                running_names.append(name)
        return _json_response(
            self,
            {
                "ok": True,
                "models": models,
                "installed_models": len(tags_payload.get("models", []) or []),
                "running_models": len(running_payload.get("models", []) or []),
                "running_names": running_names,
            },
        )

    def _ollama_pull(self, payload):
        host = str(payload.get("host", "")).strip()
        port = payload.get("port")
        model = str(payload.get("model", "")).strip()
        stream = bool(payload.get("stream"))
        if not host or not model:
            return _json_response(
                self, {"ok": False, "error": "Missing host or model"}, 400
            )
        try:
            port_num = int(port)
        except Exception:
            return _json_response(self, {"ok": False, "error": "Invalid port"}, 400)

        with PULL_LOCK:
            if PULL_STATE["in_progress"]:
                return _json_response(
                    self,
                    {
                        "ok": False,
                        "error": "A model pull is already in progress.",
                        "in_progress": True,
                        "status": PULL_STATE["status"],
                        "completed": PULL_STATE["completed"],
                        "total": PULL_STATE["total"],
                        "model": PULL_STATE["model"],
                    },
                    409,
                )

        if stream:
            return self._ollama_pull_stream(host, port_num, model)

        url = f"http://{host}:{port_num}/api/pull"
        payload = {"name": model, "stream": False}
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as response:
                raw = response.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")
            except Exception:  # pylint: disable=broad-except
                detail = ""
            message = f"HTTP {exc.code}: {exc.reason}"
            if detail:
                message = f"{message} ({detail})"
            print(f"Ollama pull failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            print(f"Ollama pull failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)

        status = data.get("status") or "Pull complete."
        return _json_response(self, {"ok": True, "message": status})

    def _ollama_pull_stream(self, host, port_num, model):
        global PULL_CANCEL, PULL_RESPONSE
        url = f"http://{host}:{port_num}/api/pull"
        payload = {"name": model, "stream": True}
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            response = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")
            except Exception:  # pylint: disable=broad-except
                detail = ""
            message = f"HTTP {exc.code}: {exc.reason}"
            if detail:
                message = f"{message} ({detail})"
            print(f"Ollama pull failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            print(f"Ollama pull failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)

        with PULL_LOCK:
            PULL_STATE.update(
                {
                    "in_progress": True,
                    "status": f"Pulling {model}…",
                    "completed": 0,
                    "total": 0,
                    "model": model,
                    "host": host,
                    "port": port_num,
                    "error": "",
                    "started_at": time.time(),
                }
            )
            PULL_CANCEL = False
            PULL_RESPONSE = response

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        try:
            while True:
                if PULL_CANCEL:
                    with PULL_LOCK:
                        PULL_STATE.update(
                            {
                                "in_progress": False,
                                "status": "Pull cancelled.",
                                "error": "Cancelled by user.",
                            }
                        )
                    break
                line = response.readline()
                if not line:
                    break
                try:
                    payload = json.loads(line.decode("utf-8"))
                    with PULL_LOCK:
                        PULL_STATE["status"] = payload.get("status") or PULL_STATE["status"]
                        if payload.get("completed") is not None:
                            PULL_STATE["completed"] = payload.get("completed", 0)
                        if payload.get("total") is not None:
                            PULL_STATE["total"] = payload.get("total", 0)
                        if payload.get("error"):
                            PULL_STATE["error"] = payload.get("error")
                except Exception:
                    pass
                try:
                    self.wfile.write(line)
                    self.wfile.flush()
                except BrokenPipeError:
                    self._log_broken_pipe()
                    break
        finally:
            with PULL_LOCK:
                if PULL_STATE["error"]:
                    PULL_STATE["status"] = PULL_STATE["error"]
                elif PULL_STATE["in_progress"]:
                    PULL_STATE["status"] = "Pull complete."
                PULL_STATE["in_progress"] = False
                PULL_RESPONSE = None
            response.close()
        return None

    def _ollama_pull_cancel(self):
        global PULL_CANCEL, PULL_RESPONSE
        with PULL_LOCK:
            if not PULL_STATE["in_progress"]:
                return _json_response(
                    self, {"ok": False, "error": "No pull in progress."}, 409
                )
            PULL_CANCEL = True
            response = PULL_RESPONSE
        try:
            if response:
                response.close()
        except Exception:
            pass
        return _json_response(self, {"ok": True, "message": "Pull cancelled."})

    def _send_email_alert(self, payload):
        result, status = send_email_alert_payload(payload)
        return _json_response(self, result, status)



if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("application/javascript", ".js")

    server = ThreadingHTTPServer(("", port), RequestHandler)
    start_monitor_thread()
    print(f"Serving on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        stop_monitor_thread()
