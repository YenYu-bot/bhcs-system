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

## 小森靈獸（課堂加分 × 本命靈獸）

`beasts.html`（老師／主管）＋ `beast.html?t=<token>`（學生 QR，無登入、唯讀）。同一個 Firebase 專案、同一組老師帳號、同一份 `classes` 名單。設定文件（規則與數值）：<https://claude.ai/artifact/DvcTpCWrMjF71RCzrwxoVy>。

| 檔案 | 內容 |
|---|---|
| `js/beast-core.js` | 12 境界門檻、12 靈獸、道具、預設設定、上限／倍率／境界計算（純函式，可單獨測） |
| `js/beasts.js` | 老師端：課堂加分、懲罰、試煉、商店、換獸、任務與靈石、全班目標、護山管家、投影模式、主管設定／報表、名人堂 |
| `js/beast-view.js` | 學生頁 |
| `js/vendor/qr.js` | 自寫 QR 產生器（版本 1–6，夠放學生連結） |
| `assets/beasts/` | 系統用圖：512×512 透明 PNG（256 色量化，每張約 50–100 KB）。找不到 PNG 時自動用同名 `*.svg` 佔位圖（`python3 tools/make-beast-placeholders.py` 重新產生） |
| `assets/beasts-src/v2/` | **現行**：ChatGPT 產出的透明等寬分格圖（日系可愛風）。放進來後執行 `python3 tools/split-beast-sheets.py --v2 assets/beasts-src/v2` 切圖、量化 |
| `assets/beasts-src/v1/` | 第一版寫實水墨風原稿（含受驚 24 張），已淘汰：30 隻排成一班時太吵。留作參考，`split-beast-sheets.py`（不帶 `--v2`）可重切 |

| 集合 | 內容 |
|---|---|
| `beastConfig/main` | 主管設定：加分原因、扣分原因、上限、倍率、道具價格、現實獎勵、管家預設、境界門檻。缺的欄位用 `DEFAULT_CONFIG` |
| `beasts/{token}` | 一個學生一隻（以姓名 `nameKey` 跨班共用）：`beast, petName, realm, pts, stones, weekKey, weekPts, weekStones, weekBuys, courseCount, swapUsed, trials{lv:true}, trialFailAt{lv:ts}, items{}, cosmetics[], julingActive, hall`。`token` 同時是 QR 連結鑰匙，規則只開 `get` 不開列舉 |
| `beasts/{token}/log/{id}` | `{ ts, type, delta, stones, reason, by, byName, classId, className, undone }`；`type` = new／pts／penalty／stones／buy／item／trial／swap／goal／realm／undo |
| `beastTasks/{id}` | 任務：`{ title, stones, kind(once/daily/weekly), scope(class/students), students[], deadline, classId, teacherId, awarded{nameKey:[key]} }` |
| `beastClass/{classId}` | `goal{text, weekKey, doneWeek, blockedWeek}`、`issued{weekKey, total}`（本週靈石發放額）、`steward{on, strikes, lastStrikeAt, scaredUntil, scaredLevel, paused}`、`stats{YYYY-MM:{ptsIssued, stonesIssued, stonesSpent, penaltyPts, penaltyStones}}`（報表直接讀，不用 collectionGroup 索引） |

規則摘要（細節都在 `beast-core.js`，數值可在主管「設定」頁改）：

- 靈獸綁姓名不綁班；課程數 = 該姓名出現在幾個班（`classes.students`）；同名學生請在名單加後綴區分。
- 每週上限：靈氣 25、靈石入帳 40、持有 200（單門課）；2 門 ×1.5、3 門以上 ×1.8；週一 00:00（台灣）重置，第一次寫入時自動歸零。
- 境界只升不降；老師扣靈氣最多扣到當前境界門檻。第 4／7／10／12 境要老師在學生面板按「試煉通過」，失敗冷卻 7 天（破境丹可當場重試）。
- 靈石只能從任務拿（單一任務 ≤ 20；每班每週總額 = 人數 × 30），只能在補習班由老師操作購買。聚靈丹每週限購 1 顆。
- 管家：麥克風只算音量不錄音；同節課第 1 次超標警告、第 2 次全班「受驚」10 分鐘（中級：加分減半、無條件進位；重級：再取消本週全班目標）；安靜 10 分鐘歸零。管家只在開啟它的那台裝置偵測，狀態寫 `beastClass` 讓投影／手機同步。
- 撤銷：當天內、自己的紀錄（主管可撤所有人）；只有 pts／penalty／stones／goal 可撤。

**部署**：(1) `firestore.rules` 全文重新貼到 Firebase 主控台並發布；(2) 改了 css/ 或 js/ 執行 `python3 tools/bump-version.py`。

**圖片檔名**（共 119 張，v2 已全部到位。ChatGPT 產出的分格圖存成 `01-qinglong.png`…`12-bastet.png`、`s01-qinglong.png`…（受驚）、`13-badges.png`、`14-steward.png`、`15-items.png` 放進 `assets/beasts-src/v2/` 再跑切圖工具）：

| 檔名 | 張數 | 說明 |
|---|---|---|
| `{key}-{1..4}.png` | 48 | 12 隻 × 4 階。`key` = qinglong 青龍、zhuque 朱雀、qilin 麒麟、jiuwei 九尾狐、orochi 八岐大蛇、baku 夢貘、angel 小天使、mermaid 人魚、unicorn 獨角獸、griffin 獅鷲、fenrir 芬里爾、bastet 巴斯特貓 |
| `{key}-{1..4}-scared.png` | 48 | 受驚態（管家懲罰時顯示）；某隻還沒有就退回一般圖加灰階抖動 |
| `steward-{1..3}.png` | 3 | 護山管家：平時／警告／懲罰 |
| `realm-{1..12}.png` | 12 | 境界徽章（目前 UI 未使用，預留） |
| `item-{stone,dingxin,pojing,juling,xisui,rename,hat,real}.png` | 8 | 道具圖示（目前 UI 未使用，預留） |

加分、進化、招式橫幅都是 CSS 動畫；受驚有專屬圖，抖動是 CSS。

## 測試

Playwright 無頭瀏覽器 + Firebase 假件（`test/mocks/`），不會碰真的 Firebase。

```bash
npm i -D playwright && npx playwright install chromium   # 第一次
npm test                                                  # 全部：node test/run-all.js
node test/contacts-admin.test.js                          # 單一檔
```

- `beasts`：小森靈獸全流程（選獸、加分、上限、試煉、任務發放、商店、懲罰、撤銷、全班目標、設定、學生頁）
- `auth`：主管建立、老師新增／重設／刪除、改密碼提醒、備援主管、忘記密碼
- `journal`：班級、填日誌、歷史、停課申請、主管所有日誌
- `contacts-teacher` / `contacts-admin`：電訪表老師端與主管端全部流程
- `period`：電訪週期與跨年
- `migration`：舊系統搬遷
- `pdf-import`：真實點名表 PDF，需要把 PDF 放到 `test/fixtures/roster.pdf`（含個資，已 gitignore）；沒有會自動略過。連不到 CDN 的環境可設 `PDFJS_DIR=<pdfjs-dist/build>` 用本機 pdf.js。

**Firestore 規則沒有自動測試**（需要 Firebase 模擬器）。改規則後請用老師帳號實測：填日誌、改歷史、班級增改刪、停課申請、抽查上傳、電訪新增／編輯、新增學生。舊規則在 `firestore.rules.prev`。
