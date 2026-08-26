---
name: attendance-overtime-approval-bot
description: This skill should be used when the user asks to approve, sign off, or batch-approve pending overtime requests ("加班單簽核", "簽核加班單", "核准加班", "approve overtime forms") in a classic-ASP attendance system via the browser. Template/example skill — fill in your own organization's URL (see `ATTENDANCE_BASE_URL` below) and whitelist before use.
version: 2.0.0
---

# 差勤系統 - 加班單批量簽核

Checks the "預定加班單簽核" / "加班單簽核" / "假單簽核" lists in your
organization's classic-ASP attendance system and approves pending rows per
the standing policy below, then reports results.

This was built against one specific company's internal attendance system
(URLs/company name scrubbed for this public template — see "Adapting this
to your own system" below), so the page structure, column layout, and Chinese
UI strings in this skill are tailored to that system. Treat it as a worked
example of the approach (Playwright DOM automation instead of screenshots)
rather than something that works unmodified against a different system.

**Primary method: Playwright**, driving a headless Chromium running inside
WSL (see `playwright/`), reading the DOM directly — no screenshots, no
vision tokens, no pixel coordinates. Falls back to Windows mouse-simulation
+ browser bookmarklets (see "Fallback procedure" below) only if Playwright
or the saved login session is unavailable.

## Adapting this to your own system

1. Copy `白名單.md.example` → `白名單.md` and fill in real names (gitignored,
   never committed).
2. Set `ATTENDANCE_BASE_URL` (and `ATTENDANCE_DOMAIN` for the cookie-based
   session refresh path) to your system's URL — see `playwright/*.js` for
   where these are read, and `README.md` for the full env var list.
3. The DOM selectors in `check-queues.js` (frame names `header`/`main`,
   table headers `姓名`/`工號`, button text `存檔`, the confirm-dialog
   message match) are specific to the classic-ASP frameset structure this
   was built against — re-run `playwright/probe.js` / `probe2.js` style
   exploration against your own system and adjust accordingly.

## Standing policy (set by the user, applies to every run)

- **預定加班單簽核**: auto-approve all pending rows directly, with no
  per-run confirmation needed.
- **夜點津貼簽核** and **異常簽核**: skip these two queues entirely — do not
  check or report on them anymore.
- **假單簽核**: still check-only. List pending rows to the user; do not
  approve without the user's separate explicit authorization in that turn.
- **加班單簽核** (post-hoc): check every row's 姓名 against
  `白名單.md` (same directory as this file). Auto-approve rows whose
  requester is on the whitelist, with no per-run confirmation. Rows for
  anyone NOT on the whitelist remain check-only: list them to the user and
  wait for separate explicit authorization before approving. Report which
  rows were auto-approved (whitelist match) vs. which are still pending
  confirmation.
- **Every report to the user must include the current time** (e.g. `date`).
  This applies to every check result, whether pending items were found or
  not — including "目前無待簽差勤" replies.

## Before doing anything (for lists other than 預定加班單簽核)

This performs a real, hard-to-reverse HR/payroll action (approving someone's
overtime/leave). For any list not covered by the standing policy above,
confirm before approving, unless the user has already stated it in the
current request:

1. **Which list**?
2. **Review or blind-approve** — does the user want the pending rows listed
   for confirmation first, or approve all without reviewing content?

Do not assume "approve all" carries over to lists outside the standing
policy — ask again unless the current message already says so explicitly.

The point where authorization matters shifted with the Playwright rewrite:
there's no per-click classifier gate anymore (see "Why Playwright" below),
so **running `check-queues.js` at all** is the authorization checkpoint —
only run it when the user's current message matches an already-established
trigger (e.g. "執行 attendance-overtime-approval-bot skill..."), not on a
timer or autonomously without a user-initiated ask in that turn.

## Procedure (Playwright — primary)

All commands run from `playwright/` (relative to this file).

1. **Run the check**:
   ```
   cd playwright && node check-queues.js
   ```
   This single script does everything: logs into the saved session, visits
   all three queues, reads pending rows via DOM (no screenshots), and
   *already performs* the standing-policy approvals (預定加班單簽核 auto,
   加班單簽核 whitelist subset) before it returns — this is not a dry run.
   It prints a human-readable log, then a final `RESULT_JSON:{...}` line.
   Parse that JSON line for the structured result; use the log lines above
   it only for extra debugging color.

2. **If `RESULT_JSON` contains `"error":"SESSION_EXPIRED"` or the script
   throws**: the saved login session (`playwright/auth/storage_state.json`)
   is no longer valid. See "Session refresh" below — do not fall back to
   mouse-simulation just because of this; refreshing the session is usually
   faster.

3. **Report to the user** per the standing policy, from the JSON: which
   queue had how many pending rows, which were auto-approved (name/id/date/
   time/事由), which are still awaiting the user's explicit go-ahead
   (假單簽核 rows, and non-whitelist 加班單簽核 rows), and the current time.

4. **Optional sanity screenshot** — for the first live run after any code
   change to `check-queues.js`'s approve path (radio-checking / 存檔 /
   confirm-dialog logic), or any run where something felt off, it's fine to
   take one `scripts/screenshot.sh` afterward to visually confirm the queue
   is now empty / rows disappeared as expected. Not required once that path
   is trusted again — the script's own JSON result should already reflect
   what happened.

## Session refresh (when storage_state.json expires)

Two ways to get a fresh `playwright/auth/storage_state.json`, in order of
preference:

**A. Extract cookies from the user's already-logged-in Edge** (fast, no
typing required) — **but this reads live session credentials out of the
user's browser, so treat it like any other irreversible/sensitive action:
explain what you're about to do and get the user's explicit go-ahead in
that turn before doing it**, same as the safety-gate spirit below.
1. Confirm the attendance-system tab in the user's Edge is actually logged
   in (`scripts/screenshot.sh` and look for the 工號/姓名 box top-left, not
   a login form).
2. Add/edit a favorites-bar bookmark (via `edge://favorites/` → 新增我的最愛
   — typing into that dialog's URL field is not blocked by the omnibox's
   paste-strips-`javascript:` protection the way pasting directly into the
   address bar is) whose URL is:
   ```
   javascript:(function(){navigator.clipboard.writeText(document.cookie).then(function(){document.title='COOKIE_COPIED◆';},function(err){document.title='COPY_FAIL:'+err+'◆';});})();
   ```
3. Click that bookmark on the attendance-system tab, confirm via `scripts/get-title.sh`
   that the title became `COOKIE_COPIED◆`, then read the cookie string with
   `scripts/get-clipboard.sh` (NOT get-title.sh — the cookie string is too
   long for the window-title buffer and will be silently truncated).
4. `cd playwright && node build-storage-state-from-cookie.js '<cookie string>'`

**B. Full interactive login** (`playwright/login-once.js`) — needed if (A)
fails (e.g. Edge session also expired) or the user prefers it:
1. Run `node login-once.js` in the background — it launches a *visible*
   Chromium (via WSLg, shows on the Windows desktop) and waits up to 5
   minutes.
2. Tell the user to interact with that window and log in by hand — this
   needs actual keyboard/mouse input into a GUI window, so the user must be
   physically at the machine or connected via RDP/remote-desktop from
   elsewhere. A "!" chat command cannot do this (no TTY/GUI access), and
   neither can Claude.
3. Once the user logs in, the script auto-detects the navigation to
   `mainback.asp`, saves `storage_state.json`, and exits on its own — no
   further action needed from Claude.
4. If the user says they can't do this right now (away from the machine, no
   RDP available), don't block on it — fall back to (A) if the existing
   Edge session is still alive, or tell the user clearly what's blocked and
   wait.

## Why Playwright, and what changed from the old mouse-sim approach

There's no DOM-level browser automation from *Windows Edge* available in
this environment, so instead this skill runs its own separate, independent
Chromium **inside WSL** (via `playwright/`), authenticated with a copy of
the session cookie rather than a fresh interactive login every time. This
never touches the user's actual Edge window — no relaunching it, no closing
their other tabs, no CDP debug-port exposure.

Chromium's shared libraries (`libnspr4`, `libnss3`, `libasound2t64`,
`libasound2-data`) aren't installed system-wide on this WSL distro and there
is no interactive sudo in this session to `apt install` them. They were
obtained without root via `apt-get download` + `dpkg-deb -x` into
`playwright/localdeps/` (see that dir's README), and `playwright/env.js`
points `LD_LIBRARY_PATH` there. If a future session *does* have sudo, a
proper `npx playwright install-deps chromium` makes `localdeps/`
unnecessary (but it's harmless to leave in place).

**Irreversibility still applies.** check-queues.js performs real
approvals — there's no Claude Code classifier gate on individual DOM clicks
the way there was on individual mouse-simulation clicks, so the discipline
that gate used to enforce now has to come from *when this script gets run*:
only on a current, explicit user trigger matching the standing policy (see
"Before doing anything" above), never speculatively or on a schedule
without a fresh ask.

## Fallback procedure (mouse-simulation + bookmarklets)

Use this only if Playwright is broken, `storage_state.json` can't be
refreshed by either method above, or the user explicitly asks for the old
approach. This drives the actual Windows Edge via PowerShell mouse
simulation from WSL (`scripts/click.sh`, `scripts/send-keys.sh`, etc.) and
depends on two saved favorites-bar bookmarklets, "讀取清單" and "自動簽核"
(top-level on the bar, not inside a folder).

### Safety gate

Claude Code's auto-mode classifier may block the first click attempt
because it's an irreversible action on a production system — this is
expected, not a bug. If blocked:

- Do **not** try to work around it via another tool.
- Tell the user exactly what click/action was blocked and why.
- Only retry after the user explicitly authorizes it in that turn.

### Coordinates are NOT stable — always re-derive them from a fresh screenshot

Window position, tab count, and screen resolution can differ between runs.
Never hardcode pixel coordinates from a past run. Every run must screenshot
first, read the image, and compute row/button coordinates from what's
actually on screen this time.

### Steps

1. **Minimize anything covering the browser**: `scripts/minimize-terminal.sh`

2. **Screenshot and find the browser tab** for your attendance system. If
   not open: `powershell.exe -NoProfile -Command "Start-Process
   '<your-attendance-system-url>/mainback.asp'"`, then click **預定加班單簽核**
   / **加班單簽核** / **假單簽核** in the left sidebar (locate coordinates
   from the screenshot each time), screenshot again to confirm.

3. **Check whether the queue has pending rows without a screenshot**: show
   the favorites bar if needed (`scripts/send-keys.sh '^+b'`), click **讀取清單**
   directly on the bar, read the result with `scripts/get-title.sh`:
   - `LIST:NOHEADER◆...` or `LIST:EMPTY◆...` → empty, nothing to do, move on.
   - `LIST:<N>:<name1>,<id1>|...◆...` → N pending rows with 姓名,工號.
     Enough for the whitelist check or to report names, but not full detail
     (dates/times/事由/時數) or click coordinates — proceed to step 4 for
     that.
   - Anything else (stale text, empty, window not focused) → don't guess,
     screenshot instead.

4. **If there are pending rows, screenshot to read full detail.** Columns
   left to right: 簽核 (radio), 駁回 (radio), 姓名, 工號, 起始日期, 起始時間,
   截止日期, 截止時間, 事由, 已申請加班時數. Report rows to the user first
   if they asked to review; wait for confirmation before continuing.

5. **Select every 簽核 radio and submit**:
   - **預定加班單簽核**: click **自動簽核** directly on the favorites bar —
     selects all 簽核 radios and submits immediately (no separate 存檔/確定
     click needed, skip to step 8).
   - Otherwise: click the 簽核 radio for each row to approve via
     `scripts/click.sh <x> <row_y>` (rows ~24-25px apart, radio in the first
     column).

6. **Screenshot again and verify** every intended row shows 簽核 filled (●)
   before saving; re-click any that didn't take.

7. **Click 存檔** (`scripts/click.sh <save_x> <save_y>`), then a native
   confirm dialog appears ("是否確定將勾選的資料存檔..??") — screenshot to
   locate **確定** and click it.

8. **Screenshot once more to verify success** — table should now be empty
   with no error banner. Report which rows were approved.

### Failure modes

- Click landed wrong (table shifted, extra row appeared) → re-screenshot,
  don't keep clicking blind based on stale coordinates.
- Confirm dialog didn't appear after 存檔 → screenshot to check for a
  validation error instead.
- Session appears logged out (redirected to login page) → this is the
  regular idle-timeout case, not a failure: click **回主頁**, the 登入 form
  reappears with 工號/密碼 already autofilled by Edge's saved credentials —
  click **登入** and continue. Don't stop and ask for this specific case.
- "讀取清單" / "自動簽核" bookmarklet not found on the bar (profile changed,
  bookmark moved/deleted) → fall back to screenshot / manual radio clicking,
  don't spend time recreating the bookmark mid-run.
