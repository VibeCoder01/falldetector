# Fall Detector Control Room

Local control room UI for monitoring a Tapo camera stream and running
fall-detection analysis via Ollama. Includes Gmail alert delivery with inline
snapshot images.

## Features

- RTSP + MJPEG preview options with snapshot polling.
- Ollama model selection, inference scheduling, and response history.
- Gmail alerts with inline images and AI assessment text.
- Local config save/load + export/import to JSON.

## Project Structure

- `server.py`: Local HTTP server + Ollama proxy + Gmail alert sender.
- `web/`: Frontend UI (HTML/CSS/JS).
- `assets/`: Static assets (reserved).
- `tests/`: Tests (reserved).

## Requirements

- Python 3.10+ (tested on 3.12).
- `opencv-python` for RTSP snapshot capture.
- Gmail account with an App Password (2FA enabled).

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Open `http://localhost:8000` in your browser.

## Gmail Alerts

1. In Google Account Security, enable 2‑step verification and generate an
   App Password for SMTP.
2. In the UI, enter:
   - Gmail account email
   - Gmail app password
   - Sender email (can match your Gmail address)
3. Add at least one responder email.
4. Click **Save & Arm** to start monitoring.

Emails include the AI assessment text plus the snapshot image inline.

## Configuration

- **Save** stores config in localStorage.
- **Export Config** downloads a JSON file.
- **Import Config** restores settings from a JSON file.

## Usage Tips

- Use the **Status & Checks** panel to validate inputs and test connectivity.
- **Run inference now** sends a single inference request and, if triggered,
  sends an email alert.
- **Save & Arm** starts continuous monitoring on the configured interval.
- **Disarm** stops monitoring.

## Security Notes

- Do not commit real Gmail app passwords or private IPs to source control.
- Treat exported config files as sensitive if they contain credentials.

## License

MIT License. See `LICENSE`.
