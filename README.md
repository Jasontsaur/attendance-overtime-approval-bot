# attendance-overtime-approval-bot

A Claude Code skill that checks and auto-approves pending overtime/leave
requests in a classic-ASP internal HR attendance system, per a standing
policy. See [`SKILL.md`](SKILL.md) for the full policy and procedure — this
README covers setup and the general shape of the project.

**This is a scrubbed template**, extracted from a working skill built
against one specific company's internal system — the company name, URL, and
any personal names/IDs have been replaced with placeholders (`ATTENDANCE_BASE_URL`
etc.) or removed. The page-structure knowledge baked into `check-queues.js`
(frame names, table headers, button text, confirm-dialog wording) is
specific to that one system's classic-ASP frameset layout; treat this as a
worked example of the *approach* — Playwright DOM automation instead of
screenshots + mouse-simulation — rather than a drop-in tool. See
`SKILL.md`'s "Adapting this to your own system" section.

## Why this exists

The attendance system has no API and no modern auth (session cookies only,
classic ASP framesets). Early iterations drove the user's actual Windows
Edge browser via PowerShell mouse-simulation from WSL and read state by
screenshotting + vision — functional, but screenshots are expensive
(~2,700 tokens each at typical resolution) and coordinate-based clicking is
fragile (breaks if the window moves or resizes).

The current approach (`playwright/`) runs an independent, headless Chromium
**inside WSL** via Playwright, authenticated with a copy of the session
cookie rather than the user's live browser. It reads the DOM directly — no
screenshots, no pixel coordinates, no vision tokens for the common case.
The original mouse-simulation approach is kept as a documented fallback in
`SKILL.md` for when Playwright or the saved session is unavailable.

## Layout

```
SKILL.md                    Full policy + procedure (read this first)
白名單.md.example            Whitelist format example (real 白名單.md is gitignored — see below)
scripts/                    Windows-side helpers invoked from WSL via PowerShell
  click.sh, right-click.sh    mouse simulation (fallback path)
  send-keys.sh                 SendKeys-syntax keystrokes
  screenshot.sh                 screenshot the Windows desktop
  get-title.sh / get-clipboard.sh   read window title / clipboard (short vs. long payloads)
  set-clipboard.sh              write to Windows clipboard
  minimize-terminal.sh          get the terminal out of the way before screenshotting
playwright/                 Primary automation (see below)
```

## `playwright/` setup

```bash
cd playwright
npm install
node -e "require('playwright').chromium" # sanity check the package resolves

# Chromium's shared libs (libnspr4, libnss3, libasound2t64, libasound2-data)
# aren't always present system-wide. If you have sudo:
npx playwright install --with-deps chromium

# If you DON'T have sudo (this project was built without it), see
# playwright/localdeps/README.md for a root-free workaround using
# `apt-get download` + `dpkg-deb -x`. playwright/env.js wires up
# LD_LIBRARY_PATH to find those automatically — nothing else needed once
# localdeps/root/ is populated.
```

### Configuration

Set these before running anything (e.g. export them in your shell profile,
or prefix each command):

| Variable | Used by | Purpose |
|---|---|---|
| `ATTENDANCE_BASE_URL` | `check-queues.js`, `login-once.js`, `probe.js`, `probe2.js` | e.g. `https://attendance.example.com` — no trailing slash |
| `ATTENDANCE_DOMAIN` | `build-storage-state-from-cookie.js` | e.g. `attendance.example.com` — hostname only, used to scope the cookie |

Also copy `白名單.md.example` → `白名單.md` (gitignored) and fill in real
names for the whitelist-based auto-approve queue.

### Getting a logged-in session (`playwright/auth/storage_state.json`)

This file holds session cookies and is **gitignored — never commit it**.
Two ways to create/refresh it, in order of preference:

1. **`node login-once.js`** — launches a *visible* Chromium (via WSLg on
   Windows hosts, or your desktop's X server on Linux) pointed at the login
   page, and waits (up to 5 min) for you to log in by hand. Once it detects
   navigation to `mainback.asp`, it saves `auth/storage_state.json`
   automatically. Needs real keyboard/mouse input into a GUI window.

2. **`node build-storage-state-from-cookie.js '<cookie string>'`** — if you
   already have a browser logged into the site, grab `document.cookie`
   from that session (e.g. via a bookmarklet — see the "Session refresh"
   section in `SKILL.md` for the exact one used) and feed it in directly.
   Faster, but treat it like any credential-adjacent shortcut: only do this
   deliberately, not as a background/automatic step.

### Running it

```bash
node check-queues.js
```

Logs into the saved session, visits all three queues, and **performs** the
standing-policy approvals before returning (not a dry run) — see
[`SKILL.md`](SKILL.md) for exactly what that policy is. Prints a
human-readable log followed by a final `RESULT_JSON:{...}` line meant to be
parsed by the caller.

For a one-off approval outside the standing whitelist (explicit per-run
authorization, not a permanent whitelist change):

```bash
EXTRA_APPROVE_NAMES="某某人,某某人2" node check-queues.js
```

## Security notes

- `playwright/auth/storage_state.json` contains live session cookies.
  Gitignored; keep it that way. Treat it like a password.
- `白名單.md` contains real coworker names/employee IDs and is gitignored.
  Copy `白名單.md.example` to `白名單.md` and fill in real data locally —
  it stays untracked.
- The cookie-extraction shortcut (option 2 above) reads session credentials
  out of a live, already-authenticated browser. It's a deliberate,
  user-authorized action each time — not something a script should do
  silently or automatically.
- This automates real, largely irreversible HR/payroll actions
  (approving someone's overtime/leave). See `SKILL.md`'s "Standing policy"
  and "Before doing anything" sections for the authorization model.

## Requirements

- WSL2 (or Linux) with Node.js
- For the fallback mouse-simulation path: a Windows host reachable via
  `powershell.exe` from WSL, with the target site open in Edge
