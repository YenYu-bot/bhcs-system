# 百宏文教 · 教室日誌與電訪表（bhcs-system）

單一 `index.html`、零建置工具。Firebase 專案 `bhcs-system`，使用 Firestore + Authentication（電子郵件/密碼）。
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

- 老師／主管登入後可按「🔑 改密碼」。
- 主管「重設密碼」會為該老師換一個新的 Auth 使用者（前端無法改別人的密碼）；舊登入因失去 `teachers` 文件而失效。想清掉舊使用者可到 Firebase 主控台 Authentication 刪除。
- 刪除老師只刪 `teachers` / `logins` 文件，Auth 使用者同樣失效。

## 電訪表

| 集合 | 內容 |
|---|---|
| `ctStudents/{id}` | `{ name, phones[], english, sourceClasses[], teacherIds[], active }` — 一個學生可配多位老師 |
| `contacts/{id}` | `{ studentId, studentName, teacherId, teacherName, date, method, callee, content, followUp, nextDate }` |

- 老師端只看得到 `teacherIds` 含自己的學生、只讀寫自己的紀錄（由 `firestore.rules` 強制）。
- 主管端：未填回報（每個老師×學生配對在期間內至少一筆）、配對矩陣、紀錄瀏覽／匯出（CSV、列印版）、從點名表 PDF 匯入名冊（pdf.js 於瀏覽器端解析；也可貼文字）。
- 名冊合併規則：姓名相同且至少一支電話相同視為同一人；同名不同電話另建一筆並標示「同名」。
- 電訪週期：每月 11 日起算、次月 10 日截止（「10 月份」= 10/11～11/10，「12 月份」= 12/11～隔年 1/10）。網站與 `gas/Code.gs` 共用常數 `CT_CYCLE_START_DAY = 11`，要改兩邊一起改。LINE 每晚推播當期進度，週一、四與截止前 5 天列出未填學生姓名。
