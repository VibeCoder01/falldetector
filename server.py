#!/usr/bin/env python3
import base64
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
OLLAMA_RESPONSES = []
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


class RequestHandler(SimpleHTTPRequestHandler):
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
        query = urllib.parse.parse_qs(parsed.query)
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
            self._prune_responses()
            return _json_response(self, {"ok": True, "responses": OLLAMA_RESPONSES})
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
        cutoff = time.time() - RETENTION_SECONDS
        OLLAMA_RESPONSES[:] = [
            item for item in OLLAMA_RESPONSES if item.get("timestamp", 0) >= cutoff
        ]

    def _store_response(self, entry):
        self._prune_responses()
        OLLAMA_RESPONSES.insert(0, entry)

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
            data = self._capture_rtsp_jpeg(rtsp_url)
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

    def _capture_rtsp_jpeg(self, rtsp_url):
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

    def _fetch_preview_image(self, url):
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            content_type = (response.headers.get("Content-Type", "") or "").lower()
            if content_type.startswith("image/"):
                return response.read()
            if "multipart" in content_type or "mjpeg" in content_type:
                return self._extract_mjpeg_frame(response)
            raise RuntimeError(f"Unsupported content type: {content_type or 'unknown'}")

    def _extract_mjpeg_frame(self, response):
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

    def _ollama_analyze(self, payload):
        host = str(payload.get("host", "")).strip()
        port = payload.get("port")
        model = str(payload.get("model", "")).strip()
        prompt = str(payload.get("prompt", "")).strip()
        trigger = str(payload.get("trigger", "")).strip()
        preview_mode = str(payload.get("previewMode", "")).strip()
        timeout_seconds = payload.get("timeoutSeconds")
        stream_url = str(payload.get("streamUrl", "")).strip()
        preview_url = str(payload.get("previewUrl", "")).strip()

        if not host or not model or not prompt:
            return _json_response(
                self, {"ok": False, "error": "Missing host, model, or prompt"}, 400
            )
        try:
            port_num = int(port)
        except Exception:
            return _json_response(self, {"ok": False, "error": "Invalid port"}, 400)

        image_bytes = None
        try:
            if preview_mode == "rtsp" and stream_url.startswith("rtsp://"):
                image_bytes = self._capture_rtsp_jpeg(stream_url)
            elif preview_url:
                image_bytes = self._fetch_preview_image(preview_url)
        except Exception as exc:  # pylint: disable=broad-except
            return _json_response(self, {"ok": False, "error": str(exc)}, 502)

        if not image_bytes:
            return _json_response(
                self, {"ok": False, "error": "No preview image available"}, 400
            )

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
                payload = json.loads(raw)
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
            return _json_response(self, {"ok": False, "error": message}, 502)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            print(f"Ollama analyze failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)

        duration = time.time() - started_at
        text = str(payload.get("response", "")).strip()
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
        }
        self._store_response(entry)
        return _json_response(
            self,
            {
                "ok": True,
                "response": text,
                "triggered": triggered,
                "image": image_b64,
                "image_type": "image/jpeg",
            },
        )

    def _fetch_ollama_tags(self, host, port_num):
        tags_url = f"http://{host}:{port_num}/api/tags"
        ps_url = f"http://{host}:{port_num}/api/ps"
        try:
            req = urllib.request.Request(tags_url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as response:
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
            with urllib.request.urlopen(req, timeout=5) as response:
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
            return _json_response(
                self, {"ok": False, "error": "Missing Gmail credentials"}, 400
            )
        if not sender_email:
            return _json_response(
                self, {"ok": False, "error": "Missing sender email"}, 400
            )
        if not isinstance(recipients, list) or not recipients:
            return _json_response(
                self, {"ok": False, "error": "Missing recipients"}, 400
            )

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
                return _json_response(
                    self, {"ok": False, "error": "Invalid image data"}, 400
                )
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
                return _json_response(
                    self, {"ok": False, "error": "Failed to build HTML email"}, 500
                )
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
            return _json_response(self, {"ok": True, "message": "Email sent."})
        except smtplib.SMTPException as exc:
            message = str(exc)
            print(f"Gmail send failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)
        except Exception as exc:  # pylint: disable=broad-except
            message = str(exc)
            print(f"Gmail send failed: {message}", file=sys.stderr)
            return _json_response(self, {"ok": False, "error": message}, 502)



if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("application/javascript", ".js")

    server = ThreadingHTTPServer(("", port), RequestHandler)
    print(f"Serving on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
