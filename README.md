# attendance-overtime-approval-bot

一個 Claude Code 的 skill：依標準政策檢查並自動核准 classic-ASP 內部人資
差勤系統裡待簽的加班/請假申請。完整政策與流程請見 [`SKILL.md`](SKILL.md)
——這份 README 說明安裝設定與專案整體結構。

**這是一份去識別化過的範本**，原本是為某家公司內部系統打造的實際運作
skill，公司名稱、網址、任何個人姓名/工號都已經替換成 placeholder
（`ATTENDANCE_BASE_URL` 等環境變數）或整個移除。`check-queues.js` 裡對
頁面結構的理解（frame 名稱、表格欄位、按鈕文字、confirm 對話框的文字）
是針對那一套系統的 classic-ASP frameset 結構寫的；請把這個 repo 當成
「做法」的完整範例——用 Playwright 直接操作 DOM，取代截圖 + 滑鼠模擬
——而不是拿來就能直接套用的成品。細節見 `SKILL.md` 的「Adapting this to
your own system」段落。

## 為什麼要這樣做

差勤系統沒有 API，也沒有現代化的認證機制（只有 session cookie，classic
ASP frameset 架構）。早期版本是從 WSL 用 PowerShell 模擬滑鼠操作使用者
實際的 Windows Edge 瀏覽器，靠截圖 + 視覺辨識讀取畫面狀態——能動，但截圖
很貴（一般解析度下每張約 2,700 tokens），而且靠像素座標點擊很脆弱（視窗
一移動或縮放就壞掉）。

現在的做法（`playwright/`）是在 **WSL 裡面**跑一個獨立的 headless
Chromium，透過 Playwright 操作，用複製出來的 session cookie 認證，而不是
碰使用者正在用的瀏覽器。直接讀 DOM——多數情況下不用截圖、不用抓像素座標、
不耗費視覺 token。原本的滑鼠模擬做法保留在 `SKILL.md` 裡當作 Playwright
或已存的登入 session 失效時的備援方案。

## 目錄結構

```
SKILL.md                    完整政策 + 執行流程（先看這個）
白名單.md.example            白名單格式範例（真正的 白名單.md 已加入 .gitignore — 見下方）
scripts/                    從 WSL 透過 PowerShell 呼叫的 Windows 端輔助腳本
  click.sh, right-click.sh    滑鼠模擬（備援路徑用）
  send-keys.sh                 SendKeys 語法的按鍵模擬
  screenshot.sh                 對 Windows 桌面截圖
  get-title.sh / get-clipboard.sh   讀取視窗標題 / 剪貼簿（短/長內容分開處理）
  set-clipboard.sh              寫入 Windows 剪貼簿
  minimize-terminal.sh          截圖前先把終端機視窗縮到最小
playwright/                 主要自動化程式（見下方）
```

## `playwright/` 安裝設定

```bash
cd playwright
npm install
node -e "require('playwright').chromium" # 確認套件能正常載入

# Chromium 需要的共用函式庫（libnspr4, libnss3, libasound2t64, libasound2-data）
# 系統上不一定都有裝。如果你有 sudo 權限：
npx playwright install --with-deps chromium

# 如果沒有 sudo（這個專案當初就是在沒有 sudo 的情況下建置的），
# 參考 playwright/localdeps/README.md 裡不需要 root 權限的解法
# （用 `apt-get download` + `dpkg-deb -x`）。playwright/env.js 會自動把
# LD_LIBRARY_PATH 指過去——只要 localdeps/root/ 有東西，其他都不用管。
```

### 設定

執行任何指令前先設定這些環境變數（例如寫進 shell profile，或每次指令前
面加上）：

| 變數 | 用在哪裡 | 用途 |
|---|---|---|
| `ATTENDANCE_BASE_URL` | `check-queues.js`、`login-once.js`、`probe.js`、`probe2.js` | 例如 `https://attendance.example.com`——結尾不要加斜線 |
| `ATTENDANCE_DOMAIN` | `build-storage-state-from-cookie.js` | 例如 `attendance.example.com`——只要主機名稱，用來限定 cookie 的作用範圍 |

另外把 `白名單.md.example` 複製成 `白名單.md`（已加入 .gitignore），填入
白名單自動核准佇列要用的真實姓名。

### 取得已登入的 session（`playwright/auth/storage_state.json`）

這個檔案存有 session cookie，**已加入 .gitignore，絕對不要 commit**。
有兩種方式可以建立/更新它，依推薦順序：

1. **`node login-once.js`** — 開一個*看得到*的 Chromium 視窗（Windows 上
   透過 WSLg 顯示，Linux 桌面則透過 X server），指向登入頁，最長等待 5
   分鐘讓你手動登入。一旦偵測到跳轉到 `mainback.asp`，就會自動存檔到
   `auth/storage_state.json`。需要真正的鍵盤滑鼠操作一個 GUI 視窗。

2. **`node build-storage-state-from-cookie.js '<cookie 字串>'`** — 如果
   你手邊已經有登入過差勤系統的瀏覽器，直接從那個 session 抓
   `document.cookie`（例如用 bookmarklet——確切用法見 `SKILL.md` 的
   「Session refresh」段落）餵進去。比較快，但要當成任何「跟憑證沾邊」的
   捷徑一樣謹慎：只在你明確決定要做的時候才動手，不要當成背景/自動化步驟。

### 執行

```bash
node check-queues.js
```
## 這個js 透過playwright 存取瀏覽器DOM，完成LLM交辦的任務，並且回報給LLM。

登入已存的 session、依序檢查三個佇列，並且**在回傳結果前就已經執行完**
標準政策的核准動作（不是預演/dry run）——確切政策內容見
[`SKILL.md`](SKILL.md)。會先印出人類可讀的過程紀錄，最後一行印出
`RESULT_JSON:{...}`——呼叫端應該解析這最後一行，前面的紀錄只是輔助除錯用。

要核准白名單以外、單次授權的加班單（不是永久修改白名單）：

```bash
EXTRA_APPROVE_NAMES="某某人,某某人2" node check-queues.js
```

假單簽核政策上完全沒有白名單，核准一律要單次明確指名（用另一個獨立的環境
變數，跟加班單分開）：

```bash
EXTRA_APPROVE_LEAVE_NAMES="某某人" node check-queues.js
```

## 安全注意事項

- `playwright/auth/storage_state.json` 含有真實的 session cookie，已加入
  .gitignore，請保持這樣。當成密碼一樣看待。
- `白名單.md` 含有真實同事姓名/工號，已加入 .gitignore。把
  `白名單.md.example` 複製成 `白名單.md` 並填入真實資料——這個檔案本身
  不會被 git 追蹤。
- 上面提到的 cookie 擷取捷徑（方式 2）會從已登入的瀏覽器讀取真實的
  session 憑證。這應該是每次都經過使用者明確授權的動作，不該讓程式在
  背景/自動狀態下悄悄執行。
- 這套工具會實際執行不可逆的人資/薪資相關動作（核准他人的加班/請假）。
  授權模式細節見 `SKILL.md` 的「Standing policy」與「Before doing
  anything」段落。

## 環境需求

- WSL2（或 Linux）+ Node.js
- 若要用備援的滑鼠模擬路徑：需要能從 WSL 透過 `powershell.exe` 存取的
  Windows 主機，且目標網站已在 Edge 開啟
