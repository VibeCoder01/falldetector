# Repository Guidelines

This repository is currently a clean slate: there are no tracked source files, build scripts, or tests yet. Use this guide as the starting point for adding structure and standards as the project takes shape for a Python + HTML/CSS/JS stack.

## Project Structure & Module Organization

- Place backend application code under `src/`.
- Keep frontend files in `web/` (e.g., `web/index.html`, `web/styles/`, `web/scripts/`).
- Keep tests in a top-level `tests/` directory (e.g., `tests/test_*.py`).
- Put static assets in `assets/` (images, models, configs).
- Add documentation under `docs/` when needed.

## Build, Test, and Development Commands

No build or test commands are defined yet. When you add tooling, document the exact commands here. Example patterns:

- `python -m venv .venv` and `source .venv/bin/activate` for a local virtual environment
- `pip install -r requirements.txt` to install backend dependencies
- `python server.py` to run the SPA + API proxy locally
- `python -m pytest` for unit tests
- `python -m http.server -d web 8000` to serve the frontend locally

## Coding Style & Naming Conventions

No linting or formatting tools are configured yet. If you add them, note the exact rules here. Recommended baseline:

- Python: 4-space indentation, `snake_case` for modules/functions, `PascalCase` for classes.
- HTML/CSS/JS: 2-space indentation, `kebab-case` for CSS classes, `camelCase` for JS.
- Configure formatters/linters (e.g., `black`, `ruff`, `prettier`, `eslint`) and run them before commits.

## Testing Guidelines

Testing frameworks are not configured yet. When added, document:

- Framework name (e.g., `pytest` for Python, `vitest` or `jest` for JS)
- Test file naming (e.g., `test_*.py`, `*.spec.js`)
- How to run the full suite and a single test

## Commit & Pull Request Guidelines

No commit message conventions are available because there is no Git history. When a history exists, summarize any patterns and enforce them. For now:

- Use clear, imperative subject lines (e.g., "Add fall event parser").
- Include a short description and testing notes in PRs.
- Link related issues and attach screenshots for UI changes.

## Security & Configuration Tips

If you add secrets or environment configuration, store them in `.env` files that are excluded from version control and document required variables in `docs/config.md`.
