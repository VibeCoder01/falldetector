const respondersList = document.querySelector("#responders-list");
const addResponderBtn = document.querySelector("#add-responder");
const clearRespondersBtn = document.querySelector("#clear-responders");
const previewImg = document.querySelector("#stream-preview");
const streamContainer = document.querySelector(".stream");
const streamOverlay = document.querySelector("#stream-overlay");
const connectPreviewBtn = document.querySelector("#connect-preview");
const stopPreviewBtn = document.querySelector("#stop-preview");
const overlayPreviewBtn = document.querySelector("#preview-button");
const previewUrlInput = document.querySelector("#preview-url");
const previewModeSelect = document.querySelector("#preview-mode");
const snapshotIntervalInput = document.querySelector("#snapshot-interval");
const captureIntervalLabel = document.querySelector(".card-footer strong");
const statusList = document.querySelector("#status-list");
const runChecksBtn = document.querySelector("#run-checks");
const clearChecksBtn = document.querySelector("#clear-checks");
const streamUrlInput = document.querySelector("#stream-url");
const cameraNameInput = document.querySelector("#camera-name");
const cameraModelInput = document.querySelector("#camera-model");
const cameraIpInput = document.querySelector("#camera-ip");
const cameraSelect = document.querySelector("#camera-select");
const addCameraBtn = document.querySelector("#add-camera");
const removeCameraBtn = document.querySelector("#remove-camera");
const cameraSelectStatus = document.querySelector("#camera-select-status");
const rtspUserInput = document.querySelector("#rtsp-user");
const rtspPassInput = document.querySelector("#rtsp-pass");
const streamProfileSelect = document.querySelector("#stream-profile");
const ollamaHostInput = document.querySelector("#ollama-host");
const ollamaPortInput = document.querySelector("#ollama-port");
const ollamaModelInput = document.querySelector("#ollama-model");
const ollamaPromptInput = document.querySelector("#ollama-prompt");
const ollamaTriggerInput = document.querySelector("#ollama-trigger");
const ollamaTimeoutInput = document.querySelector("#ollama-timeout");
const ollamaIntervalInput = document.querySelector("#ollama-interval");
const alertEmailToggle = document.querySelector("#alert-email");
const senderEmailInput = document.querySelector("#sender-email");
const gmailUserInput = document.querySelector("#gmail-user");
const gmailAppPasswordInput = document.querySelector("#gmail-app-password");
const gmailSenderNameInput = document.querySelector("#gmail-sender-name");
const motionSnapshotToggle = document.querySelector("#motion-snapshot");
const cameraForm = document.querySelector("#camera-form");
const ollamaForm = document.querySelector("#ollama-form");
const alertForm = document.querySelector("#alert-form");
const respondersForm = document.querySelector("#responders-form");
const saveArmBtn = document.querySelector("#save-arm");
const saveConfigBtn = document.querySelector("#save-config");
const disarmBtn = document.querySelector("#disarm");
const exportConfigBtn = document.querySelector("#export-config");
const importConfigBtn = document.querySelector("#import-config");
const configFileInput = document.querySelector("#config-file");
const statusStream = document.querySelector("#status-stream");
const statusInference = document.querySelector("#status-inference");
const statusAlerts = document.querySelector("#status-alerts");
const armFeedback = document.querySelector("#arm-feedback");
const ctaSection = document.querySelector(".cta");
const ctaTitle = document.querySelector("#cta-title");
const statusErrorsOnlyToggle = document.querySelector("#status-errors-only");
const autoMinimalModeToggle = document.querySelector("#auto-minimal-mode");
const statusPanel = document.querySelector("#status-panel");
const cameraPanel = document.querySelector("#camera-panel");
const ollamaPanel = document.querySelector("#ollama-panel");
const alertPanel = document.querySelector("#alert-panel");
const respondersPanel = document.querySelector("#responders-panel");
const responsesPanel = document.querySelector("#responses-panel");
const responsesWindow = document.querySelector("#responses-window");
const filterYesOnly = document.querySelector("#filter-yes-only");
const refreshResponsesBtn = document.querySelector("#refresh-responses");
const fetchModelsBtn = document.querySelector("#fetch-models");
const pullModelBtn = document.querySelector("#pull-model");
const cancelPullBtn = document.querySelector("#cancel-pull");
const ollamaCustomInput = document.querySelector("#ollama-model-custom");
const modelFetchStatus = document.querySelector("#model-fetch-status");
const modelPullStatus = document.querySelector("#model-pull-status");
const modelPullProgress = document.querySelector("#model-pull-progress");
const liveModelLabel = document.querySelector("#live-model");
const liveCameraModelLabel = document.querySelector("#live-camera-model");
const testInferenceBtn = document.querySelector("#test-inference");
const testAlertingBtn = document.querySelector("#test-alerting");
const debugValidationBtn = document.querySelector("#debug-validation");
const collapseAllBtn = document.querySelector("#collapse-all");
const minimalModeBtn = document.querySelector("#minimal-mode");
const normalModeBtn = document.querySelector("#normal-mode");
const sessionOverlay = document.querySelector("#session-overlay");
const sessionOverlayMessage = document.querySelector("#session-overlay-message");
const confirmOverlay = document.querySelector("#confirm-overlay");
const confirmMessage = document.querySelector("#confirm-message");
const confirmYesBtn = document.querySelector("#confirm-yes");
const confirmNoBtn = document.querySelector("#confirm-no");

const fields = {
  name: document.querySelector("#responder-name"),
  role: document.querySelector("#responder-role"),
  email: document.querySelector("#responder-email"),
  phone: document.querySelector("#responder-phone"),
};

const SESSION_TOKEN_KEY = "fallDetectorSessionToken";
const SESSION_NAME_KEY = "fallDetectorSessionName";
let sessionToken = "";
let sessionName = "";
let sessionBlocked = false;
let sessionReadyResolve = null;
const sessionReady = new Promise((resolve) => {
  sessionReadyResolve = resolve;
});

const responders = [];
const cameras = [];
const DEFAULT_SNAPSHOT_INTERVAL = 20;
const DEFAULT_TIMEOUT_SECONDS = 180;
const DEFAULT_CAMERA_MODEL = "Tapo C210";

let previewTimer = null;
let checksRunning = false;
let armedState = false;
let armFeedbackTimer = null;
let monitorTimer = null;
let alertCount = 0;
let ollamaResponses = [];
let lastAnalyzeError = "";
let lastAnalyzeErrorAt = 0;
let ollamaModels = [];
let analyzeInFlight = false;
let consecutiveTimeouts = 0;
let pullInFlight = false;
let pullStatusTimer = null;
let pullRequested = false;
let lastEmailAlertErrorAt = 0;
let fetchModelsInFlight = false;
let fetchModelsWaitingTimer = null;
let panelValidationTimer = null;
const statusStates = new Map();
let previewCheckInFlight = false;
let activeCameraId = null;
let monitorAllCameras = false;
let minimalMode = false;
let minimalModePreference = false;
let autoMinimalMode = true;
let serverStateFetched = false;
let serverConfigLoaded = false;

const showSessionOverlay = (message) => {
  if (!sessionOverlay || !sessionOverlayMessage) {
    if (message) {
      alert(message);
    }
    return;
  }
  if (message) {
    sessionOverlayMessage.textContent = message;
  }
  sessionOverlay.hidden = false;
  document.body.classList.add("session-blocked");
};

const blockSession = (message) => {
  sessionBlocked = true;
  if (typeof stopMonitoring === "function") {
    stopMonitoring();
  }
  if (typeof stopPreview === "function") {
    stopPreview();
  }
  showSessionOverlay(message || "Session closed.");
};

const ensureSessionToken = () => {
  let token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      token = window.crypto.randomUUID();
    } else {
      token = `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  }
  return token;
};

const promptForSessionName = () => {
  const storedName = localStorage.getItem(SESSION_NAME_KEY) || "";
  const response = window.prompt(
    "Enter your name to access the control room:",
    storedName
  );
  if (response === null) {
    return "";
  }
  const name = response.trim();
  if (name) {
    localStorage.setItem(SESSION_NAME_KEY, name);
  }
  return name;
};

const confirmDialog = (message, yesLabel = "Yes", noLabel = "No") => {
  return new Promise((resolve) => {
    if (!confirmOverlay || !confirmMessage || !confirmYesBtn || !confirmNoBtn) {
      resolve(window.confirm(message));
      return;
    }
    confirmMessage.textContent = message;
    confirmYesBtn.textContent = yesLabel;
    confirmNoBtn.textContent = noLabel;
    const cleanup = (result) => {
      confirmOverlay.hidden = true;
      confirmYesBtn.removeEventListener("click", onYes);
      confirmNoBtn.removeEventListener("click", onNo);
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    confirmYesBtn.addEventListener("click", onYes);
    confirmNoBtn.addEventListener("click", onNo);
    confirmOverlay.hidden = false;
    confirmYesBtn.focus();
  });
};

const beginSession = async () => {
  showSessionOverlay("Starting session...");
  sessionToken = ensureSessionToken();
  sessionName = promptForSessionName();
  if (!sessionName) {
    blockSession("Session closed. Name is required for access.");
    sessionReadyResolve();
    return;
  }
  try {
    const response = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken, name: sessionName }),
    });
    if (response.status === 409) {
      const payload = await response.json();
      const activeUser = payload.active_user || "another operator";
      const takeover = await confirmDialog(
        `${activeUser} is currently monitoring. Do you want to log them off?`,
        "Yes",
        "No"
      );
      if (!takeover) {
        blockSession(
          `${activeUser} is currently monitoring. Your session has been closed.`
        );
        sessionReadyResolve();
        return;
      }
      const takeoverResponse = await fetch("/api/session/takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: sessionToken,
          name: sessionName,
          confirm: true,
        }),
      });
      const takeoverPayload = await takeoverResponse.json();
      if (!takeoverResponse.ok || !takeoverPayload.ok) {
        blockSession(
          takeoverPayload.error ||
            "Unable to take over the active monitoring session."
        );
        sessionReadyResolve();
        return;
      }
    } else if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      blockSession(payload.error || "Unable to start a session.");
      sessionReadyResolve();
      return;
    }
  } catch (error) {
    blockSession("Unable to reach the session service.");
    sessionReadyResolve();
    return;
  }
  if (sessionOverlay) {
    sessionOverlay.hidden = true;
  }
  document.body.classList.remove("session-blocked");
  sessionReadyResolve();
  await fetchServerState();
  await fetchServerConfig();
};

const apiFetch = async (url, options = {}) => {
  await sessionReady;
  if (sessionBlocked) {
    throw new Error("Session closed.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("X-Session-Token", sessionToken);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (payload) {
      if (payload.kicked_by) {
        blockSession(`You have been logged off by ${payload.kicked_by}.`);
      } else if (payload.active_user) {
        blockSession(
          `${payload.active_user} is currently monitoring. Your session has been closed.`
        );
      } else {
        blockSession(payload.error || "Session closed.");
      }
    } else {
      blockSession("Session closed.");
    }
    throw new Error("Session closed.");
  }
  return response;
};

const fetchServerState = async () => {
  try {
    const response = await apiFetch("/api/state", { cache: "no-store" });
    const payload = await response.json();
    if (payload.ok) {
      serverStateFetched = true;
      setArmedState(Boolean(payload.armed));
      if (payload.armed && armFeedback) {
        const detail = payload.armed_by ? ` by ${payload.armed_by}` : "";
        const timestamp = payload.armed_at
          ? new Date(payload.armed_at * 1000).toLocaleTimeString()
          : "";
        armFeedback.textContent = `System armed${detail}${
          timestamp ? ` at ${timestamp}` : ""
        }.`;
        armFeedback.classList.remove("error");
      }
    }
  } catch (error) {
    // Ignore server state failures; local state will be used.
  }
};

const fetchServerConfig = async () => {
  try {
    const response = await apiFetch("/api/config", { cache: "no-store" });
    const payload = await response.json();
    if (payload.ok && payload.config && Object.keys(payload.config).length > 0) {
      serverConfigLoaded = true;
      applyConfig(payload.config);
    }
  } catch (error) {
    // Ignore config failures; server is source of truth.
  }
};

const saveConfigToServer = async (payload) => {
  try {
    const response = await apiFetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const saved = await response.json();
    if (saved && saved.ok) {
      serverConfigLoaded = true;
      return true;
    }
  } catch (error) {
    // Ignore config failures.
  }
  addStatus(
    "Server config",
    "warn",
    "Unable to sync configuration with the server."
  );
  return false;
};

const updateServerState = async (armed) => {
  try {
    const response = await apiFetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ armed, armed_by: sessionName }),
    });
    const payload = await response.json();
    if (payload && payload.ok) {
      serverStateFetched = true;
    }
  } catch (error) {
    addStatus(
      "Server state",
      "warn",
      "Unable to sync armed state with the server."
    );
  }
};

const updateReadinessState = (forceReady = false) => {
  if (!ctaSection || !ctaTitle) {
    return;
  }
  if (armedState) {
    ctaTitle.textContent = "System is Armed!";
    ctaSection.classList.remove("state-required", "state-ready");
    ctaSection.classList.add("state-armed");
    collapseAllPanels();
    if (responsesPanel) {
      responsesPanel.open = true;
      responsesPanel.setAttribute("open", "");
    }
    return;
  }
  if (forceReady) {
    ctaTitle.textContent = "System is READY to arm!";
    ctaSection.classList.remove("state-required", "state-armed");
    ctaSection.classList.add("state-ready");
    return;
  }
  const validationOk = buildValidationItems().every(
    (item) => item.state === "ok" || item.state === "info"
  );
  const previewState = statusStates.get("Preview connectivity");
  const ollamaState = statusStates.get("Ollama connectivity");
  const checksOk = previewState === "ok" && ollamaState === "ok";
  if (validationOk && checksOk) {
    ctaTitle.textContent = "System is READY to arm!";
    ctaSection.classList.remove("state-required", "state-armed");
    ctaSection.classList.add("state-ready");
  } else {
    ctaTitle.textContent = "Configuration required.";
    ctaSection.classList.remove("state-ready", "state-armed");
    ctaSection.classList.add("state-required");
  }
};

const clearPanelErrors = () => {
  [
    cameraPanel,
    ollamaPanel,
    alertPanel,
    respondersPanel,
  ].forEach((panel) => {
    if (panel) {
      panel.classList.remove("has-error");
    }
  });
};

const schedulePanelRecheck = () => {
  if (panelValidationTimer) {
    window.clearTimeout(panelValidationTimer);
  }
  panelValidationTimer = window.setTimeout(() => {
    updatePanelErrors(buildValidationItems());
    panelValidationTimer = null;
  }, 150);
};

const markStatusPending = (title) => {
  statusStates.set(title, "warn");
  updatePanelErrors(buildValidationItems());
  updateReadinessState();
};

const scheduleOllamaConnectivityCheck = () => {
  if (checksRunning) {
    return;
  }
  checkOllamaConnection();
};

const schedulePreviewConnectivityCheck = () => {
  if (checksRunning || previewCheckInFlight) {
    return;
  }
  previewCheckInFlight = true;
  markStatusPending("Preview connectivity");
  checkPreviewConnection().finally(() => {
    previewCheckInFlight = false;
  });
};

const setModelFetchStatus = (state, message) => {
  if (!modelFetchStatus) {
    return;
  }
  modelFetchStatus.classList.remove("info", "ok", "error");
  if (state) {
    modelFetchStatus.classList.add(state);
  }
  modelFetchStatus.textContent = message;
};

const updatePanelErrors = (items) => {
  const invalidTitles = new Set(
    items
      .filter((item) => item.state === "error" || item.state === "warn")
      .map((item) => item.title)
  );
  const statusInvalidTitles = new Set(
    Array.from(statusStates.entries())
      .filter(([, state]) => state === "error" || state === "warn")
      .map(([title]) => title)
  );
  const setPanelState = (panel, titles) => {
    if (!panel) {
      return;
    }
    const hasError = titles.some(
      (title) => invalidTitles.has(title) || statusInvalidTitles.has(title)
    );
    if (hasError) {
      panel.classList.add("has-error");
      panel.classList.remove("has-valid");
    } else {
      panel.classList.remove("has-error");
      panel.classList.add("has-valid");
    }
  };
  setPanelState(cameraPanel, [
    "Preview interval",
    "Stream URL",
    "RTSP credentials",
    "Tapo URL pattern",
    "Preview mode",
    "Preview URL",
    "Stream profile",
    "Camera IP",
    "Preview connectivity",
  ]);
  setPanelState(ollamaPanel, [
    "Ollama host",
    "Ollama port",
    "Ollama model",
    "Prompt template",
    "Alert trigger",
    "Inference timeout",
    "Inference interval",
    "Ollama connectivity",
    "Model list",
    "Model pull",
    "Inference test",
    "Ollama analysis",
  ]);
  setPanelState(alertPanel, [
    "Sender email",
    "Gmail account email",
    "Gmail app password",
    "Gmail sender name",
    "Alert test",
    "Email alert",
  ]);
  setPanelState(respondersPanel, ["Responder emails"]);
  updateReadinessState();
};

const openStatusPanel = () => {
  const panel = statusPanel || document.querySelector("#status-panel");
  if (!panel) {
    return;
  }
  panel.open = true;
  panel.setAttribute("open", "");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
};

const collapseAllPanels = () => {
  document.querySelectorAll("details.panel.collapsible").forEach((panel) => {
    panel.open = false;
    panel.removeAttribute("open");
  });
};

const getInferenceIntervalSeconds = () => {
  if (ollamaIntervalInput) {
    const raw = Number(ollamaIntervalInput.value);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  if (ollamaTimeoutInput) {
    const raw = Number(ollamaTimeoutInput.value);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  return DEFAULT_TIMEOUT_SECONDS;
};

const setOverlayMessage = (message) => {
  streamOverlay.querySelector("p").textContent = message;
  streamContainer.classList.remove("active");
};

const setPreviewSrc = () => {
  const url = previewUrlInput.value.trim();
  if (!url) {
    setOverlayMessage("Enter a preview URL to connect.");
    return;
  }
  if (url.startsWith("rtsp://")) {
    setOverlayMessage("RTSP needs a gateway. Provide an HTTP preview URL.");
    return;
  }

  if (previewModeSelect.value === "snapshot") {
    const cacheBusted = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    previewImg.src = cacheBusted;
  } else {
    previewImg.src = url;
  }

  streamContainer.classList.add("active");
};

const setRtspPreview = () => {
  const streamUrl = streamUrlInput.value.trim();
  if (!streamUrl || !streamUrl.startsWith("rtsp://")) {
    setOverlayMessage("Enter a valid RTSP URL for snapshot preview.");
    return;
  }
  const cacheBusted = `/api/rtsp-snapshot?rtsp=${encodeURIComponent(
    streamUrl
  )}&session=${encodeURIComponent(sessionToken)}&t=${Date.now()}`;
  previewImg.src = cacheBusted;
  streamContainer.classList.add("active");
};

const stopPreview = () => {
  clearInterval(previewTimer);
  previewTimer = null;
  previewImg.removeAttribute("src");
  setOverlayMessage("Stream preview placeholder");
};

const startPreview = () => {
  clearInterval(previewTimer);
  previewTimer = null;
  const streamUrl = streamUrlInput.value.trim();
  const previewUrl = previewUrlInput.value.trim();
  if (
    previewModeSelect.value !== "rtsp" &&
    streamUrl.startsWith("rtsp://") &&
    (!previewUrl || !isValidUrl(previewUrl))
  ) {
    previewModeSelect.value = "rtsp";
  }
  if (previewModeSelect.value === "rtsp") {
    setRtspPreview();
  } else {
    setPreviewSrc();
  }

  if (streamContainer.classList.contains("active") && previewModeSelect.value === "snapshot") {
    const intervalSeconds = Number(snapshotIntervalInput.value) || DEFAULT_SNAPSHOT_INTERVAL;
    previewTimer = window.setInterval(setPreviewSrc, intervalSeconds * 1000);
  }
  if (streamContainer.classList.contains("active") && previewModeSelect.value === "rtsp") {
    const intervalSeconds = Number(snapshotIntervalInput.value) || DEFAULT_SNAPSHOT_INTERVAL;
    previewTimer = window.setInterval(setRtspPreview, intervalSeconds * 1000);
  }
};

const syncCaptureInterval = () => {
  const intervalSeconds = Number(snapshotIntervalInput.value) || DEFAULT_SNAPSHOT_INTERVAL;
  if (captureIntervalLabel) {
    captureIntervalLabel.textContent = `Every ${intervalSeconds}s`;
  }
};

const updateLiveModelLabel = () => {
  if (!liveModelLabel) {
    return;
  }
  const model = getSelectedModel();
  liveModelLabel.textContent = model || "Not set";
};

const updateLiveCameraModel = () => {
  if (!liveCameraModelLabel) {
    return;
  }
  const model = cameraModelInput ? cameraModelInput.value.trim() : "";
  liveCameraModelLabel.textContent = model || DEFAULT_CAMERA_MODEL;
};

const setMinimalMode = (enabled, persist = true) => {
  if (!armedState && enabled) {
    return;
  }
  minimalMode = enabled;
  if (persist) {
    minimalModePreference = enabled;
    localStorage.setItem(
      "fallDetectorMinimalMode",
      enabled ? "true" : "false"
    );
  }
  document.body.classList.toggle("minimal-mode", enabled);
  if (enabled && responsesPanel) {
    responsesPanel.open = true;
    responsesPanel.setAttribute("open", "");
  }
};

const setAutoMinimalMode = (enabled, persist = true) => {
  autoMinimalMode = enabled;
  if (autoMinimalModeToggle) {
    autoMinimalModeToggle.checked = enabled;
  }
  if (persist) {
    localStorage.setItem(
      "fallDetectorAutoMinimalMode",
      enabled ? "true" : "false"
    );
  }
};

const createCameraId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cam-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const normalizeCamera = (camera) => {
  const snapshotInterval = Number(camera.snapshotInterval);
  return {
    id: camera.id || createCameraId(),
    name: camera.name ? String(camera.name) : "",
    model: camera.model ? String(camera.model) : "",
    ip: camera.ip ? String(camera.ip) : "",
    streamUrl: camera.streamUrl ? String(camera.streamUrl) : "",
    rtspUser: camera.rtspUser ? String(camera.rtspUser) : "",
    rtspPass: camera.rtspPass ? String(camera.rtspPass) : "",
    streamProfile: camera.streamProfile ? String(camera.streamProfile) : "main",
    previewUrl: camera.previewUrl ? String(camera.previewUrl) : "",
    previewMode: camera.previewMode ? String(camera.previewMode) : "mjpeg",
    snapshotInterval: Number.isFinite(snapshotInterval)
      ? snapshotInterval
      : DEFAULT_SNAPSHOT_INTERVAL,
    motionSnapshotting:
      camera.motionSnapshotting !== undefined
        ? Boolean(camera.motionSnapshotting)
        : true,
  };
};

const buildCameraFromForm = () => ({
  id: activeCameraId || createCameraId(),
  name: cameraNameInput ? cameraNameInput.value.trim() : "",
  model: cameraModelInput ? cameraModelInput.value.trim() : "",
  ip: cameraIpInput.value.trim(),
  streamUrl: streamUrlInput.value.trim(),
  rtspUser: rtspUserInput.value.trim(),
  rtspPass: rtspPassInput.value.trim(),
  streamProfile: streamProfileSelect.value,
  previewUrl: previewUrlInput.value.trim(),
  previewMode: previewModeSelect.value,
  snapshotInterval: Number(snapshotIntervalInput.value) || DEFAULT_SNAPSHOT_INTERVAL,
  motionSnapshotting: motionSnapshotToggle ? motionSnapshotToggle.checked : false,
});

const buildBlankCamera = () => ({
  id: createCameraId(),
  name: "",
  model: "",
  ip: "",
  streamUrl: "",
  rtspUser: "",
  rtspPass: "",
  streamProfile: "main",
  previewUrl: "",
  previewMode: "mjpeg",
  snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL,
  motionSnapshotting: true,
});

const getActiveCamera = () =>
  cameras.find((camera) => camera.id === activeCameraId) || cameras[0] || null;

const updateActiveCameraFromForm = () => {
  const active = getActiveCamera();
  if (!active) {
    return;
  }
  Object.assign(active, buildCameraFromForm());
};

const applyCameraToForm = (camera) => {
  if (!camera) {
    return;
  }
  if (cameraNameInput) {
    cameraNameInput.value = camera.name || "";
  }
  if (cameraModelInput) {
    cameraModelInput.value = camera.model || "";
  }
  if (cameraIpInput) {
    cameraIpInput.value = camera.ip || "";
  }
  if (streamUrlInput) {
    streamUrlInput.value = camera.streamUrl || "";
  }
  if (rtspUserInput) {
    rtspUserInput.value = camera.rtspUser || "";
  }
  if (rtspPassInput) {
    rtspPassInput.value = camera.rtspPass || "";
  }
  if (streamProfileSelect) {
    streamProfileSelect.value = camera.streamProfile || "main";
  }
  if (previewUrlInput) {
    previewUrlInput.value = camera.previewUrl || "";
  }
  if (previewModeSelect) {
    previewModeSelect.value = camera.previewMode || "mjpeg";
  }
  if (snapshotIntervalInput) {
    snapshotIntervalInput.value =
      Number(camera.snapshotInterval) || DEFAULT_SNAPSHOT_INTERVAL;
  }
  if (motionSnapshotToggle) {
    motionSnapshotToggle.checked =
      camera.motionSnapshotting !== undefined
        ? Boolean(camera.motionSnapshotting)
        : true;
  }
  stopPreview();
  syncCaptureInterval();
  updateLiveCameraModel();
  schedulePanelRecheck();
};

const renderCameraSelect = () => {
  if (!cameraSelect) {
    return;
  }
  if (!activeCameraId && cameras.length > 0) {
    activeCameraId = cameras[0].id;
  }
  cameraSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `All cameras (${cameras.length})`;
  cameraSelect.appendChild(allOption);
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    const label = camera.name || `Camera ${index + 1}`;
    option.value = camera.id;
    option.textContent = camera.model ? `${label} · ${camera.model}` : label;
    cameraSelect.appendChild(option);
  });
  if (monitorAllCameras) {
    cameraSelect.value = "all";
  } else if (activeCameraId) {
    cameraSelect.value = activeCameraId;
  }
  if (cameraSelectStatus) {
    const count = cameras.length;
    cameraSelectStatus.textContent = monitorAllCameras
      ? `Monitoring all ${count} camera${count === 1 ? "" : "s"}`
      : `${count} camera${count === 1 ? "" : "s"}`;
  }
  if (removeCameraBtn) {
    removeCameraBtn.disabled = cameras.length <= 1;
  }
};

const setActiveCamera = (cameraId) => {
  monitorAllCameras = false;
  activeCameraId = cameraId;
  const active = getActiveCamera();
  if (active) {
    applyCameraToForm(active);
  }
  renderCameraSelect();
};

const initializeCameraState = () => {
  if (cameras.length > 0) {
    return;
  }
  const initial = normalizeCamera(buildCameraFromForm());
  cameras.push(initial);
  activeCameraId = initial.id;
  renderCameraSelect();
};

const handleCameraFormUpdate = () => {
  updateActiveCameraFromForm();
  renderCameraSelect();
};

const getMonitoringCameras = () => {
  updateActiveCameraFromForm();
  if (monitorAllCameras) {
    return cameras.slice();
  }
  const active = getActiveCamera();
  return active ? [active] : [];
};

const addStatus = (title, state, detail) => {
  const item = document.createElement("div");
  item.className = `status-item status-${state}`;
  item.dataset.state = state;
  item.innerHTML = `
    <strong><span class="badge ${state}">${state}</span>${title}</strong>
    <span class="muted">${detail}</span>
  `;
  statusList.appendChild(item);
  statusStates.set(title, state);
  updatePanelErrors(buildValidationItems());
  applyStatusFilter();
  updateReadinessState();
};

const clearStatus = () => {
  statusList.innerHTML = "";
  statusStates.clear();
  updatePanelErrors(buildValidationItems());
  applyStatusFilter();
  updateReadinessState();
};

const applyStatusFilter = () => {
  if (!statusErrorsOnlyToggle) {
    return;
  }
  const showErrorsOnly = statusErrorsOnlyToggle.checked;
  const items = statusList.querySelectorAll(".status-item");
  items.forEach((item) => {
    const state = item.dataset.state || "";
    const isError = state === "error";
    item.style.display = showErrorsOnly && !isError ? "none" : "";
  });
};

const isValidHost = (value) => {
  if (!value || /\s/.test(value)) {
    return false;
  }
  const ipRegex =
    /^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$/;
  const hostRegex = /^[a-zA-Z0-9.-]+$/;
  return ipRegex.test(value) || hostRegex.test(value);
};

const isValidIp = (value) => {
  if (!value || /\s/.test(value)) {
    return false;
  }
  const ipRegex =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  return ipRegex.test(value);
};

const buildRtspUrl = () => {
  const ip = cameraIpInput.value.trim();
  const user = rtspUserInput.value.trim();
  const pass = rtspPassInput.value.trim();
  if (!ip || !user || !pass || !isValidHost(ip)) {
    return "";
  }
  const streamPath = streamProfileSelect.value === "sub" ? "stream2" : "stream1";
  return `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:554/${streamPath}`;
};

const syncStreamUrl = () => {
  const built = buildRtspUrl();
  if (built) {
    streamUrlInput.value = built;
  }
};

const isValidUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isValidPhone = (value) => /^[+\d][\d\s().-]{6,}$/.test(value);

const getResponderStats = () => {
  const hasEmail = responders.some((responder) => isValidEmail(responder.email || ""));
  const hasPhone = responders.some((responder) => isValidPhone(responder.phone || ""));
  return { hasEmail, hasPhone };
};

const getResponderEmails = () =>
  responders
    .map((responder) => responder.email || "")
    .map((email) => email.trim())
    .filter((email) => isValidEmail(email));

const getSelectedModel = () => {
  if (!ollamaModelInput) {
    return "";
  }
  if (ollamaModelInput.value === "__custom__") {
    return ollamaCustomInput ? ollamaCustomInput.value.trim() : "";
  }
  return ollamaModelInput.value.trim();
};

const toggleCustomModelInput = () => {
  if (!ollamaCustomInput || !ollamaModelInput) {
    return;
  }
  const isCustom = ollamaModelInput.value === "__custom__";
  ollamaCustomInput.style.display = isCustom ? "block" : "none";
  if (isCustom) {
    ollamaCustomInput.focus();
  }
  updateLiveModelLabel();
};

const setModelPullStatus = (state, message) => {
  if (!modelPullStatus) {
    return;
  }
  modelPullStatus.textContent = message;
  modelPullStatus.classList.remove("info", "ok", "error");
  if (state) {
    modelPullStatus.classList.add(state);
  }
};

const setModelPullProgress = (value, max, indeterminate) => {
  if (!modelPullProgress) {
    return;
  }
  if (indeterminate) {
    modelPullProgress.removeAttribute("value");
    modelPullProgress.removeAttribute("max");
    return;
  }
  modelPullProgress.max = max;
  modelPullProgress.value = value;
};

const setPullControls = (inProgress) => {
  if (pullModelBtn) {
    pullModelBtn.disabled = inProgress;
  }
  if (cancelPullBtn) {
    cancelPullBtn.disabled = !inProgress;
  }
};

const buildValidationItems = () => {
  const items = [];
  const pushItem = (title, state, detail) => {
    items.push({ title, state, detail });
  };
  const streamUrl = streamUrlInput.value.trim();
  const previewUrl = previewUrlInput.value.trim();
  const snapshotInterval = Number(snapshotIntervalInput.value);
  const rtspUser = rtspUserInput.value.trim();
  const rtspPass = rtspPassInput.value.trim();
  const profile = streamProfileSelect.value;
  const cameraIp = cameraIpInput.value.trim();
  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  const model = getSelectedModel();
  const prompt = ollamaPromptInput.value.trim();
  const trigger = ollamaTriggerInput.value.trim();
  const timeoutSeconds = Number(ollamaTimeoutInput ? ollamaTimeoutInput.value : "");
  const inferenceInterval = getInferenceIntervalSeconds();
  const senderEmail = senderEmailInput.value.trim();
  const gmailUser = gmailUserInput.value.trim();
  const gmailAppPassword = gmailAppPasswordInput.value.trim();
  const gmailSenderName = gmailSenderNameInput.value.trim();
  const respondersMeta = getResponderStats();
  const previewConnectivity = statusStates.get("Preview connectivity");
  const previewOk = previewConnectivity === "ok";

  pushItem(
    "Preview interval",
    snapshotInterval >= 2 && snapshotInterval <= 60 ? "ok" : "error",
    "Use a value between 2 and 60 seconds."
  );

  if (streamUrl) {
    const isRtsp = streamUrl.startsWith("rtsp://");
    pushItem(
      "Stream URL",
      isRtsp ? "ok" : previewOk ? "info" : "warn",
      isRtsp
        ? "RTSP format detected."
        : previewOk
          ? "RTSP optional while preview is healthy."
          : "RTSP expected. Provide rtsp:// if available."
    );
    pushItem(
      "RTSP credentials",
      rtspUser && rtspPass ? "ok" : previewOk ? "info" : "warn",
      rtspUser && rtspPass
        ? "Credentials provided."
        : previewOk
          ? "RTSP credentials optional while preview is healthy."
          : "Add username + password for RTSP."
    );
    const tapoPattern = /^rtsp:\/\/[^:@\s]+:[^@\s]+@[^\s:]+:554\/stream[12]$/;
    pushItem(
      "Tapo URL pattern",
      tapoPattern.test(streamUrl) ? "ok" : previewOk ? "info" : "warn",
      previewOk
        ? "Tapo pattern optional while preview is healthy."
        : "Expected rtsp://user:pass@IP:554/stream1 or stream2."
    );
  } else {
    pushItem(
      "Stream URL",
      previewOk ? "info" : "warn",
      previewOk
        ? "RTSP optional while preview is healthy."
        : "Provide the RTSP URL from your Tapo camera."
    );
  }

  if (previewModeSelect.value === "rtsp") {
    pushItem(
      "Preview mode",
      "ok",
      "Server RTSP snapshot selected."
    );
  } else if (previewUrl) {
    pushItem(
      "Preview URL",
      isValidUrl(previewUrl) ? "ok" : "error",
      "Use an http(s) URL for MJPEG or snapshot preview."
    );
  } else {
    pushItem("Preview URL", "warn", "Provide an HTTP preview URL for browser playback.");
  }

  pushItem(
    "Stream profile",
    profile ? "ok" : "warn",
    profile ? `Selected ${profile} profile.` : "Select main or sub stream."
  );

  if (!cameraIp) {
    pushItem(
      "Camera IP",
      previewOk ? "info" : "warn",
      previewOk
        ? "Camera IP optional while preview is healthy."
        : "Set the camera IP for auto-building RTSP."
    );
  } else if (!isValidIp(cameraIp)) {
    pushItem("Camera IP", "error", "Camera IP must be a valid IPv4 address.");
  } else {
    pushItem("Camera IP", "ok", "Camera IP looks valid.");
  }

  pushItem(
    "Ollama host",
    isValidHost(host) ? "ok" : "error",
    "Use a hostname or IP address."
  );

  pushItem(
    "Ollama port",
    port >= 1 && port <= 65535 ? "ok" : "error",
    "Port must be between 1 and 65535."
  );

  pushItem("Ollama model", model ? "ok" : "warn", "Set the model tag to query.");
  pushItem("Prompt template", prompt ? "ok" : "warn", "Add a clear YES/NO prompt.");
  pushItem("Alert trigger", trigger ? "ok" : "warn", "Define the match token (e.g. YES).");
  if (ollamaTimeoutInput) {
    pushItem(
      "Inference timeout",
      timeoutSeconds >= 10 && timeoutSeconds <= 600 ? "ok" : "warn",
      "Use a timeout between 10 and 600 seconds."
    );
  }
  if (ollamaIntervalInput) {
    pushItem(
      "Inference interval",
      inferenceInterval >= 10 && inferenceInterval <= 600 ? "ok" : "warn",
      "Use an interval between 10 and 600 seconds."
    );
  }

  if (alertEmailToggle.checked) {
    pushItem(
      "Sender email",
      isValidEmail(senderEmail) ? "ok" : "error",
      "Provide a valid sender email for alerts."
    );
    pushItem(
      "Gmail account email",
      isValidEmail(gmailUser) ? "ok" : "error",
      "Provide the Gmail account used to send alerts."
    );
    pushItem(
      "Gmail app password",
      gmailAppPassword ? "ok" : "error",
      "Add a Gmail app password for SMTP."
    );
    pushItem(
      "Gmail sender name",
      gmailSenderName ? "ok" : "warn",
      "Optional display name for outgoing alerts."
    );
    pushItem(
      "Responder emails",
      respondersMeta.hasEmail ? "ok" : "warn",
      "Add at least one responder email."
    );
  } else {
    pushItem("Email alerts", "info", "Email alerts are disabled.");
  }

  return items;
};

const runSyntaxChecks = () => {
  const items = buildValidationItems();
  updatePanelErrors(items);
  items.forEach((item) => addStatus(item.title, item.state, item.detail));
};

const checkPreviewConnection = async () => {
  if (previewModeSelect.value === "rtsp") {
    const streamUrl = streamUrlInput.value.trim();
    if (!streamUrl || !streamUrl.startsWith("rtsp://")) {
      addStatus(
        "Preview connectivity",
        "warn",
        "Provide a valid RTSP URL for server snapshot."
      );
      return;
    }
    try {
      const response = await apiFetch(
        `/api/rtsp-snapshot?rtsp=${encodeURIComponent(streamUrl)}`
      );
      if (response.ok) {
        addStatus("Preview connectivity", "ok", "RTSP snapshot succeeded.");
      } else {
        const payload = await response.json();
        addStatus(
          "Preview connectivity",
          "error",
          payload.error || `RTSP snapshot failed (${response.status}).`
        );
      }
    } catch (error) {
      addStatus(
        "Preview connectivity",
        "error",
        "RTSP snapshot failed. Is server.py running?"
      );
    }
    return;
  }

  const previewUrl = previewUrlInput.value.trim();
  if (!previewUrl || !isValidUrl(previewUrl)) {
    addStatus("Preview connectivity", "warn", "Add a valid preview URL first.");
    return;
  }

  try {
    const response = await apiFetch(
      `/api/check-preview?url=${encodeURIComponent(previewUrl)}`
    );
    const payload = await response.json();
    if (payload.ok) {
      addStatus(
        "Preview connectivity",
        "ok",
        `Connected (${payload.status || "ok"}).`
      );
      return;
    }
    addStatus(
      "Preview connectivity",
      "error",
      payload.error || "Unable to reach the preview endpoint."
    );
  } catch (error) {
    try {
      await fetch(previewUrl, { mode: "no-cors" });
      addStatus(
        "Preview connectivity",
        "warn",
        "Fallback check used (browser CORS limits)."
      );
    } catch (fallbackError) {
      addStatus(
        "Preview connectivity",
        "error",
        "Backend check failed. Start server.py or ensure CORS is enabled."
      );
    }
  }
};

const checkOllamaConnection = async () => {
  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  if (!isValidHost(host) || !(port >= 1 && port <= 65535)) {
    addStatus("Ollama connectivity", "warn", "Fix host and port before testing.");
    return;
  }

  try {
    const response = await apiFetch(
      `/api/check-ollama?host=${encodeURIComponent(host)}&port=${port}`
    );
    const payload = await response.json();
    if (payload.ok) {
      addStatus("Ollama connectivity", "ok", "Connected to Ollama API.");
      return;
    }
    addStatus(
      "Ollama connectivity",
      "error",
      payload.error || "Unable to reach Ollama."
    );
  } catch (error) {
    try {
      const direct = await fetch(`http://${host}:${port}/api/tags`, { method: "GET" });
      if (direct.ok) {
        addStatus(
          "Ollama connectivity",
          "warn",
          "Direct browser check used (CORS may block responses)."
        );
      } else {
        addStatus(
          "Ollama connectivity",
          "error",
          `Received HTTP ${direct.status} from Ollama.`
        );
      }
    } catch (fallbackError) {
      addStatus(
        "Ollama connectivity",
        "error",
        "Backend check failed. Start server.py or enable CORS."
      );
    }
  }
};

const runChecks = async () => {
  if (checksRunning) {
    return;
  }
  checksRunning = true;
  clearStatus();
  addStatus("Validation", "info", "Running syntax checks...");
  runSyntaxChecks();
  addStatus("Connectivity", "info", "Testing preview + Ollama endpoints...");
  await checkPreviewConnection();
  await checkOllamaConnection();
  checksRunning = false;
  updatePanelErrors(buildValidationItems());
  updateReadinessState();
};

const buildEmailBody = (context) => {
  const fallbackName = cameraNameInput ? cameraNameInput.value.trim() : "";
  const fallbackModel = cameraModelInput ? cameraModelInput.value.trim() : "";
  const cameraName = context.cameraName || fallbackName;
  const cameraModel = context.cameraModel || fallbackModel;
  const lines = [
    `Event: ${context.event || "alert"}`,
    `Time: ${new Date().toLocaleString()}`,
    `Camera: ${cameraName || "Camera"} (${cameraModel || DEFAULT_CAMERA_MODEL})`,
  ];
  if (context.responseText) {
    lines.push("", "Inference:", context.responseText);
  }
  return lines.join("\n");
};

const sendEmailAlert = async (context) => {
  const smtpUser = gmailUserInput.value.trim();
  const smtpPassword = gmailAppPasswordInput.value.trim();
  const senderEmail = senderEmailInput.value.trim() || smtpUser;
  const senderName = gmailSenderNameInput.value.trim();
  const recipients = getResponderEmails();
  if (!smtpUser || !smtpPassword) {
    return { ok: false, error: "Missing Gmail credentials." };
  }
  if (!senderEmail || !isValidEmail(senderEmail)) {
    return { ok: false, error: "Missing sender email." };
  }
  if (recipients.length === 0) {
    return { ok: false, error: "No responder emails configured." };
  }
  const subject = context.subject || "Fall Detector Alert";
  const body = buildEmailBody(context);
  const imageBase64 = context.imageBase64 || "";
  const imageType = context.imageType || "";
  try {
    const response = await apiFetch("/api/email-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smtp_user: smtpUser,
        smtp_password: smtpPassword,
        sender_email: senderEmail,
        sender_name: senderName,
        recipients,
        subject,
        body,
        image_b64: imageBase64,
        image_type: imageType,
      }),
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch (parseError) {
      payload = null;
    }
    if (response.ok && payload && payload.ok) {
      return payload;
    }
    if (payload && payload.error) {
      return { ok: false, error: payload.error };
    }
    const detail = raw ? ` ${raw.slice(0, 200)}` : "";
    return { ok: false, error: `HTTP ${response.status}.${detail}` };
  } catch (error) {
    return { ok: false, error: `Failed to reach email service: ${error}` };
  }
};

const runInferenceTest = async () => {
  if (analyzeInFlight) {
    addStatus("Inference test", "warn", "An inference request is already running.");
    return;
  }
  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  const model = getSelectedModel();
  const prompt = ollamaPromptInput.value.trim();
  const trigger = ollamaTriggerInput.value.trim();
  const timeoutSeconds =
    Number(ollamaTimeoutInput ? ollamaTimeoutInput.value : "") || DEFAULT_TIMEOUT_SECONDS;
  const streamUrl = streamUrlInput.value.trim();
  const previewUrl = previewUrlInput.value.trim();
  const previewMode = previewModeSelect.value;
  const cameraName = cameraNameInput ? cameraNameInput.value.trim() : "";
  const cameraModel = cameraModelInput ? cameraModelInput.value.trim() : "";

  if (!host || !(port >= 1 && port <= 65535) || !model || !prompt) {
    addStatus(
      "Inference test",
      "warn",
      "Set host, port, model, and prompt before testing."
    );
    return;
  }
  if (!streamUrl && !previewUrl) {
    addStatus(
      "Inference test",
      "warn",
      "Provide a preview or stream URL before running inference."
    );
    return;
  }

  analyzeInFlight = true;
  addStatus("Inference test", "info", "Running a single inference request...");
  try {
    const response = await apiFetch("/api/ollama-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        port,
        model,
        prompt,
        trigger,
        timeoutSeconds,
        streamUrl,
        previewUrl,
        previewMode,
        cameraId: activeCameraId || "",
        cameraName,
        cameraModel,
      }),
    });
    const payload = await response.json();
    if (payload.ok) {
      const outcome = payload.triggered ? "Triggered: YES." : "Triggered: NO.";
      addStatus("Inference test", "ok", `Inference completed. ${outcome}`);
      if (payload.triggered && alertEmailToggle.checked) {
        const emailResult = await sendEmailAlert({
          event: "inference_test",
          subject: "Fall Detector Test Alert",
          responseText: payload.response || "",
          imageBase64: payload.image || "",
          imageType: payload.image_type || "",
        });
        if (!emailResult.ok) {
          addStatus(
            "Email alert",
            "error",
            emailResult.error || "Failed to send email alert."
          );
        } else {
          addStatus("Email alert", "ok", "Email sent.");
        }
      }
      await fetchResponses();
      return;
    }
    addStatus("Inference test", "error", payload.error || "Inference failed.");
  } catch (error) {
    addStatus("Inference test", "error", "Failed to reach Ollama host.");
  } finally {
    analyzeInFlight = false;
  }
};

const testAlerting = async () => {
  const responderStats = getResponderStats();
  const channels = [];
  if (alertEmailToggle.checked) {
    channels.push("email");
  }
  if (channels.length === 0) {
    addStatus("Alert test", "warn", "Enable at least one alert channel first.");
    return;
  }

  const issues = [];
  if (alertEmailToggle.checked && !responderStats.hasEmail) {
    issues.push("email responders");
  }
  if (alertEmailToggle.checked && !isValidEmail(gmailUserInput.value.trim())) {
    issues.push("Gmail account email");
  }
  if (alertEmailToggle.checked && !gmailAppPasswordInput.value.trim()) {
    issues.push("Gmail app password");
  }
  if (alertEmailToggle.checked && !isValidEmail(senderEmailInput.value.trim())) {
    issues.push("sender email");
  }
  if (issues.length > 0) {
    addStatus("Alert test", "warn", `Missing ${issues.join(", ")}.`);
    return;
  }

  if (alertEmailToggle.checked) {
    const emailResult = await sendEmailAlert({
      event: "test_alert",
      subject: "Fall Detector Test Alert",
      responseText: "This is a test email from the fall detector control room.",
    });
    if (!emailResult.ok) {
      addStatus("Alert test", "error", emailResult.error || "Email alert failed.");
      return;
    }
  }

  addStatus(
    "Alert test",
    "ok",
    `Alert test sent to ${channels.join(", ")} responders.`
  );
};

const buildConfigPayload = () => {
  updateActiveCameraFromForm();
  const activeCamera = getActiveCamera();
  return {
    cameras: cameras.map((camera) => ({ ...camera })),
    activeCameraId: activeCamera ? activeCamera.id : null,
    monitorAllCameras,
    camera: activeCamera ? { ...activeCamera } : null,
    ollama: {
      host: ollamaHostInput.value.trim(),
      port: Number(ollamaPortInput.value),
      model: getSelectedModel(),
      prompt: ollamaPromptInput.value.trim(),
      trigger: ollamaTriggerInput.value.trim(),
      timeoutSeconds:
        Number(ollamaTimeoutInput ? ollamaTimeoutInput.value : "") ||
        DEFAULT_TIMEOUT_SECONDS,
      intervalSeconds: getInferenceIntervalSeconds(),
    },
    alerts: {
      emailEnabled: alertEmailToggle.checked,
      senderEmail: senderEmailInput.value.trim(),
      gmailUser: gmailUserInput.value.trim(),
      gmailAppPassword: gmailAppPasswordInput.value.trim(),
      gmailSenderName: gmailSenderNameInput.value.trim(),
    },
    responders: responders.map((responder) => ({ ...responder })),
    ui: {
      autoMinimalMode,
    },
    savedAt: new Date().toISOString(),
  };
};

const applyConfig = (payload) => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (Array.isArray(payload.cameras) && payload.cameras.length > 0) {
    cameras.splice(
      0,
      cameras.length,
      ...payload.cameras.map((camera) => normalizeCamera(camera))
    );
    if (payload.activeCameraId) {
      activeCameraId = payload.activeCameraId;
    } else {
      activeCameraId = cameras[0].id;
    }
    monitorAllCameras = Boolean(payload.monitorAllCameras);
    if (!cameras.some((camera) => camera.id === activeCameraId)) {
      activeCameraId = cameras[0].id;
    }
    renderCameraSelect();
    applyCameraToForm(getActiveCamera());
  } else if (payload.camera) {
    const camera = normalizeCamera(payload.camera);
    cameras.splice(0, cameras.length, camera);
    activeCameraId = camera.id;
    monitorAllCameras = false;
    renderCameraSelect();
    applyCameraToForm(camera);
  }
  if (payload.ollama) {
    const ollama = payload.ollama;
    if (ollama.host) {
      ollamaHostInput.value = ollama.host;
    }
    if (ollama.port) {
      ollamaPortInput.value = ollama.port;
    }
    if (ollama.model) {
      if (ollamaModelInput) {
        const option = Array.from(ollamaModelInput.options || []).find(
          (item) => item.value === ollama.model
        );
        if (option) {
          ollamaModelInput.value = ollama.model;
        } else {
          ollamaModelInput.value = "__custom__";
          if (ollamaCustomInput) {
            ollamaCustomInput.value = ollama.model;
          }
        }
        toggleCustomModelInput();
      }
    }
    if (ollama.prompt) {
      ollamaPromptInput.value = ollama.prompt;
    }
    if (ollama.trigger) {
      ollamaTriggerInput.value = ollama.trigger;
    }
    if (ollamaTimeoutInput && ollama.timeoutSeconds) {
      ollamaTimeoutInput.value = ollama.timeoutSeconds;
    }
    if (ollamaIntervalInput) {
      if (ollama.intervalSeconds) {
        ollamaIntervalInput.value = ollama.intervalSeconds;
      } else if (ollama.timeoutSeconds) {
        ollamaIntervalInput.value = ollama.timeoutSeconds;
      }
    }
  }
  if (payload.alerts) {
    const alerts = payload.alerts;
    if (alerts.emailEnabled !== undefined) {
      alertEmailToggle.checked = Boolean(alerts.emailEnabled);
    }
    if (alerts.senderEmail) {
      senderEmailInput.value = alerts.senderEmail;
    }
    if (alerts.gmailUser) {
      gmailUserInput.value = alerts.gmailUser;
    }
    if (alerts.gmailAppPassword) {
      gmailAppPasswordInput.value = alerts.gmailAppPassword;
    }
    if (alerts.gmailSenderName) {
      gmailSenderNameInput.value = alerts.gmailSenderName;
    }
  }
  if (payload.ui && payload.ui.autoMinimalMode !== undefined) {
    setAutoMinimalMode(Boolean(payload.ui.autoMinimalMode));
  }
  if (Array.isArray(payload.responders)) {
    responders.splice(0, responders.length, ...payload.responders);
    renderResponders();
  }
  syncCaptureInterval();
  syncStreamUrl();
  updateLiveCameraModel();
  updateLiveModelLabel();
  schedulePanelRecheck();
};

const setArmedState = (armed) => {
  armedState = armed;
  document.body.classList.toggle("armed", armed);
  if (saveArmBtn) {
    saveArmBtn.textContent = armed ? "Armed ✓" : "Save & Arm";
    saveArmBtn.classList.toggle("armed", armed);
    saveArmBtn.setAttribute("aria-pressed", armed ? "true" : "false");
    saveArmBtn.disabled = armed;
  }
  if (responsesPanel) {
    responsesPanel.classList.toggle("armed-ring", armed);
  }
  if (disarmBtn) {
    disarmBtn.disabled = !armed;
  }
  if (statusStream) {
    statusStream.textContent = armed ? "Monitoring" : "Idle";
  }
  if (statusInference) {
    statusInference.textContent = armed ? "Active" : "—";
  }
  if (statusAlerts) {
    statusAlerts.textContent = `${alertCount} sent`;
  }
  if (armFeedback && !armed) {
    armFeedback.textContent = "";
    armFeedback.classList.remove("error");
  }
  if (!armed) {
    stopMonitoring();
    setMinimalMode(false, false);
  } else {
    setMinimalMode(minimalModePreference, false);
  }
  updateReadinessState();
};

const handleSaveArm = async (event) => {
  if (event) {
    event.preventDefault();
  }
  clearStatus();
  const items = buildValidationItems();
  updatePanelErrors(items);
  items.forEach((item) => addStatus(item.title, item.state, item.detail));
  const hasError = items.some((item) => item.state === "error");
  if (hasError) {
    addStatus("Save & Arm", "error", "Fix errors before arming the system.");
    setArmedState(false);
    if (armFeedback) {
      armFeedback.textContent = "Fix the highlighted errors before arming.";
      armFeedback.classList.add("error");
    }
    openStatusPanel();
    if (saveArmBtn) {
      saveArmBtn.classList.add("arm-error");
      window.setTimeout(() => saveArmBtn.classList.remove("arm-error"), 600);
    }
    return;
  }

  const payload = buildConfigPayload();
  await saveConfigToServer(payload);
  alertCount = 0;
  setArmedState(true);
  updateServerState(true);
  if (autoMinimalMode) {
    setMinimalMode(true);
  }
  addStatus(
    "Save & Arm",
    "ok",
    "Configuration saved on server. Monitoring armed."
  );
  if (armFeedback) {
    const timestamp = new Date().toLocaleTimeString();
    armFeedback.textContent = `Saved and armed at ${timestamp}.`;
    armFeedback.classList.remove("error");
  }
  if (saveArmBtn) {
    saveArmBtn.classList.add("arm-pulse");
    window.clearTimeout(armFeedbackTimer);
    armFeedbackTimer = window.setTimeout(() => {
      saveArmBtn.classList.remove("arm-pulse");
    }, 1200);
  }
};

const handleSaveConfig = async (event) => {
  if (event) {
    event.preventDefault();
  }
  clearStatus();
  const items = buildValidationItems();
  updatePanelErrors(items);
  items.forEach((item) => addStatus(item.title, item.state, item.detail));
  const hasError = items.some((item) => item.state === "error");
  if (hasError) {
    addStatus("Save", "error", "Fix errors before saving the configuration.");
    if (armFeedback) {
      armFeedback.textContent = "Fix the highlighted errors before saving.";
      armFeedback.classList.add("error");
    }
    openStatusPanel();
    return;
  }

  const payload = buildConfigPayload();
  await saveConfigToServer(payload);
  if (armFeedback) {
    const timestamp = new Date().toLocaleTimeString();
    armFeedback.textContent = `Saved at ${timestamp}.`;
    armFeedback.classList.remove("error");
  }
  addStatus("Save", "ok", "Configuration saved on server.");
};

const renderResponses = () => {
  if (!responsesWindow) {
    return;
  }
  responsesWindow.innerHTML = "";
  const showYesOnly = filterYesOnly ? filterYesOnly.checked : false;
  const filtered = showYesOnly
    ? ollamaResponses.filter((item) => item.triggered)
    : ollamaResponses;

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No responses yet.";
    responsesWindow.appendChild(empty);
    return;
  }

  filtered.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "response-item";
    if (item.triggered) {
      entry.classList.add("yes");
    }

    const meta = document.createElement("div");
    meta.className = "response-meta";
    const timestamp = new Date(item.timestamp * 1000);
    const cameraLabel = item.camera_name || item.camera_model || "";
    const metaParts = [timestamp.toLocaleString(), item.model || "ollama"];
    if (cameraLabel) {
      metaParts.push(cameraLabel);
    }
    meta.textContent = metaParts.join(" · ");

    const body = document.createElement("div");
    body.textContent = item.text || "No response text.";

    entry.appendChild(meta);
    entry.appendChild(body);
    responsesWindow.appendChild(entry);
  });
};

const fetchResponses = async () => {
  try {
    const response = await apiFetch("/api/ollama-responses");
    const payload = await response.json();
    if (payload.ok) {
      ollamaResponses = payload.responses || [];
      renderResponses();
    }
  } catch (error) {
    // Silently ignore; responses panel is optional.
  }
};

const fetchModels = async () => {
  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  if (!host || !(port >= 1 && port <= 65535)) {
    addStatus("Model list", "warn", "Set a valid Ollama host + port first.");
    setModelFetchStatus("error", "Set a valid Ollama host + port first.");
    return;
  }
  if (fetchModelsInFlight) {
    setModelFetchStatus("info", "Waiting for Ollama...");
    return;
  }
  fetchModelsInFlight = true;
  if (fetchModelsBtn) {
    fetchModelsBtn.disabled = true;
  }
  setModelFetchStatus("info", "Starting model fetch...");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 6000);
  if (fetchModelsWaitingTimer) {
    window.clearTimeout(fetchModelsWaitingTimer);
  }
  fetchModelsWaitingTimer = window.setTimeout(() => {
    if (fetchModelsInFlight) {
      setModelFetchStatus("info", "Waiting for Ollama...");
    }
  }, 250);
  try {
    const response = await apiFetch(
      `/api/ollama-tags?host=${encodeURIComponent(host)}&port=${port}`,
      { signal: controller.signal }
    );
    const payload = await response.json();
    if (payload.ok) {
      ollamaModels = payload.models || [];
      const runningNames = new Set(payload.running_names || []);
      if (ollamaModelInput) {
        const customSelected = ollamaModelInput.value === "__custom__";
        ollamaModelInput.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select a model";
        ollamaModelInput.appendChild(placeholder);
        ollamaModels.forEach((model) => {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = runningNames.has(model) ? `${model} (running)` : model;
          ollamaModelInput.appendChild(option);
        });
        const customOption = document.createElement("option");
        customOption.value = "__custom__";
        customOption.textContent = "Custom…";
        ollamaModelInput.appendChild(customOption);
        if (customSelected) {
          ollamaModelInput.value = "__custom__";
        } else if (ollamaModels.length > 0) {
          ollamaModelInput.value = ollamaModels[0];
        }
      }
      toggleCustomModelInput();
      updateLiveModelLabel();
      let detail = `Loaded ${ollamaModels.length} models.`;
      if (
        Number.isFinite(payload.installed_models) ||
        Number.isFinite(payload.running_models)
      ) {
        const installed = Number(payload.installed_models) || 0;
        const running = Number(payload.running_models) || 0;
        detail = `Loaded ${ollamaModels.length} models (installed: ${installed}, running: ${running}).`;
      }
      addStatus("Model list", "ok", detail);
      setModelFetchStatus("ok", detail);
      return;
    }
    addStatus("Model list", "error", payload.error || "Failed to load models.");
    setModelFetchStatus("error", payload.error || "Failed to load models.");
  } catch (error) {
    if (error && error.name === "AbortError") {
      addStatus("Model list", "error", "Model fetch timed out.");
      setModelFetchStatus("error", "Model fetch timed out.");
    } else {
      addStatus("Model list", "error", "Failed to reach Ollama host.");
      setModelFetchStatus("error", "Failed to reach Ollama host.");
    }
  } finally {
    window.clearTimeout(timeoutId);
    fetchModelsInFlight = false;
    if (fetchModelsBtn) {
      fetchModelsBtn.disabled = false;
    }
    if (fetchModelsWaitingTimer) {
      window.clearTimeout(fetchModelsWaitingTimer);
      fetchModelsWaitingTimer = null;
    }
  }
};

const updatePullStatus = async () => {
  try {
    const response = await apiFetch("/api/ollama-pull-status");
    const payload = await response.json();
    if (!payload.ok) {
      return;
    }
    if (payload.in_progress) {
      pullInFlight = true;
      setPullControls(true);
      const target =
        payload.model && payload.host && payload.port
          ? `${payload.model} on ${payload.host}:${payload.port}`
          : payload.model
            ? payload.model
            : "model";
      let detail = payload.status || `Pulling ${target}…`;
      if (payload.completed && payload.total) {
        const percent = Math.min(
          100,
          Math.round((payload.completed / payload.total) * 100)
        );
        const completedMb = Math.round(payload.completed / 1024 / 1024);
        const totalMb = Math.round(payload.total / 1024 / 1024);
        detail = `${detail} (${percent}% · ${completedMb}MB / ${totalMb}MB)`;
      }
      setModelPullStatus("info", detail);
      if (payload.completed && payload.total) {
        setModelPullProgress(payload.completed, payload.total, false);
      } else {
        setModelPullProgress(0, 100, true);
      }
      if (pullRequested && !pullStatusTimer) {
        pullStatusTimer = window.setInterval(updatePullStatus, 5000);
      }
    } else {
      pullInFlight = false;
      setPullControls(false);
      if (payload.status) {
        setModelPullStatus("", payload.status);
      }
      if (payload.total) {
        setModelPullProgress(payload.total, payload.total, false);
      } else {
        setModelPullProgress(0, 100, false);
      }
      if (pullStatusTimer) {
        window.clearInterval(pullStatusTimer);
        pullStatusTimer = null;
      }
      pullRequested = false;
    }
  } catch (error) {
    // Ignore status fetch failures.
  }
};

const analyzeOnce = async () => {
  if (!armedState) {
    return;
  }
  if (analyzeInFlight) {
    return;
  }

  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  const model = getSelectedModel();
  const prompt = ollamaPromptInput.value.trim();
  const trigger = ollamaTriggerInput.value.trim();
  const timeoutSeconds =
    Number(ollamaTimeoutInput ? ollamaTimeoutInput.value : "") ||
    DEFAULT_TIMEOUT_SECONDS;
  const camerasToMonitor = getMonitoringCameras();

  if (!host || !port || !model || !prompt || camerasToMonitor.length === 0) {
    return;
  }

  analyzeInFlight = true;
  let hadSuccess = false;
  let hadTimeout = false;
  try {
    for (const camera of camerasToMonitor) {
      const streamUrl = camera.streamUrl || "";
      const previewUrl = camera.previewUrl || "";
      const previewMode = camera.previewMode || "mjpeg";
      const cameraLabel = camera.name || camera.model || "Camera";
      const response = await apiFetch("/api/ollama-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          port,
          model,
          prompt,
          trigger,
          timeoutSeconds,
          streamUrl,
          previewUrl,
          previewMode,
          cameraId: camera.id,
          cameraName: camera.name,
          cameraModel: camera.model,
        }),
      });
      const payload = await response.json();
      if (payload.ok) {
        hadSuccess = true;
        if (payload.triggered) {
          alertCount += 1;
          if (statusAlerts) {
            statusAlerts.textContent = `${alertCount} sent`;
          }
          if (alertEmailToggle.checked) {
            const emailResult = await sendEmailAlert({
              event: "fall_detected",
              subject: "Fall Detector Alert",
              responseText: payload.response || "",
              imageBase64: payload.image || "",
              imageType: payload.image_type || "",
              cameraName: camera.name,
              cameraModel: camera.model,
            });
            if (!emailResult.ok) {
              const now = Date.now();
              if (now - lastEmailAlertErrorAt > 30000) {
                addStatus(
                  "Email alert",
                  "error",
                  emailResult.error || "Failed to send email alert."
                );
                lastEmailAlertErrorAt = now;
              }
            } else {
              addStatus("Email alert", "ok", `Email sent for ${cameraLabel}.`);
            }
          }
        }
      } else {
        const message = payload.error || "Ollama analysis failed.";
        const detail = monitorAllCameras
          ? `${cameraLabel}: ${message}`
          : message;
        const now = Date.now();
        if (detail !== lastAnalyzeError || now - lastAnalyzeErrorAt > 30000) {
          addStatus("Ollama analysis", "error", detail);
          lastAnalyzeError = detail;
          lastAnalyzeErrorAt = now;
        }
        if (message.toLowerCase().includes("timed out")) {
          hadTimeout = true;
        }
      }
    }

    if (hadSuccess && statusInference) {
      statusInference.textContent = "Active";
    }
    if (hadSuccess) {
      await fetchResponses();
    }
    if (hadTimeout) {
      consecutiveTimeouts += 1;
    } else if (hadSuccess) {
      consecutiveTimeouts = 0;
    }
    if (consecutiveTimeouts >= 3) {
      stopMonitoring();
      addStatus(
        "Monitoring",
        "warn",
        "Paused after repeated timeouts. Try a smaller model or longer interval."
      );
      if (statusStream) {
        statusStream.textContent = "Paused";
      }
      if (saveArmBtn) {
        saveArmBtn.textContent = "Resume Monitoring";
        saveArmBtn.classList.remove("armed");
      }
      armedState = false;
    } else if (hadTimeout) {
      addStatus(
        "Ollama latency",
        "warn",
        "Inference is slow. Consider a smaller model or longer interval."
      );
    }
  } catch (error) {
    // Ignore transient failures to keep monitoring running.
  } finally {
    analyzeInFlight = false;
  }
};

const startMonitoring = (immediate = true) => {
  if (!armedState) {
    return;
  }
  if (monitorTimer) {
    window.clearInterval(monitorTimer);
  }
  if (immediate) {
    analyzeOnce();
  }
  const intervalSeconds = getInferenceIntervalSeconds();
  monitorTimer = window.setInterval(analyzeOnce, intervalSeconds * 1000);
};

function stopMonitoring() {
  if (monitorTimer) {
    window.clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

const renderResponders = () => {
  respondersList.innerHTML = "";

  if (responders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No responders added yet.";
    respondersList.appendChild(empty);
    schedulePanelRecheck();
    return;
  }

  responders.forEach((responder, index) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    info.innerHTML = `
      <strong>${responder.name}</strong>
      <small>${responder.role || "Responder"}</small>
      <small>${responder.email || "No email"} · ${responder.phone || "No phone"}</small>
    `;

    const remove = document.createElement("button");
    remove.className = "ghost small";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      responders.splice(index, 1);
      renderResponders();
    });

    item.appendChild(info);
    item.appendChild(remove);
    respondersList.appendChild(item);
  });
  schedulePanelRecheck();
};

const resetFields = () => {
  Object.values(fields).forEach((field) => {
    field.value = "";
  });
};

addResponderBtn.addEventListener("click", () => {
  const payload = {
    name: fields.name.value.trim(),
    role: fields.role.value.trim(),
    email: fields.email.value.trim(),
    phone: fields.phone.value.trim(),
  };

  if (!payload.name) {
    fields.name.focus();
    return;
  }

  responders.unshift(payload);
  renderResponders();
  resetFields();
});

clearRespondersBtn.addEventListener("click", () => {
  responders.splice(0, responders.length);
  renderResponders();
});

connectPreviewBtn.addEventListener("click", startPreview);
stopPreviewBtn.addEventListener("click", stopPreview);
overlayPreviewBtn.addEventListener("click", startPreview);
previewModeSelect.addEventListener("change", () => {
  if (streamContainer.classList.contains("active")) {
    startPreview();
  }
});
snapshotIntervalInput.addEventListener("change", syncCaptureInterval);
snapshotIntervalInput.addEventListener("input", syncCaptureInterval);
if (cameraNameInput) {
  cameraNameInput.addEventListener("input", handleCameraFormUpdate);
}
cameraIpInput.addEventListener("input", syncStreamUrl);
if (cameraModelInput) {
  cameraModelInput.addEventListener("input", updateLiveCameraModel);
  cameraModelInput.addEventListener("input", handleCameraFormUpdate);
}
rtspUserInput.addEventListener("input", syncStreamUrl);
rtspPassInput.addEventListener("input", syncStreamUrl);
streamProfileSelect.addEventListener("change", syncStreamUrl);
if (ollamaHostInput) {
  ollamaHostInput.addEventListener("change", scheduleOllamaConnectivityCheck);
  ollamaHostInput.addEventListener("blur", scheduleOllamaConnectivityCheck);
}
if (ollamaPortInput) {
  ollamaPortInput.addEventListener("change", scheduleOllamaConnectivityCheck);
  ollamaPortInput.addEventListener("blur", scheduleOllamaConnectivityCheck);
}
if (previewUrlInput) {
  previewUrlInput.addEventListener("change", schedulePreviewConnectivityCheck);
  previewUrlInput.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (streamUrlInput) {
  streamUrlInput.addEventListener("change", schedulePreviewConnectivityCheck);
  streamUrlInput.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (previewModeSelect) {
  previewModeSelect.addEventListener("change", schedulePreviewConnectivityCheck);
  previewModeSelect.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (rtspUserInput) {
  rtspUserInput.addEventListener("change", schedulePreviewConnectivityCheck);
  rtspUserInput.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (rtspPassInput) {
  rtspPassInput.addEventListener("change", schedulePreviewConnectivityCheck);
  rtspPassInput.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (cameraIpInput) {
  cameraIpInput.addEventListener("change", schedulePreviewConnectivityCheck);
  cameraIpInput.addEventListener("blur", schedulePreviewConnectivityCheck);
}
if (cameraSelect) {
  cameraSelect.addEventListener("change", () => {
    updateActiveCameraFromForm();
    if (cameraSelect.value === "all") {
      monitorAllCameras = true;
      renderCameraSelect();
    } else {
      setActiveCamera(cameraSelect.value);
    }
    schedulePreviewConnectivityCheck();
  });
}
if (addCameraBtn) {
  addCameraBtn.addEventListener("click", () => {
    updateActiveCameraFromForm();
    const newCamera = buildBlankCamera();
    newCamera.name = `Camera ${cameras.length + 1}`;
    cameras.push(newCamera);
    setActiveCamera(newCamera.id);
    renderCameraSelect();
  });
}
if (removeCameraBtn) {
  removeCameraBtn.addEventListener("click", () => {
    if (cameras.length <= 1) {
      return;
    }
    const active = getActiveCamera();
    const label = active && active.name ? active.name : "this camera";
    const ok = window.confirm(`Remove ${label}?`);
    if (!ok) {
      return;
    }
    const index = cameras.findIndex((camera) => camera.id === activeCameraId);
    if (index === -1) {
      return;
    }
    cameras.splice(index, 1);
    const next = cameras[Math.max(0, index - 1)] || cameras[0];
    setActiveCamera(next.id);
    renderCameraSelect();
  });
}
runChecksBtn.addEventListener("click", runChecks);
clearChecksBtn.addEventListener("click", () => {
  clearStatus();
  clearPanelErrors();
});
if (collapseAllBtn) {
  collapseAllBtn.addEventListener("click", collapseAllPanels);
}
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("#collapse-all");
  if (!trigger) {
    return;
  }
  collapseAllPanels();
});
if (minimalModeBtn) {
  minimalModeBtn.addEventListener("click", () => setMinimalMode(true));
}
if (normalModeBtn) {
  normalModeBtn.addEventListener("click", () => setMinimalMode(false));
}
if (testInferenceBtn) {
  testInferenceBtn.addEventListener("click", runInferenceTest);
}
if (testAlertingBtn) {
  testAlertingBtn.addEventListener("click", testAlerting);
}
if (cameraForm) {
  cameraForm.addEventListener("change", () => {
    handleCameraFormUpdate();
    schedulePanelRecheck();
  });
  cameraForm.addEventListener(
    "blur",
    () => {
      handleCameraFormUpdate();
      schedulePanelRecheck();
    },
    true
  );
}
if (ollamaForm) {
  ollamaForm.addEventListener("change", schedulePanelRecheck);
  ollamaForm.addEventListener("blur", schedulePanelRecheck, true);
}
if (alertForm) {
  alertForm.addEventListener("change", schedulePanelRecheck);
  alertForm.addEventListener("blur", schedulePanelRecheck, true);
}
if (respondersForm) {
  respondersForm.addEventListener("change", schedulePanelRecheck);
  respondersForm.addEventListener("blur", schedulePanelRecheck, true);
}
if (statusErrorsOnlyToggle) {
  statusErrorsOnlyToggle.addEventListener("change", applyStatusFilter);
}
if (autoMinimalModeToggle) {
  autoMinimalModeToggle.addEventListener("change", () => {
    setAutoMinimalMode(autoMinimalModeToggle.checked);
  });
}
if (debugValidationBtn) {
  debugValidationBtn.addEventListener("click", () => {
    clearStatus();
    const senderEmail = senderEmailInput.value;
    const gmailUser = gmailUserInput.value;
    const gmailAppPassword = gmailAppPasswordInput.value;
    const details = [
      `Sender email raw: "${senderEmail}"`,
      `Sender email trimmed: "${senderEmail.trim()}"`,
      `Sender valid: ${isValidEmail(senderEmail.trim())}`,
      `Gmail user raw: "${gmailUser}"`,
      `Gmail user trimmed: "${gmailUser.trim()}"`,
      `Gmail user valid: ${isValidEmail(gmailUser.trim())}`,
      `Gmail app password length: ${gmailAppPassword.trim().length}`,
    ];
    details.forEach((line) => addStatus("Validation", "info", line));
  });
}
if (armFeedback) {
  const observer = new MutationObserver(() => {
    const message = armFeedback.textContent.trim();
    if (message === "Fix the highlighted errors before arming.") {
      openStatusPanel();
    }
  });
  observer.observe(armFeedback, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
if (saveArmBtn) {
  saveArmBtn.addEventListener("click", handleSaveArm);
}
if (saveConfigBtn) {
  saveConfigBtn.addEventListener("click", handleSaveConfig);
}
if (disarmBtn) {
  disarmBtn.addEventListener("click", () => {
    setArmedState(false);
    updateServerState(false);
    updatePanelErrors(buildValidationItems());
    addStatus("Disarm", "ok", "Monitoring stopped.");
    updateReadinessState(true);
    if (armFeedback) {
      armFeedback.textContent = "System disarmed.";
      armFeedback.classList.remove("error");
    }
  });
}
if (exportConfigBtn) {
  exportConfigBtn.addEventListener("click", () => {
    const payload = buildConfigPayload();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `fall-detector-config-${timestamp}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addStatus("Export", "ok", `Config downloaded as ${filename}.`);
  });
}
if (importConfigBtn && configFileInput) {
  importConfigBtn.addEventListener("click", () => {
    configFileInput.value = "";
    configFileInput.click();
  });
  configFileInput.addEventListener("change", () => {
    const file = configFileInput.files && configFileInput.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const payload = JSON.parse(text);
        applyConfig(payload);
        saveConfigToServer(payload);
        addStatus("Import", "ok", `Imported configuration from ${file.name}.`);
      } catch (error) {
        addStatus("Import", "error", "Failed to parse configuration file.");
      }
    };
    reader.onerror = () => {
      addStatus("Import", "error", "Failed to read configuration file.");
    };
    reader.readAsText(file);
  });
}
if (filterYesOnly) {
  filterYesOnly.addEventListener("change", renderResponses);
}
if (refreshResponsesBtn) {
  refreshResponsesBtn.addEventListener("click", fetchResponses);
}
if (fetchModelsBtn) {
  fetchModelsBtn.addEventListener("click", fetchModels);
}
if (pullModelBtn) {
  pullModelBtn.addEventListener("click", async () => {
    if (pullInFlight) {
      setModelPullStatus("info", "A model download is already in progress.");
      return;
    }
    const host = ollamaHostInput.value.trim();
    const port = Number(ollamaPortInput.value);
    const model = getSelectedModel();
    if (!host || !(port >= 1 && port <= 65535) || !model) {
      addStatus("Model pull", "warn", "Set host, port, and model first.");
      setModelPullStatus("error", "Missing host, port, or model.");
      return;
    }
    addStatus("Model pull", "info", `Pulling ${model} from Ollama...`);
    setModelPullStatus("info", `Pulling ${model}…`);
    setModelPullProgress(0, 100, true);
    pullInFlight = true;
    setPullControls(true);
    pullRequested = true;
    if (!pullStatusTimer) {
      pullStatusTimer = window.setInterval(updatePullStatus, 5000);
    }
    try {
      const response = await apiFetch("/api/ollama-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, model, stream: true }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json();
        addStatus("Model pull", "error", payload.error || "Model pull failed.");
        setModelPullStatus("error", payload.error || "Model pull failed.");
        setModelPullProgress(0, 100, false);
        pullInFlight = false;
        setPullControls(false);
        if (payload && payload.in_progress) {
          setModelPullStatus("info", payload.status || "Another pull is in progress.");
          setModelPullProgress(payload.completed || 0, payload.total || 100, true);
          pullInFlight = true;
          setPullControls(true);
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastStatus = "";
      let lastProgressText = "";
      let lastBytes = 0;
      let lastBytesAt = 0;
      let smoothRate = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let lineBreak = buffer.indexOf("\n");
        while (lineBreak >= 0) {
          const line = buffer.slice(0, lineBreak).trim();
          buffer = buffer.slice(lineBreak + 1);
          if (line) {
            try {
              const payload = JSON.parse(line);
              if (payload.error) {
                throw new Error(payload.error);
              }
              if (payload.status) {
                lastStatus = payload.status;
                setModelPullStatus("info", payload.status);
              }
              if (payload.completed && payload.total) {
                setModelPullProgress(payload.completed, payload.total, false);
                const percent = Math.min(
                  100,
                  Math.round((payload.completed / payload.total) * 100)
                );
                const completedMb = Math.round(payload.completed / 1024 / 1024);
                const totalMb = Math.round(payload.total / 1024 / 1024);
                const now = Date.now();
                let speedText = " · 0MB/s";
                if (lastBytesAt && payload.completed >= lastBytes) {
                  const elapsedSec = (now - lastBytesAt) / 1000;
                  if (elapsedSec > 0) {
                    const rate = (payload.completed - lastBytes) / elapsedSec;
                    const alpha = 0.2;
                    smoothRate = smoothRate === null ? rate : alpha * rate + (1 - alpha) * smoothRate;
                    const rateMb = Math.round(smoothRate / 1024 / 1024);
                    speedText = ` · ${rateMb}MB/s`;
                  }
                }
                lastBytes = payload.completed;
                lastBytesAt = now;
                lastProgressText = `${percent}% · ${completedMb}MB / ${totalMb}MB${speedText}`;
                if (lastStatus) {
                  setModelPullStatus("info", `${lastStatus} (${lastProgressText})`);
                } else {
                  setModelPullStatus("info", `Downloading… ${lastProgressText}`);
                }
              }
            } catch (error) {
              throw error;
            }
          }
          lineBreak = buffer.indexOf("\n");
        }
      }
      if (lastStatus) {
        const message = lastProgressText
          ? `${lastStatus} (${lastProgressText})`
          : lastStatus;
        addStatus("Model pull", "ok", message);
        setModelPullStatus("ok", message);
      } else {
        addStatus("Model pull", "ok", "Pull complete.");
        setModelPullStatus("ok", "Pull complete.");
      }
      setModelPullProgress(100, 100, false);
      await fetchModels();
    } catch (error) {
      addStatus("Model pull", "error", "Failed to reach Ollama host.");
      setModelPullStatus("error", "Failed to reach Ollama host.");
      setModelPullProgress(0, 100, false);
    } finally {
      pullInFlight = false;
      setPullControls(false);
      if (!pullStatusTimer) {
        pullRequested = false;
      }
    }
  });
}
if (cancelPullBtn) {
  cancelPullBtn.addEventListener("click", async () => {
    if (!pullInFlight) {
      setModelPullStatus("info", "No model download is currently running.");
      return;
    }
    const model = getSelectedModel() || "this model";
    const ok = window.confirm(`Cancel downloading ${model}?`);
    if (!ok) {
      return;
    }
    setModelPullStatus("info", "Cancelling download…");
    try {
      const response = await apiFetch("/api/ollama-pull-cancel", { method: "POST" });
      const payload = await response.json();
      if (payload.ok) {
        addStatus("Model pull", "warn", payload.message || "Pull cancelled.");
        setModelPullStatus("error", payload.message || "Pull cancelled.");
        setModelPullProgress(0, 100, false);
        pullInFlight = false;
        setPullControls(false);
        if (pullStatusTimer) {
          window.clearInterval(pullStatusTimer);
          pullStatusTimer = null;
        }
        pullRequested = false;
      } else {
        addStatus("Model pull", "error", payload.error || "Cancel failed.");
        setModelPullStatus("error", payload.error || "Cancel failed.");
      }
    } catch (error) {
      addStatus("Model pull", "error", "Failed to reach Ollama host.");
      setModelPullStatus("error", "Failed to reach Ollama host.");
    }
  });
}
if (ollamaModelInput) {
  ollamaModelInput.addEventListener("change", toggleCustomModelInput);
}
if (ollamaCustomInput) {
  ollamaCustomInput.addEventListener("input", updateLiveModelLabel);
}

beginSession();
localStorage.removeItem("fallDetectorConfig");
initializeCameraState();
const storedMinimalMode = localStorage.getItem("fallDetectorMinimalMode");
minimalModePreference = storedMinimalMode === "true";
const storedAutoMinimalMode = localStorage.getItem("fallDetectorAutoMinimalMode");
if (storedAutoMinimalMode !== null) {
  autoMinimalMode = storedAutoMinimalMode === "true";
}
if (autoMinimalModeToggle) {
  autoMinimalModeToggle.checked = autoMinimalMode;
}

renderResponders();
syncCaptureInterval();
syncStreamUrl();
updateLiveCameraModel();
updateLiveModelLabel();
setArmedState(armedState);
setMinimalMode(minimalModePreference, false);
fetchResponses();
toggleCustomModelInput();
setModelPullStatus("", "Idle.");
setModelPullProgress(0, 100, false);
setPullControls(false);
updatePullStatus();
if (ollamaIntervalInput) {
  const intervalValue = Number(ollamaIntervalInput.value);
  if (!Number.isFinite(intervalValue) || intervalValue <= 0) {
    const timeoutValue = Number(ollamaTimeoutInput ? ollamaTimeoutInput.value : "");
    if (Number.isFinite(timeoutValue) && timeoutValue > 0) {
      ollamaIntervalInput.value = timeoutValue;
    }
  }
}
if (ollamaHostInput && ollamaPortInput) {
  const host = ollamaHostInput.value.trim();
  const port = Number(ollamaPortInput.value);
  if (host && port >= 1 && port <= 65535) {
    fetchModels();
  }
}
