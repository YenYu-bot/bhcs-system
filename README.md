# 百宏文教 · 教室日誌與電訪表（bhcs-system）

靜態站、零建置工具：`index.html`（版面）＋ `css/app.css` ＋ `js/app.js`（核心與教室日誌）＋ `js/contacts.js`（電訪表，從 app.js import 共用物件）。Firebase 專案 `bhcs-system`，使用 Firestore + Authentication（電子郵件/密碼）。

**改了 css/ 或 js/ 之後**執行 `python3 tools/bump-version.py`（或 `npm run bump`）更新 `index.html` 的 `?v=` 版本號，否則瀏覽器可能用舊快取。
前身為 `bhcs-journal`（無 Auth、規則全開），本專案把帳號改為 Firebase Auth，並新增電訪表。

## 首次部署

1. **Firebase 主控台**
   - Firestore Database：建立（asia-east1、正式版模式）。
   - Authentication → 登入方法：啟用「電子郵件/密碼」。
   - Authentication → 設定 → 已授權網域：加入 `yenyu-bot.github.io`。
   - Firestore Database → 規則：把 [`firestore.rules`](firestore.rules) 全文貼上 → 發布。
2. **GitHub Pages**：repo Settings → Pages → Source 選 `main` / root → 等網址生效（`https://yenyu-bot.github.io/bhcs-system/`）。
3. 開啟網站 → 登入頁下方「首次使用？建立主管帳號」→ 設定主管密碼（帳號固定 `admin`）。
4. 主管登入 → ⚙️ 帳號管理 → 「🔁 從舊系統搬遷資料」→ 填老師初始密碼 → 開始搬遷。
   搬完後舊專案 `bhcs-journal` 的規則請改成全鎖（`allow read, write: if false;`）。

## 帳號制度

| 集合 | 內容 |
|---|---|
| Auth 使用者 | 老師 `{userId}@bhcs.local`，主管 `admin@bhcs.local`（合成信箱，不會寄信） |
| `teachers/{uid}` | `{ userId, name, authEmail }`，沒有密碼 |
| `logins/{userId}` | `{ authEmail, uid }`，登入前查帳號用，規則只開單筆 get |
| `admins/{uid}` | 備援主管帳號（真實 Email 建立），可在登入頁直接用 Email 登入、忘記密碼可收重設信 |

- 老師／主管登入後可按「🔑 改密碼」。主管新增／重設／搬遷的老師帳號登入時會「提醒」改密碼（`teachers.mustChangePassword`，不強迫，可稍後再說或不再提醒）；帳號管理有「提醒全部老師改密碼」。
- 主管密碼忘了：用備援主管帳號（帳號管理 → 備援主管帳號）登入，或登入頁「忘記密碼？」寄重設信到該 Email。主要帳號 `admin@bhcs.local` 收不到信。
- 主管「重設密碼」會為該老師換一個新的 Auth 使用者（前端無法改別人的密碼）；舊登入因失去 `teachers` 文件而失效。想清掉舊使用者可到 Firebase 主控台 Authentication 刪除。
- 刪除老師只刪 `teachers` / `logins` 文件，Auth 使用者同樣失效。

## 電訪表

| 集合 | 內容 |
|---|---|
| `ctStudents/{id}` | `{ name, phones[], english, sourceClasses[], teacherIds[], active }` — 一個學生可配多位老師 |
| `contacts/{id}` | `{ studentId, studentName, teacherId, teacherName, date, method, callee, content, followUp, nextDate, flag, flagResolvedAt }` — `flag` = 需主管關注；顯示時學生姓名一律從 `ctStudents` 即時取 |
| `ctSnapshots/{id}` | 匯入名冊前自動保存的整份名冊（保留最近 3 份），可在匯入頁一鍵還原 |

- 老師端只看得到 `teacherIds` 含自己的學生、只讀寫自己的紀錄（由 `firestore.rules` 強制）。
- 主管端：未填回報（每個老師×學生配對在期間內至少一筆）、配對矩陣、紀錄瀏覽／匯出（CSV、列印版）、從點名表 PDF 匯入名冊（pdf.js 於瀏覽器端解析；也可貼文字）。
- 名冊合併規則：姓名相同且至少一支電話相同視為同一人；同名不同電話另建一筆並標示「同名」。有電訪紀錄的學生不能刪除（請用停用或合併重複）。
- 「未接通」不算完成一次電訪（`CT_COUNT_NOANSWER = false`，網站與 GAS 一致），卡片會顯示已嘗試次數。
- 主管端 `contacts` 預設只載入最近 3 期（`CT_ADMIN_PERIODS`），選更早的月份或按「全部」才補撈；旗標紀錄一律載入。老師端資料有 60 秒快取，右上 🔄 可強制重撈。
- LINE 推播失敗通知：`dailyCheck` 出錯會推錯誤到 LINE 並寄 Email（指令碼屬性 `ALERT_EMAIL`，沒設就寄給執行者）；`healthCheck` 每晚 23:30 檢查當天是否成功，沒成功就提醒。`installTrigger` 會同時裝兩個觸發器。
- 電訪週期：每月 11 日起算、次月 10 日截止（「10 月份」= 10/11～11/10，「12 月份」= 12/11～隔年 1/10）。網站與 `gas/Code.gs` 共用常數 `CT_CYCLE_START_DAY = 11`，要改兩邊一起改。LINE 每晚推播當期進度，週一、四與截止前 5 天列出未填學生姓名。

## 測試

Playwright 無頭瀏覽器 + Firebase 假件（`test/mocks/`），不會碰真的 Firebase。

```bash
npm i -D playwright && npx playwright install chromium   # 第一次
npm test                                                  # 全部：node test/run-all.js
node test/contacts-admin.test.js                          # 單一檔
```

- `auth`：主管建立、老師新增／重設／刪除、改密碼提醒、備援主管、忘記密碼
- `journal`：班級、填日誌、歷史、停課申請、主管所有日誌
- `contacts-teacher` / `contacts-admin`：電訪表老師端與主管端全部流程
- `period`：電訪週期與跨年
- `migration`：舊系統搬遷
- `pdf-import`：真實點名表 PDF，需要把 PDF 放到 `test/fixtures/roster.pdf`（含個資，已 gitignore）；沒有會自動略過。連不到 CDN 的環境可設 `PDFJS_DIR=<pdfjs-dist/build>` 用本機 pdf.js。

**Firestore 規則沒有自動測試**（需要 Firebase 模擬器）。改規則後請用老師帳號實測：填日誌、改歷史、班級增改刪、停課申請、抽查上傳、電訪新增／編輯、新增學生。舊規則在 `firestore.rules.prev`。
