// 百宏文教 · 電訪表模組（家長電訪）
// 依賴 js/app.js 的共用物件（Firestore、登入狀態、UI 工具）；對外函式掛在 window.*。
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { authErrMsg, cacheFresh, cacheMark, currentUser, db, downloadCSV, esc, hideLoading, showLoading, showToast, teachers, todayISO } from "./app.js";

// ══════════════════════════════════════════════════════════════
// 📞 電訪表 (PARENT CONTACT LOG)
// ══════════════════════════════════════════════════════════════
// Firestore collections:
//   ctStudents/{id} : { name, phones[], english, sourceClasses[], teacherIds[], active, createdAt, updatedAt }
//                     電訪的單位是「老師 × 學生」配對；一個學生可配多位老師（teacherIds）
//   contacts/{id}   : { studentId, studentName, teacherId, teacherName, date(ISO), method, callee,
//                       content, followUp, nextDate, savedAt, lastEditedBy, lastEditedName }
// 規則：老師只能讀 teacherIds 含自己的學生、只能讀寫自己的 contacts；名冊與配對只有主管能改。
// ──────────────────────────────────────────────────────────────
let ctStudents      = [];   // admin: 全部（含停用）；teacher: 配對給我的
let ctContacts      = [];   // admin: 全部；teacher: 我的
let ctOpenStudentId = null; // teacher 端展開的學生
let ctAdminSection  = 'missing';
let ctImportPages   = [];   // 匯入預覽 [{className, teacherName, teacherId, students:[{name, phones, english, include}]}]
let _pdfjs          = null;

const CT_METHODS = { phone:'電話', line:'LINE', inperson:'面談', noanswer:'未接通' };
// 「未接通」算不算完成一次電訪？false = 不算（仍會顯示嘗試次數）。※ GAS 推播腳本有同一個常數，兩邊要一致。
const CT_COUNT_NOANSWER = false;
function ctCounts(c) { return CT_COUNT_NOANSWER || c.method !== 'noanswer'; }
// 期間內是否完成（至少一筆算數的紀錄）；嘗試次數（含未接通）
function ctDoneIn(list, from, to) { return list.some(c => c.date >= from && c.date <= to && ctCounts(c)); }
function ctTriesIn(list, from, to) { return list.filter(c => c.date >= from && c.date <= to).length; }
// 學生姓名一律從名冊即時取（改名後舊紀錄也會跟著變），名冊找不到才用紀錄裡的快照
function ctNameOf(c) { return ctStudents.find(x => x._id === c.studentId)?.name || c.studentName || ''; }
const CT_FLAG_LABEL = '🚩 需主管關注';
const CT_CALLEES = ['母親','父親','祖父母','其他'];

// ── 電訪週期 ──
// 每月 CT_CYCLE_START_DAY 日開始新一期，到次月 (CT_CYCLE_START_DAY-1) 日截止。
//   例：「10月份」= 10/11 ～ 11/10；「12月份」= 12/11 ～ 隔年 1/10。
//   ※ GAS 推播腳本 gas/Code.gs 有同一個常數，兩邊要一致。
const CT_CYCLE_START_DAY = 11;
const pad2 = n => String(n).padStart(2,'0');
// 'YYYY-MM'（期別）→ [from, to]；當期則 to 取今天（統計用）；要完整截止日用 ctPeriodBounds
function ctPeriodBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return [`${y}-${pad2(m)}-${pad2(CT_CYCLE_START_DAY)}`, `${ny}-${pad2(nm)}-${pad2(CT_CYCLE_START_DAY - 1)}`];
}
// 某個日期屬於哪一期（'YYYY-MM'）
function ctPeriodYm(iso) {
  const y = Number(iso.slice(0,4)), m = Number(iso.slice(5,7)), d = Number(iso.slice(8,10));
  let pm = d >= CT_CYCLE_START_DAY ? m : m - 1, py = y;
  if (pm < 1) { pm = 12; py--; }
  return `${py}-${pad2(pm)}`;
}
let ctTeacherMonth = ctPeriodYm(todayISO());
function ctMonthRangeOf(ym) {
  const t = todayISO();
  if (!ym) ym = ctPeriodYm(t);
  const [from, to] = ctPeriodBounds(ym);
  return [from, (from <= t && t < to) ? t : to];   // 當期：迄日取今天；過去或未來的期別：完整區間
}
function ctMonthRange() { return ctMonthRangeOf(ctTeacherMonth); }
function ctMonthLabel(ym) {
  if (!ym) return '';
  const [from, to] = ctPeriodBounds(ym);
  const md = d => `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`;
  return `${ym.slice(0,4)} 年 ${Number(ym.slice(5,7))} 月份（${md(from)}～${md(to)}）`;
}
// 把 input[type=month] 的值套到起迄日期欄；空值＝不限
function ctApplyMonth(monthId, fromId, toId, cb) {
  const ym = document.getElementById(monthId).value;
  const [from, to] = ym ? ctMonthRangeOf(ym) : ['', ''];
  document.getElementById(fromId).value = from;
  document.getElementById(toId).value   = to;
  ctRunWithRange(from, cb);
}
// 主管端：範圍超出已載入的部分就先補撈再渲染
function ctRunWithRange(from, cb) {
  if (!currentUser?.isAdmin || !cb) { if (cb) cb(); return; }
  const need = from || '';
  if (ctLoadedFrom === '' || (ctLoadedFrom !== null && need && need >= ctLoadedFrom)) { cb(); return; }
  showLoading('載入更早的紀錄...');
  ctEnsureContactsFrom(need).then(() => { hideLoading(); ctUpdateFlagBadge(); cb(); })
    .catch(e => { hideLoading(); showToast('❌ '+authErrMsg(e),'error'); });
}
window.ctRunWithRange = ctRunWithRange;
window.ctApplyMonth = ctApplyMonth;
window.ctShiftMonth = function(monthId, delta, fromId, toId, cb) {
  const el = document.getElementById(monthId);
  const ym = el.value || ctPeriodYm(todayISO());
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  el.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
  ctApplyMonth(monthId, fromId, toId, cb);
};
window.ctSetTeacherMonth = function(delta) {
  const el = document.getElementById('ctTeacherMonth');
  if (delta) {
    const [y, m] = (el.value || ctTeacherMonth).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    el.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
  }
  ctTeacherMonth = el.value || ctPeriodYm(todayISO());
  const [from, to] = ctMonthRange();
  document.getElementById('ctExpFrom').value = from;
  document.getElementById('ctExpTo').value   = to;
  ctRenderTeacherList();
};
function ctActiveStudents() { return ctStudents.filter(s => s.active !== false); }
function ctTeacherName(id) { return teachers.find(t => t.userId === id)?.name || id; }
function ctPhoneLinks(phones) {
  return (phones||[]).map(p => `<a href="tel:${esc(p)}" onclick="event.stopPropagation()" style="color:var(--teal);text-decoration:none;margin-right:10px;white-space:nowrap">📱 ${esc(p)}</a>`).join('') || '<span style="color:var(--muted)">（無電話）</span>';
}
function ctSortContacts(list) {
  return list.sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.savedAt||0) - (a.savedAt||0));
}
function ctSetDefaultRange(fromId, toId) {
  const [from, to] = ctMonthRange();
  const f = document.getElementById(fromId), t = document.getElementById(toId);
  if (f && !f.value) f.value = from;
  if (t && !t.value) t.value = to;
}

// ── 點名表解析（純函式）──
function ctNormPhone(s) {
  const d = String(s||'').replace(/\D/g,'');
  return (d.length >= 8 && d.length <= 10) ? d : '';
}
function ctIsCJK(s) { return /[一-鿿]/.test(s); }
function ctExtractPhones(str, out) {
  String(str||'').split(/[\s,，、/]+/).forEach(tok => {
    const p = ctNormPhone(tok);
    if (p) { if (!out.includes(p)) out.push(p); return; }
    (tok.match(/0\d{8,9}/g) || []).forEach(m => { if (!out.includes(m)) out.push(m); });
  });
}
// 把同一列裡被切開的字串接回來：x 幾乎相連就直接黏、否則用空白分隔
function ctJoinLine(items) {
  const sorted = items.slice().sort((p,q) => p.x - q.x);
  let s = '', lastEnd = null;
  sorted.forEach(o => {
    const gap = lastEnd == null ? 0 : o.x - lastEnd;
    s += (lastEnd != null && gap > 2 ? ' ' : '') + o.str;
    lastEnd = o.x + (o.w || o.str.length * 5);
  });
  return s;
}
// items: [{str, x, y, w?}]  y 方向不限
function ctParseRosterPage(items) {
  const it = items.map(o => ({ str:String(o.str||'').trim(), x:+o.x, y:+o.y, w:+o.w||0 })).filter(o => o.str);
  const find = re => it.find(o => re.test(o.str));
  const hName  = find(/^中文/);
  const hEng   = find(/^英文/);
  const hPhone = find(/^聯絡/);
  const hDay   = find(/^月$/);
  if (!hName || !hPhone) return null;
  const nameX  = hName.x - 8;
  const engX   = hEng ? hEng.x - 8 : hPhone.x - 8;
  const phoneX = hPhone.x - 8;
  const dayX   = hDay ? hDay.x - 2 : Infinity;

  const headerLine = anchorRe => {
    const a = find(anchorRe); if (!a) return '';
    return it.filter(o => Math.abs(o.y - a.y) < 8).sort((p,q) => p.x - q.x).map(o => o.str).join(' ');
  };
  const pick = (line, re) => { const m = line.match(re); return m ? m[1].trim() : ''; };
  const className   = pick(headerLine(/^班別/),     /班別[:：]?\s*([^\s]+)/);
  // jretc 偶爾多印一個右括號：「五年級(二))」→「五年級(二)」
  let classNameFixed = className;
  while (classNameFixed.endsWith(')') && (classNameFixed.match(/\)/g)||[]).length > (classNameFixed.match(/\(/g)||[]).length) classNameFixed = classNameFixed.slice(0, -1);
  const teacherName = pick(headerLine(/^教師姓名/), /教師姓名[:：]?\s*([^\s]+)/);
  const dateRange   = pick(headerLine(/^起迄/),     /起迄日期[:：]?\s*([0-9\/~～\-]+)/);

  const serials = it.filter(o => /^\d{1,2}$/.test(o.str) && o.x < nameX).sort((p,q) => p.y - q.y);
  const students = [];
  serials.forEach((s, i) => {
    const prev = serials[i-1], next = serials[i+1];
    const up   = prev ? Math.abs(s.y - prev.y)/2 : (next ? Math.abs(next.y - s.y)/2 : 11);
    const down = next ? Math.abs(next.y - s.y)/2 : up;
    const half = Math.max(up, down) * 0.98;
    const row  = it.filter(o => o !== s && Math.abs(o.y - s.y) <= half && o.x >= nameX && o.x < dayX);
    const name = row.filter(o => o.x < engX && ctIsCJK(o.str)).sort((p,q) => p.x - q.x).map(o => o.str).join('');
    const eng  = row.filter(o => o.x >= engX && o.x < phoneX && !ctIsCJK(o.str) && !/^[\d\-() ]+$/.test(o.str)).map(o => o.str).join(' ');
    // 電話欄：先依 y 分行，再把每行接回完整字串
    const phoneItems = row.filter(o => o.x >= phoneX).sort((p,q) => p.y - q.y);
    const lines = [];
    phoneItems.forEach(o => {
      const last = lines[lines.length-1];
      if (last && Math.abs(o.y - last[0].y) < 4) last.push(o); else lines.push([o]);
    });
    const phones = [];
    lines.forEach(l => ctExtractPhones(ctJoinLine(l), phones));
    if (name) students.push({ seq:parseInt(s.str,10), name, english:eng, phones });
  });
  students.sort((a,b) => a.seq - b.seq);
  return { className:classNameFixed, teacherName, dateRange, students };
}
// 純文字備援：每行「姓名 電話 電話」
function ctParseRosterText(text) {
  const students = [];
  String(text||'').split(/\r?\n/).forEach(line => {
    const toks = line.trim().split(/[\s,，、\t]+/).filter(Boolean);
    if (!toks.length) return;
    const name = toks.find(t => ctIsCJK(t) && !/^\d/.test(t));
    if (!name) return;
    const phones = [];
    toks.forEach(t => ctExtractPhones(t, phones));
    students.push({ seq:students.length+1, name:name.replace(/^\d+[.、]?/,''), english:'', phones });
  });
  return { className:'', teacherName:'', dateRange:'', students };
}
async function ctPdfjs() {
  if (_pdfjs) return _pdfjs;
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/';
  const mod  = await import(base + 'pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  _pdfjs = mod;
  return mod;
}
async function ctPdfPages(file) {
  const pdfjs = await ctPdfjs();
  const pdf   = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc   = await page.getTextContent();
    const items = tc.items.filter(x => x.str && x.str.trim())
      .map(x => ({ str:x.str, x:x.transform[4], y:x.transform[5], w:x.width }));
    const r = ctParseRosterPage(items);
    if (r && r.students.length) pages.push(r);
  }
  return pages;
}

// ── 電訪表單（老師與主管共用）──
window.ctOpenForm = function(studentId, contactId) {
  const c = contactId ? ctContacts.find(x => x._id === contactId) : null;
  const s = ctStudents.find(x => x._id === (studentId || c?.studentId));
  if (!s && !c) return;
  const g = id => document.getElementById(id);
  g('ctModalTitle').textContent = (c ? '✏️ 編輯電訪：' : '📞 新增電訪：') + (s?.name || c?.studentName || '');
  g('ctModalSub').innerHTML = s ? ctPhoneLinks(s.phones) : '';
  g('ctfStudentId').value = s?._id || c?.studentId || '';
  g('ctfContactId').value = c?._id || '';
  g('ctfDate').value      = c?.date || todayISO();
  g('ctfMethod').value    = c?.method || 'phone';
  g('ctfCallee').value    = c?.callee || CT_CALLEES[0];
  g('ctfContent').value   = c?.content || '';
  g('ctfFollowUp').value  = c?.followUp || '';
  g('ctfNextDate').value  = c?.nextDate || '';
  g('ctfFlag').checked    = !!c?.flag;
  g('ctModal').classList.add('show');
  setTimeout(() => g('ctfContent').focus(), 50);
};
window.ctCloseForm = function() { document.getElementById('ctModal').classList.remove('show'); };
window.ctSaveContact = async function() {
  const g = id => document.getElementById(id);
  const studentId = g('ctfStudentId').value, contactId = g('ctfContactId').value;
  const date = g('ctfDate').value, content = g('ctfContent').value.trim();
  if (!date)    { showToast('請選擇日期','error'); return; }
  if (!content) { showToast('請填寫溝通內容','error'); return; }
  const s = ctStudents.find(x => x._id === studentId);
  const c = contactId ? ctContacts.find(x => x._id === contactId) : null;
  const data = {
    studentId, studentName: s?.name || c?.studentName || '',
    teacherId:   c?.teacherId   || currentUser.id,
    teacherName: c?.teacherName || currentUser.name,
    date, method: g('ctfMethod').value, callee: g('ctfCallee').value,
    content, followUp: g('ctfFollowUp').value.trim(), nextDate: g('ctfNextDate').value,
    flag: g('ctfFlag').checked,
    savedAt: Date.now()
  };
  // 重新勾選「需主管關注」時清掉之前的已處理標記；取消勾選也清掉
  if (!c?.flag || !data.flag) { data.flagResolvedAt = null; data.flagResolvedBy = ''; }
  showLoading('儲存中...');
  try {
    if (contactId) {
      data.lastEditedBy = currentUser.id; data.lastEditedName = currentUser.name;
      await updateDoc(doc(db,'contacts',contactId), data);
    } else {
      await addDoc(collection(db,'contacts'), data);
    }
    showToast('☁️ 電訪已儲存');
    ctCloseForm();
    await ctReload();
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
};
window.ctDeleteContact = async function(id) {
  const c = ctContacts.find(x => x._id === id); if (!c) return;
  if (!confirm(`刪除 ${c.date} 對「${ctNameOf(c)}」的電訪紀錄？`)) return;
  showLoading('刪除中...');
  try { await deleteDoc(doc(db,'contacts',id)); showToast('🗑 已刪除'); await ctReload(); }
  catch(e) { showToast('❌ '+authErrMsg(e),'error'); }
  hideLoading();
};
async function ctReload() {
  if (currentUser?.isAdmin) { await ctAdminLoad(true); ctAdminSwitch(ctAdminSection); }
  else { await ctLoadMine(true); ctRenderTeacherList(); }
}

function ctHistoryHtml(list, canEdit, showTeacher) {
  if (!list.length) return '<div style="font-size:12px;color:var(--muted);margin-top:10px">尚無電訪紀錄</div>';
  let lastYm = '';
  return `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:4px">` + list.map(c => {
    const ym = c.date ? ctPeriodYm(c.date) : '';
    const head = ym !== lastYm ? `<div style="font-size:11px;font-weight:700;color:var(--purple);letter-spacing:1px;margin:8px 0 2px">${esc(ctMonthLabel(ym))}</div>` : '';
    lastYm = ym;
    return head + `
    <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <div><b>${esc(c.date)}</b>
          <span class="tag ${c.method==='noanswer'?'tag-orange':'tag-blue'}" style="margin-left:4px">${esc(CT_METHODS[c.method]||c.method||'')}${c.method==='noanswer'&&!CT_COUNT_NOANSWER?'（不計）':''}</span>
          ${c.callee ? `<span class="tag tag-purple">${esc(c.callee)}</span>` : ''}
          ${c.flag ? `<span class="tag ${c.flagResolvedAt?'tag-green':'tag-red'}">${c.flagResolvedAt?'✓ 主管已處理':'🚩 需主管關注'}</span>` : ''}
          ${showTeacher ? `<span style="color:var(--muted);font-size:11px;margin-left:4px">${esc(c.teacherName||c.teacherId)}</span>` : ''}
        </div>
        ${canEdit ? `<div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="ctOpenForm('${c.studentId}','${c._id}')">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="ctDeleteContact('${c._id}')">🗑</button></div>` : ''}
      </div>
      <div style="white-space:pre-wrap;margin-top:4px;line-height:1.6">${esc(c.content)}</div>
      ${c.followUp ? `<div style="color:var(--yellow);margin-top:4px">📌 待追蹤：${esc(c.followUp)}</div>` : ''}
      ${c.nextDate ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">下次聯絡：${esc(c.nextDate)}</div>` : ''}
    </div>`; }).join('') + '</div>';
}

// ── 老師端 ──
async function ctLoadMine(force) {
  if (!force && cacheFresh('ct')) return;
  const [ss, cs] = await Promise.all([
    getDocs(query(collection(db,'ctStudents'), where('teacherIds','array-contains',currentUser.id))),
    getDocs(query(collection(db,'contacts'),   where('teacherId','==',currentUser.id)))
  ]);
  ctStudents = ss.docs.map(d => ({_id:d.id, ...d.data()})).filter(s => s.active !== false);
  ctContacts = ctSortContacts(cs.docs.map(d => ({_id:d.id, ...d.data()})));
  cacheMark('ct');
}
window.renderTeacherContacts = async function() {
  const mEl = document.getElementById('ctTeacherMonth');
  if (!mEl.value) { mEl.value = ctPeriodYm(todayISO()); ctTeacherMonth = mEl.value; const [f,t] = ctMonthRange(); document.getElementById('ctExpFrom').value = f; document.getElementById('ctExpTo').value = t; }
  const box = document.getElementById('ctTeacherList');
  box.innerHTML = '<div class="empty"><div>載入中...</div></div>';
  try { await ctLoadMine(); } catch(e) { box.innerHTML = `<div class="empty"><div>❌ ${esc(authErrMsg(e))}</div></div>`; console.error(e); return; }
  ctRenderTeacherList();
};
let ctTeacherFilter = 'all';
window.ctSetTeacherFilter = function(f) {
  ctTeacherFilter = f;
  document.getElementById('ctFilterAll').className     = 'btn btn-sm ' + (f === 'all'     ? 'btn-purple' : 'btn-ghost');
  document.getElementById('ctFilterMissing').className = 'btn btn-sm ' + (f === 'missing' ? 'btn-purple' : 'btn-ghost');
  ctRenderTeacherList();
};
window.ctRenderTeacherList = function() {
  const q = (document.getElementById('ctSearch').value || '').trim();
  const [from, to] = ctMonthRange();
  const isDone = s => ctDoneIn(ctContacts.filter(c => c.studentId === s._id), from, to);
  const all = ctStudents.filter(s => !q || s.name.includes(q) || (s.sourceClasses||[]).some(c => c.includes(q)));
  const list = all
    .filter(s => ctTeacherFilter !== 'missing' || !isDone(s))
    .sort((a,b) => (isDone(a) - isDone(b)) || a.name.localeCompare(b.name));   // 未填排前面
  // 依「我教這位學生的班別」分組（classTeachers: 班別 → 老師）；
  // 沒有紀錄的（舊資料或主管手動配對）放到最後一組，並顯示全部班別
  const groups = {};
  list.forEach(s => {
    const mine = Object.entries(s.classTeachers||{}).filter(([,t]) => t === currentUser.id).map(([c]) => c);
    const g = mine.length ? mine.join('、') : '未標示班別';
    (groups[g] ||= []).push(s);
  });
  const groupKeys = Object.keys(groups).sort((a,b) => (a==='未標示班別') - (b==='未標示班別') || a.localeCompare(b));
  const done = all.filter(isDone).length;
  const isCur = ctTeacherMonth === ctPeriodYm(todayISO());
  const [, dueDate] = ctPeriodBounds(ctTeacherMonth);
  const daysLeft = Math.round((new Date(dueDate) - new Date(todayISO())) / 86400000);
  document.getElementById('ctTeacherSummary').innerHTML =
    `${isCur ? '本期' : ''}${ctMonthLabel(ctTeacherMonth)}${isCur ? (daysLeft === 0 ? '　<b style="color:var(--red)">⏰ 今天截止</b>' : `　距截止 ${daysLeft} 天`) : ''}<br>已電訪 <b style="color:${done===all.length&&all.length?'var(--teal)':'var(--yellow)'}">${done}</b> / ${all.length} 位${all.length-done?`　<span style="color:var(--red)">未填 ${all.length-done}</span>`:''}`;
  document.getElementById('ctTeacherList').innerHTML = groupKeys.map(g => { const arr = groups[g]; return `
    <div style="font-size:12px;font-weight:700;color:var(--muted);margin:14px 0 8px;letter-spacing:1px">${esc(g)}（${arr.length}）</div>
    ${arr.map(s => ctStudentCard(s, from, to, g === '未標示班別')).join('')}`; }).join('')
    || (all.length ? '<div class="empty"><div class="empty-icon">🎉</div><div>本期全部完成</div></div>'
                   : '<div class="empty"><div class="empty-icon">📞</div><div>尚未配對任何學生，請聯絡主管</div></div>');
};
function ctStudentCard(s, from, to, showClasses) {
  const mine = ctContacts.filter(c => c.studentId === s._id);
  const last = mine[0];
  const done = ctDoneIn(mine, from, to);
  const tries = ctTriesIn(mine, from, to);
  const open = ctOpenStudentId === s._id;
  return `<div class="card" style="padding:12px 14px;margin-bottom:8px;border-left:3px solid ${done?'var(--teal)':'var(--red)'}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="ctToggleStudent('${s._id}')">
      <div>
        <div style="font-weight:700;font-size:15px">${esc(s.name)}
          <span class="tag ${done?'tag-green':'tag-red'}" style="margin-left:6px">${done?'已填':(tries?`未填（已嘗試 ${tries} 次）`:'未填')}</span>
          ${mine.some(c => c.flag && !c.flagResolvedAt) ? '<span class="tag tag-red">🚩</span>' : ''}
          <span class="chevron" style="margin-left:4px;color:var(--muted);font-size:11px">${open?'▲':'▼'}</span></div>
        ${showClasses && (s.sourceClasses||[]).length ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">班別：${esc(s.sourceClasses.join('、'))}</div>` : ''}
        <div style="font-size:12px;margin-top:5px">${ctPhoneLinks(s.phones)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">最近電訪：${last ? esc(last.date)+'　'+esc(CT_METHODS[last.method]||'') : '尚無'}　共 ${mine.length} 筆</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" title="編輯學生資料" onclick="event.stopPropagation();ctOpenStudentModal('${s._id}')">✏️</button>
        <button class="btn btn-ghost btn-sm" title="從我的名單移除" style="color:var(--red)" onclick="event.stopPropagation();ctRemoveMyStudent('${s._id}')">🗑</button>
        <button class="btn btn-teal btn-sm" onclick="event.stopPropagation();ctOpenForm('${s._id}')">＋ 新增電訪</button>
      </div>
    </div>
    ${open ? ctHistoryHtml(mine, true, false) : ''}
  </div>`;
}
window.ctToggleStudent = function(id) { ctOpenStudentId = ctOpenStudentId === id ? null : id; ctRenderTeacherList(); };

// ── 匯出（CSV / 列印）──
function ctRowsOf(list) {
  const head = ['日期','老師','學生','班別','電話','方式','對象','溝通內容','待追蹤','下次聯絡','需主管關注'];
  const rows = list.map(c => {
    const s = ctStudents.find(x => x._id === c.studentId);
    return [c.date, c.teacherName||c.teacherId, ctNameOf(c), (s?.sourceClasses||[]).join('、'), (s?.phones||[]).join(' / '),
            CT_METHODS[c.method]||c.method||'', c.callee||'', c.content||'', c.followUp||'', c.nextDate||'', c.flag ? (c.flagResolvedAt ? '已處理' : '是') : ''];
  });
  return [head, ...rows];
}
function ctFilterByRange(list, from, to) {
  return list.filter(c => (!from || c.date >= from) && (!to || c.date <= to));
}
function ctPrintHtml(list, title, metaText) {
  // 依老師 → 學生 分組
  const byT = {};
  list.forEach(c => { ((byT[c.teacherName||c.teacherId] ||= {})[ctNameOf(c)] ||= []).push(c); });
  const now = new Date().toLocaleString('zh-TW');
  let body = '';
  Object.keys(byT).sort().forEach(tn => {
    body += `<h2>👩‍🏫 ${esc(tn)}</h2>`;
    Object.keys(byT[tn]).sort().forEach(sn => {
      const arr = byT[tn][sn].slice().sort((a,b) => (a.date||'').localeCompare(b.date||''));
      const s = ctStudents.find(x => x._id === arr[0].studentId);
      body += `<h3>${esc(sn)} <span class="meta">${esc((s?.sourceClasses||[]).join('、'))}　${esc((s?.phones||[]).join(' / '))}</span></h3>
        <table><thead><tr><th style="width:84px">日期</th><th style="width:56px">方式</th><th style="width:56px">對象</th><th>溝通內容</th><th style="width:22%">待追蹤 / 下次聯絡</th></tr></thead><tbody>` +
        arr.map(c => `<tr><td>${esc(c.date)}</td><td>${esc(CT_METHODS[c.method]||c.method||'')}</td><td>${esc(c.callee||'')}</td><td class="pre">${c.flag?'🚩 ':''}${esc(c.content||'')}</td><td class="pre">${esc(c.followUp||'')}${c.nextDate?`<br><span class="meta">下次：${esc(c.nextDate)}</span>`:''}</td></tr>`).join('') +
        `</tbody></table>`;
    });
  });
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  body{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;padding:28px;color:#111;background:#fff;font-size:13px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:26px 0 8px;border-bottom:2px solid #333;padding-bottom:4px}
  h3{font-size:14px;margin:14px 0 6px} .meta{color:#666;font-size:12px;font-weight:400}
  table{width:100%;border-collapse:collapse;margin-bottom:10px} th{background:#f0f0f0;border:1px solid #bbb;padding:6px 8px;text-align:left;font-size:12px}
  td{border:1px solid #ccc;padding:6px 8px;vertical-align:top} .pre{white-space:pre-wrap} tr{page-break-inside:avoid}
  .no-print{margin-bottom:16px;padding:8px 20px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px}
  @media print{.no-print{display:none}body{padding:10px}}
</style></head><body>
<button class="no-print" onclick="window.print()">🖨 列印 / 存成 PDF</button>
<h1>百宏文教機構・${esc(title)}</h1>
<div class="meta">${esc(metaText)}　產生時間：${esc(now)}　共 ${list.length} 筆</div>
${body || '<p>（此範圍內沒有紀錄）</p>'}
</body></html>`;
}
function ctOpenHtml(html, filename) {
  const blob = new Blob([html], { type:'text/html;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {  // 被擋彈窗 → 改下載
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    showToast('已下載報表，用瀏覽器開啟後可列印');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function ctExport(list, fmt, label, from, to) {
  if (!list.length) { showToast('此範圍內沒有紀錄','error'); return; }
  const stamp = `${from||''}${from&&to?'_':''}${to||''}` || todayISO();
  if (fmt === 'csv') downloadCSV(`電訪表_${label}_${stamp}.csv`, ctRowsOf(list));
  else ctOpenHtml(ctPrintHtml(list, `電訪表（${label}）`, `期間：${from||'（不限）'} ～ ${to||'（不限）'}`), `電訪表_${label}_${stamp}.html`);
}
window.ctExportMine = function(fmt) {
  const from = document.getElementById('ctExpFrom').value, to = document.getElementById('ctExpTo').value;
  ctExport(ctFilterByRange(ctContacts, from, to), fmt, currentUser.name, from, to);
};

// ── 主管端 ──
// 主管端的 contacts 不整包撈：預設只撈最近 CT_ADMIN_PERIODS 期，選到更早的期別才補撈那段；「全部」才撈全部。
const CT_ADMIN_PERIODS = 3;
let ctLoadedFrom = null;     // 目前已載入的最早日期（null = 尚未載入；'' = 已載入全部）
function ctDefaultLoadFrom() {
  const [y, m] = ctPeriodYm(todayISO()).split('-').map(Number);
  const d = new Date(y, m - 1 - (CT_ADMIN_PERIODS - 1), 1);
  return ctPeriodBounds(`${d.getFullYear()}-${pad2(d.getMonth()+1)}`)[0];
}
// 確保 from（ISO 日期；'' = 全部）之後的紀錄都在記憶體裡；主管專用
async function ctEnsureContactsFrom(from) {
  if (ctLoadedFrom === '') return;                                    // 已有全部
  if (ctLoadedFrom !== null && from && from >= ctLoadedFrom) return;  // 已涵蓋
  const q = from ? query(collection(db,'contacts'), where('date','>=',from)) : collection(db,'contacts');
  const cs = await getDocs(q);
  const byId = {}; ctContacts.forEach(c => byId[c._id] = c);
  cs.docs.forEach(d => byId[d.id] = {_id:d.id, ...d.data()});
  // 旗標紀錄不限期間，一律帶上
  try {
    const fl = await getDocs(query(collection(db,'contacts'), where('flag','==',true)));
    fl.docs.forEach(d => { if (!byId[d.id]) byId[d.id] = {_id:d.id, ...d.data()}; });
  } catch(e) { console.error('flag query:', e); }
  ctContacts = ctSortContacts(Object.values(byId));
  ctLoadedFrom = from;
}
async function ctAdminLoad(force) {
  const ss = await getDocs(collection(db,'ctStudents'));
  ctStudents = ss.docs.map(d => ({_id:d.id, ...d.data()})).sort((a,b) => (a.sourceClasses?.[0]||'').localeCompare(b.sourceClasses?.[0]||'') || a.name.localeCompare(b.name));
  const keep = ctLoadedFrom;             // 重新撈目前已載入的範圍（寫入後要看到最新）
  ctContacts = []; ctLoadedFrom = null;
  await ctEnsureContactsFrom(keep === null ? ctDefaultLoadFrom() : keep);
}
let ctPendingFlagged = false;
// 點徽章：切到電訪管理 → 紀錄頁 → 只看待處理
window.ctGoFlagged = function() {
  ctPendingFlagged = true;
  const tab = document.getElementById('adminTabContacts');
  if (document.getElementById('admin-tab-contacts').style.display !== 'block') { adminSwitchTab('contacts', tab); return; }
  ctAdminSwitch('records');
};
window.renderAdminContacts = async function() {
  showLoading('載入電訪資料...');
  try { await ctAdminLoad(); } catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
  ctUpdateFlagBadge();
  ctAdminSwitch(ctPendingFlagged ? 'records' : ctAdminSection);
};
window.ctAdminSwitch = function(sec, el) {
  ctAdminSection = sec;
  ['missing','pairs','records','import'].forEach(s => document.getElementById('ct-sec-'+s).style.display = s === sec ? 'block' : 'none');
  document.querySelectorAll('#ctSubTabs .btn').forEach(b => { b.classList.toggle('btn-purple', b.dataset.sec === sec); b.classList.toggle('btn-ghost', b.dataset.sec !== sec); });
  if (sec === 'missing') {
    const mEl = document.getElementById('ctMissMonth');
    if (!mEl.value && !document.getElementById('ctMissFrom').value) { mEl.value = ctPeriodYm(todayISO()); ctApplyMonth('ctMissMonth','ctMissFrom','ctMissTo'); }
    ctSetDefaultRange('ctMissFrom','ctMissTo'); ctRenderMissing();
  }
  if (sec === 'pairs')   ctRenderPairs();
  if (sec === 'records') {
    ctPopulateRecordFilters();
    if (ctPendingFlagged) { ctPendingFlagged = false; document.getElementById('ctRecFlagOnly').checked = true; }
    const mEl = document.getElementById('ctRecMonth');
    if (!mEl.dataset.init) { mEl.dataset.init = '1'; mEl.value = ctPeriodYm(todayISO()); ctApplyMonth('ctRecMonth','ctRecFrom','ctRecTo'); }
    ctAdminRenderRecords();
  }
  if (sec === 'import')  { ctRenderImportPreview(); ctRenderSnapshots(); }
};

// 未填回報：每個（老師 × 學生）配對在期間內是否至少有一筆電訪
function ctMissingData(from, to) {
  const byT = {};
  teachers.forEach(t => byT[t.userId] = { name:t.name, total:0, missing:[] });
  ctActiveStudents().forEach(s => (s.teacherIds||[]).forEach(tid => {
    const b = byT[tid] ||= { name:tid, total:0, missing:[] };
    b.total++;
    const has = ctDoneIn(ctContacts.filter(c => c.studentId === s._id && c.teacherId === tid), from, to);
    if (!has) b.missing.push(s);
  }));
  return Object.entries(byT).filter(([,b]) => b.total > 0)
    .sort((a,b) => b[1].missing.length - a[1].missing.length || a[1].name.localeCompare(b[1].name));
}
window.ctRenderMissing = function() {
  const from = document.getElementById('ctMissFrom').value, to = document.getElementById('ctMissTo').value;
  if (!from || !to) return;
  const data = ctMissingData(from, to);
  const totalPairs = data.reduce((n,[,b]) => n + b.total, 0);
  const totalMiss  = data.reduce((n,[,b]) => n + b.missing.length, 0);
  const box = document.getElementById('ctMissingOut');
  if (!totalPairs) { box.innerHTML = '<div class="empty"><div class="empty-icon">📞</div><div>還沒有任何配對，請先到「配對」或「匯入名冊」</div></div>'; return; }
  box.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card"><div class="summary-num" style="color:var(--teal)">${totalPairs - totalMiss}</div><div class="summary-lbl">已電訪</div></div>
      <div class="summary-card"><div class="summary-num" style="color:var(--red)">${totalMiss}</div><div class="summary-lbl">未電訪</div></div>
      <div class="summary-card"><div class="summary-num">${Math.round((totalPairs-totalMiss)/totalPairs*100)}%</div><div class="summary-lbl">完成率</div></div>
      <div class="summary-card"><div class="summary-num" style="color:var(--purple)">${data.filter(([,b]) => b.missing.length).length}</div><div class="summary-lbl">待催老師</div></div>
    </div>` +
    data.map(([tid, b]) => {
      const done = b.total - b.missing.length, pct = Math.round(done / b.total * 100);
      return `<div class="card" style="margin-bottom:10px;border-left:3px solid ${b.missing.length?'var(--red)':'var(--teal)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-weight:700;font-size:15px">${esc(b.name)} <span style="color:var(--muted);font-size:12px;font-weight:400">（${esc(tid)}）</span></div>
          <div style="font-size:13px;font-weight:700;color:${b.missing.length?'var(--yellow)':'var(--teal)'}">${done} / ${b.total}　${pct}%</div>
        </div>
        <div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;margin:8px 0 10px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${pct===100?'var(--teal)':pct>=50?'var(--yellow)':'var(--red)'}"></div></div>
        ${b.missing.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${b.missing.map(s => `<span style="display:inline-block;background:rgba(255,107,107,.12);color:var(--red);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700">${esc(s.name)}<span style="opacity:.7;font-weight:400">${s.sourceClasses?.[0]?'（'+esc(s.sourceClasses[0])+'）':''}</span></span>`).join('')}</div>`
                          : '<div style="font-size:12px;color:var(--teal)">✅ 全部完成</div>'}
      </div>`;
    }).join('');
};
window.ctCopyReminder = async function() {
  const from = document.getElementById('ctMissFrom').value, to = document.getElementById('ctMissTo').value;
  const data = ctMissingData(from, to).filter(([,b]) => b.missing.length);
  if (!data.length) { showToast('沒有未填的配對'); return; }
  const text = `【電訪未填提醒】${from} ～ ${to}\n` +
    data.map(([,b]) => `${b.name}（${b.total-b.missing.length}/${b.total}）：${b.missing.map(s => s.name).join('、')}`).join('\n');
  try { await navigator.clipboard.writeText(text); showToast('📋 已複製催填訊息'); }
  catch { prompt('複製以下訊息：', text); }
};
window.ctExportMissingCSV = function() {
  const from = document.getElementById('ctMissFrom').value, to = document.getElementById('ctMissTo').value;
  const rows = [['老師','帳號','學生','班別','電話','狀態']];
  ctMissingData(from, to).forEach(([tid, b]) => {
    ctActiveStudents().filter(s => (s.teacherIds||[]).includes(tid)).forEach(s => {
      rows.push([b.name, tid, s.name, (s.sourceClasses||[]).join('、'), (s.phones||[]).join(' / '), b.missing.includes(s) ? '未填' : '已填']);
    });
  });
  downloadCSV(`電訪完成狀況_${from}_${to}.csv`, rows);
};

// 配對
function ctSourceClasses() {
  return [...new Set(ctStudents.flatMap(s => s.sourceClasses||[]))].sort();
}
function ctPairFiltered() {
  const cls = document.getElementById('ctPairClass').value;
  const q   = (document.getElementById('ctPairSearch').value||'').trim();
  const inactive = document.getElementById('ctPairInactive').checked;
  return ctStudents.filter(s => (inactive || s.active !== false)
    && (!cls || (s.sourceClasses||[]).includes(cls))
    && (!q || s.name.includes(q) || (s.phones||[]).some(p => p.includes(q))));
}
window.ctRenderPairs = function() {
  const clsSel = document.getElementById('ctPairClass');
  const cur = clsSel.value;
  clsSel.innerHTML = '<option value="">全部班別</option>' + ctSourceClasses().map(c => `<option value="${esc(c)}"${c===cur?' selected':''}>${esc(c)}</option>`).join('');
  const tSel = document.getElementById('ctBatchTeacher');
  const curT = tSel.value;
  tSel.innerHTML = '<option value="">-- 選擇老師 --</option>' + teachers.map(t => `<option value="${esc(t.userId)}"${t.userId===curT?' selected':''}>${esc(t.name)}</option>`).join('');

  const list = ctPairFiltered();
  const box = document.getElementById('ctPairsOut');
  document.getElementById('ctPairCount').textContent = `${list.length} 位學生`;
  if (!ctStudents.length) { box.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><div>名冊是空的，請先「匯入名冊」或手動新增學生</div></div>'; return; }
  if (!teachers.length)   { box.innerHTML = '<div class="empty"><div>尚無老師帳號，請先到「帳號管理」新增</div></div>'; return; }
  // 同名提示
  const nameCount = {};
  ctStudents.forEach(s => nameCount[s.name] = (nameCount[s.name]||0) + 1);
  box.innerHTML = `<div style="overflow-x:auto"><table class="score-table" style="min-width:${520 + teachers.length*64}px">
    <thead><tr>
      <th style="text-align:left;min-width:120px">學生</th><th style="text-align:left">班別</th><th style="text-align:left;min-width:110px">電話</th>
      ${teachers.map(t => `<th style="min-width:60px;font-size:11px">${esc(t.name)}</th>`).join('')}
      <th style="min-width:110px"></th>
    </tr></thead><tbody>` +
    list.map(s => `<tr style="${s.active===false?'opacity:.45':''}">
      <td style="font-weight:700;white-space:nowrap">${esc(s.name)}${nameCount[s.name]>1?' <span class="tag tag-yellow" title="名冊裡有同名學生">同名</span>':''}${s.active===false?' <span class="tag tag-red">停用</span>':''}</td>
      <td style="font-size:12px;color:var(--muted)">${esc((s.sourceClasses||[]).join('、'))}</td>
      <td style="font-size:12px">${(s.phones||[]).map(esc).join('<br>')}</td>
      ${teachers.map(t => `<td style="text-align:center"><input type="checkbox" style="accent-color:var(--purple);width:16px;height:16px;cursor:pointer" ${(s.teacherIds||[]).includes(t.userId)?'checked':''} onchange="ctTogglePair('${s._id}','${esc(t.userId)}',this.checked)"></td>`).join('')}
      <td style="white-space:nowrap;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="ctOpenStudentModal('${s._id}')">✏️</button>
        <button class="btn btn-ghost btn-sm" title="${s.active===false?'啟用':'停用'}" onclick="ctToggleStudentActive('${s._id}')">${s.active===false?'✅':'🚫'}</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="ctDeleteStudent('${s._id}')">🗑</button>
      </td>
    </tr>`).join('') + '</tbody></table></div>';
};
window.ctTogglePair = async function(sid, tid, on) {
  const s = ctStudents.find(x => x._id === sid); if (!s) return;
  const ids = new Set(s.teacherIds||[]);
  on ? ids.add(tid) : ids.delete(tid);
  const teacherIds = [...ids];
  try { await updateDoc(doc(db,'ctStudents',sid), { teacherIds, updatedAt:Date.now() }); s.teacherIds = teacherIds; }
  catch(e) { showToast('❌ '+authErrMsg(e),'error'); ctRenderPairs(); }
};
window.ctBatchPair = async function(on) {
  const tid = document.getElementById('ctBatchTeacher').value;
  if (!tid) { showToast('請先選擇老師','error'); return; }
  const list = ctPairFiltered().filter(s => on !== (s.teacherIds||[]).includes(tid));
  if (!list.length) { showToast('沒有需要變更的學生'); return; }
  if (!confirm(`將目前篩選的 ${list.length} 位學生${on?'指派給':'取消指派'} ${ctTeacherName(tid)}？`)) return;
  showLoading('更新配對...');
  try {
    for (const s of list) {
      const ids = new Set(s.teacherIds||[]); on ? ids.add(tid) : ids.delete(tid);
      s.teacherIds = [...ids];
      await updateDoc(doc(db,'ctStudents',s._id), { teacherIds:s.teacherIds, updatedAt:Date.now() });
    }
    showToast(`✅ 已更新 ${list.length} 位`);
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); }
  hideLoading();
  ctRenderPairs();
};
window.ctOpenStudentModal = function(id) {
  const s = id ? ctStudents.find(x => x._id === id) : null;
  const g = k => document.getElementById(k);
  g('ctsId').value      = s?._id || '';
  g('ctsName').value    = s?.name || '';
  g('ctsEnglish').value = s?.english || '';
  g('ctsPhones').value  = (s?.phones||[]).join('、');
  g('ctsClasses').value = (s?.sourceClasses||[]).join('、');
  g('ctsTitle').textContent = s ? '✏️ 編輯學生' : '＋ 新增學生';
  g('ctStudentModal').classList.add('show');
};
window.ctCloseStudentModal = function() { document.getElementById('ctStudentModal').classList.remove('show'); };
window.ctSaveStudent = async function() {
  const g = k => document.getElementById(k);
  const id = g('ctsId').value, name = g('ctsName').value.trim();
  if (!name) { showToast('請輸入姓名','error'); return; }
  const phones = []; ctExtractPhones(g('ctsPhones').value, phones);
  const sourceClasses = g('ctsClasses').value.split(/[\s,，、]+/).map(x => x.trim()).filter(Boolean);
  const data = { name, english:g('ctsEnglish').value.trim(), phones, sourceClasses, updatedAt:Date.now() };
  const isAdmin = !!currentUser?.isAdmin;
  showLoading('儲存中...');
  try {
    if (id) {
      const cur = ctStudents.find(x => x._id === id);
      const ct = { ...(cur?.classTeachers||{}) };
      Object.keys(ct).forEach(c => { if (!sourceClasses.includes(c)) delete ct[c]; });
      // 老師新增的班別視為自己教的班（規則只允許老師把自己填進去）
      if (!isAdmin) sourceClasses.forEach(c => { if (!ct[c]) ct[c] = currentUser.id; });
      data.classTeachers = ct;
      await updateDoc(doc(db,'ctStudents',id), data);
    } else {
      // 老師新增：直接配對給自己；主管新增：先不配對
      const teacherIds = isAdmin ? [] : [currentUser.id];
      const classTeachers = {};
      if (!isAdmin) sourceClasses.forEach(c => classTeachers[c] = currentUser.id);
      await addDoc(collection(db,'ctStudents'), { ...data, teacherIds, classTeachers, active:true, createdAt:Date.now() });
    }
    showToast('✅ 已儲存'); ctCloseStudentModal();
    await ctReload();
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
};

// 老師：把學生從自己的名單移除（只取消自己的配對，資料與紀錄保留；主管仍看得到）
window.ctRemoveMyStudent = async function(id) {
  const s = ctStudents.find(x => x._id === id); if (!s) return;
  if (!confirm(`將「${s.name}」從你的電訪名單移除？\n學生資料與你的電訪紀錄都會保留，之後主管可以重新配對。`)) return;
  const teacherIds = (s.teacherIds||[]).filter(t => t !== currentUser.id);
  const classTeachers = {};
  Object.entries(s.classTeachers||{}).forEach(([c,t]) => { if (t !== currentUser.id) classTeachers[c] = t; });
  const patch = { teacherIds, classTeachers, updatedAt:Date.now() };
  if (!teacherIds.length) patch.active = false;
  showLoading('移除中...');
  try { await updateDoc(doc(db,'ctStudents',id), patch); showToast('已從你的名單移除'); await ctReload(); }
  catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
};
window.ctToggleStudentActive = async function(id) {
  const s = ctStudents.find(x => x._id === id); if (!s) return;
  const active = s.active === false;
  try { await updateDoc(doc(db,'ctStudents',id), { active, updatedAt:Date.now() }); s.active = active; ctRenderPairs(); showToast(active?'✅ 已啟用':'🚫 已停用（不再計入未填）'); }
  catch(e) { showToast('❌ '+authErrMsg(e),'error'); }
};
window.ctDeleteStudent = async function(id) {
  const s = ctStudents.find(x => x._id === id); if (!s) return;
  showLoading('檢查紀錄...');
  let n = 0;
  try { n = (await getDocs(query(collection(db,'contacts'), where('studentId','==',id)))).size; }
  catch(e) { hideLoading(); showToast('❌ '+authErrMsg(e),'error'); return; }
  hideLoading();
  if (n) {
    alert(`「${s.name}」有 ${n} 筆電訪紀錄，不能直接刪除（紀錄會變成找不到學生）。\n\n退班／畢業請改用「🚫 停用」；若是重複資料請用「🧹 合併重複」。`);
    return;
  }
  if (!confirm(`刪除學生「${s.name}」？此學生沒有任何電訪紀錄。\n（只是畢業或退班請改用「停用」）`)) return;
  showLoading('刪除中...');
  try { await deleteDoc(doc(db,'ctStudents',id)); await ctAdminLoad(); ctRenderPairs(); showToast('🗑 已刪除'); }
  catch(e) { showToast('❌ '+authErrMsg(e),'error'); }
  hideLoading();
};

// 紀錄瀏覽（主管）
function ctPopulateRecordFilters() {
  const tSel = document.getElementById('ctRecTeacher'); const cur = tSel.value;
  tSel.innerHTML = '<option value="">全部老師</option>' + teachers.map(t => `<option value="${esc(t.userId)}"${t.userId===cur?' selected':''}>${esc(t.name)}</option>`).join('');
}
function ctRecordsFiltered() {
  const tid = document.getElementById('ctRecTeacher').value;
  const q   = (document.getElementById('ctRecSearch').value||'').trim();
  const from = document.getElementById('ctRecFrom').value, to = document.getElementById('ctRecTo').value;
  const flagOnly = document.getElementById('ctRecFlagOnly').checked;
  const base = flagOnly ? ctContacts.filter(c => c.flag && !c.flagResolvedAt) : ctFilterByRange(ctContacts, from, to);
  return base.filter(c => (!tid || c.teacherId === tid) && (!q || ctNameOf(c).includes(q) || (c.content||'').includes(q)));
}
// 主管：把「需主管關注」標成已處理（或取消）
window.ctResolveFlag = async function(id, resolved) {
  const c = ctContacts.find(x => x._id === id); if (!c) return;
  try {
    await updateDoc(doc(db,'contacts',id), resolved ? { flagResolvedAt:Date.now(), flagResolvedBy:currentUser.id } : { flagResolvedAt:null, flagResolvedBy:'' });
    Object.assign(c, resolved ? { flagResolvedAt:Date.now(), flagResolvedBy:currentUser.id } : { flagResolvedAt:null, flagResolvedBy:'' });
    ctAdminRenderRecords(); ctUpdateFlagBadge();
    showToast(resolved ? '✓ 已標記處理' : '已改回待處理');
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); }
};
// 電訪管理分頁上的待處理數
function ctUpdateFlagBadge() {
  const n = ctContacts.filter(c => c.flag && !c.flagResolvedAt).length;
  const el = document.getElementById('ctFlagBadge');
  if (el) { el.textContent = n ? `🚩 ${n}` : ''; el.style.display = n ? 'inline-block' : 'none'; }
}
window.ctAdminRenderRecords = function() {
  const list = ctRecordsFiltered();
  const box = document.getElementById('ctRecordsOut');
  document.getElementById('ctRecCount').textContent = `${list.length} 筆`;
  const hint = document.getElementById('ctRecLoadedHint');
  if (hint) hint.textContent = ctLoadedFrom === '' ? '（已載入全部紀錄）' : ctLoadedFrom ? `（目前載入 ${ctLoadedFrom} 之後；更早的請選月份或按「全部」）` : '';
  if (!list.length) { box.innerHTML = '<div class="empty"><div class="empty-icon">📞</div><div>沒有符合的電訪紀錄</div></div>'; return; }
  // 依月份分段（紀錄已依日期新→舊排序）
  const byMonth = {};
  list.forEach(c => { const ym = c.date ? ctPeriodYm(c.date) : ''; (byMonth[ym] ||= []).push(c); });
  document.getElementById('ctRecCount').textContent = `${list.length} 筆` + (Object.keys(byMonth).length > 1 ? `　${Object.keys(byMonth).sort().reverse().map(ym => `${Number(ym.slice(5,7))}月份 ${byMonth[ym].length}`).join('、')}` : '');
  let lastYm = '';
  box.innerHTML = list.slice(0, 300).map(c => {
    const s = ctStudents.find(x => x._id === c.studentId);
    const ym = c.date ? ctPeriodYm(c.date) : '';
    const head = ym !== lastYm ? `<div style="font-size:12px;font-weight:700;color:var(--purple);letter-spacing:1px;margin:16px 0 8px">📅 ${esc(ctMonthLabel(ym))}（${byMonth[ym].length} 筆）</div>` : '';
    lastYm = ym;
    return head + `<div class="card" style="padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <div><b>${esc(c.date)}</b>　<span style="font-weight:700">${esc(ctNameOf(c))}</span>
          <span style="color:var(--muted);font-size:12px">${esc((s?.sourceClasses||[]).join('、'))}</span>
          <span class="tag ${c.method==='noanswer'?'tag-orange':'tag-blue'}" style="margin-left:6px">${esc(CT_METHODS[c.method]||c.method||'')}</span>
          ${c.callee?`<span class="tag tag-purple">${esc(c.callee)}</span>`:''}
          ${c.flag?`<span class="tag ${c.flagResolvedAt?'tag-green':'tag-red'}">${c.flagResolvedAt?'✓ 已處理':'🚩 需主管關注'}</span>`:''}
          <span style="color:var(--purple);font-size:12px;margin-left:6px">${esc(c.teacherName||c.teacherId)}</span>
          ${c.lastEditedName?`<span style="color:var(--muted);font-size:11px;margin-left:6px">（${esc(c.lastEditedName)} 編輯）</span>`:''}
        </div>
        <div style="display:flex;gap:6px">
          ${c.flag ? (c.flagResolvedAt ? `<button class="btn btn-ghost btn-sm" onclick="ctResolveFlag('${c._id}',false)">↩ 改回待處理</button>` : `<button class="btn btn-teal btn-sm" onclick="ctResolveFlag('${c._id}',true)">✓ 已處理</button>`) : ''}
          <button class="btn btn-ghost btn-sm" onclick="ctOpenForm('${c.studentId}','${c._id}')">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="ctDeleteContact('${c._id}')">🗑</button>
        </div>
      </div>
      <div style="white-space:pre-wrap;margin-top:6px;font-size:13px;line-height:1.6">${esc(c.content)}</div>
      ${c.followUp?`<div style="color:var(--yellow);margin-top:4px;font-size:13px">📌 待追蹤：${esc(c.followUp)}</div>`:''}
      ${c.nextDate?`<div style="color:var(--muted);font-size:12px;margin-top:2px">下次聯絡：${esc(c.nextDate)}</div>`:''}
    </div>`;
  }).join('') + (list.length > 300 ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:10px">只顯示前 300 筆，請縮小範圍或匯出</div>` : '');
};
window.ctExportAdmin = function(fmt) {
  const from = document.getElementById('ctRecFrom').value, to = document.getElementById('ctRecTo').value;
  const tid  = document.getElementById('ctRecTeacher').value;
  ctExport(ctRecordsFiltered(), fmt, tid ? ctTeacherName(tid) : '全部', from, to);
};

// 匯入名冊
function ctMatchTeacher(name) {
  const n = String(name||'').replace(/老師$/,'').trim();
  if (!n) return '';
  const strip = x => String(x||'').replace(/老師$/,'').trim();
  const t = teachers.find(t => (t.aliases||[]).some(a => a === name || strip(a) === n))   // 點名表姓名（別名）優先
    || teachers.find(t => t.name === name)
    || teachers.find(t => strip(t.name) === n)
    || teachers.find(t => t.name.includes(n) || n.includes(strip(t.name)));
  return t?.userId || '';
}
// 名冊內是否已有同一人：姓名相同且至少一支電話相同（或雙方都沒電話）
// 同名時視為同一人的條件：電話有重疊、或任一方沒有電話、或既有那筆是「沒班別沒配對」的空殼
function ctSamePerson(s, phones) {
  const sp = s.phones || [];
  if (!sp.length || !phones.length) return true;
  if (sp.some(p => phones.includes(p))) return true;
  return !(s.sourceClasses||[]).length && !(s.teacherIds||[]).length;
}
function ctFindExisting(name, phones) {
  const same = ctStudents.filter(s => s.name === name);
  if (!same.length) return { match:null, sameName:false };
  // 多筆都符合時優先選：啟用中 → 有班別 → 建立較早
  const cands = same.filter(s => ctSamePerson(s, phones))
    .sort((a,b) => ((b.active!==false)-(a.active!==false)) || ((b.sourceClasses||[]).length-(a.sourceClasses||[]).length) || ((a.createdAt||0)-(b.createdAt||0)));
  return { match:cands[0] || null, sameName:true };
}

// 找出名冊裡的重複學生：同名且 ctSamePerson 成立 → 分成一組
function ctDuplicateGroups() {
  const byName = {};
  ctStudents.forEach(s => (byName[s.name] ||= []).push(s));
  const groups = [];
  Object.values(byName).forEach(arr => {
    if (arr.length < 2) return;
    const rest = arr.slice();
    while (rest.length) {
      const seed = rest.shift();
      const grp = [seed];
      for (let i = rest.length - 1; i >= 0; i--) {
        if (grp.some(g => ctSamePerson(rest[i], g.phones||[]) || ctSamePerson(g, rest[i].phones||[]))) grp.push(rest.splice(i,1)[0]);
      }
      if (grp.length > 1) groups.push(grp);
    }
  });
  return groups;
}
// 合併一組：保留最完整的一筆，其餘資料併入、電訪紀錄改指向保留筆、刪除其餘
async function ctMergeGroup(grp) {
  const sorted = grp.slice().sort((a,b) => ((b.active!==false)-(a.active!==false)) || ((b.sourceClasses||[]).length-(a.sourceClasses||[]).length) || ((b.teacherIds||[]).length-(a.teacherIds||[]).length) || ((a.createdAt||0)-(b.createdAt||0)));
  const keep = sorted[0], others = sorted.slice(1);
  const patch = {
    phones:        [...new Set(sorted.flatMap(s => s.phones||[]))],
    sourceClasses: [...new Set(sorted.flatMap(s => s.sourceClasses||[]))],
    teacherIds:    [...new Set(sorted.flatMap(s => s.teacherIds||[]))],
    classTeachers: Object.assign({}, ...sorted.slice().reverse().map(s => s.classTeachers||{})),
    english: keep.english || others.find(s => s.english)?.english || '',
    active: sorted.some(s => s.active !== false),
    updatedAt: Date.now()
  };
  await updateDoc(doc(db,'ctStudents',keep._id), patch);
  let moved = 0;
  for (const o of others) {
    const snap = await getDocs(query(collection(db,'contacts'), where('studentId','==',o._id)));
    for (const d of snap.docs) { await updateDoc(doc(db,'contacts',d.id), { studentId:keep._id }); moved++; }
    await deleteDoc(doc(db,'ctStudents',o._id));
  }
  return { keep, removed:others.length, moved };
}
window.ctMergeDuplicates = async function() {
  const groups = ctDuplicateGroups();
  if (!groups.length) { showToast('✅ 沒有重複的學生'); return; }
  const preview = groups.slice(0, 15).map(g => `${g[0].name}（${g.length} 筆）`).join('、') + (groups.length > 15 ? ` …共 ${groups.length} 組` : '');
  if (!confirm(`找到 ${groups.length} 組重複：\n${preview}\n\n每組保留最完整的一筆（班別、配對、電話合併，電訪紀錄一併轉移），其餘刪除。確定合併？`)) return;
  showLoading('合併中...');
  let removed = 0, moved = 0;
  try {
    for (let i = 0; i < groups.length; i++) {
      document.getElementById('loadingText').textContent = `合併中 ${i+1}/${groups.length}...`;
      const r = await ctMergeGroup(groups[i]); removed += r.removed; moved += r.moved;
    }
    showToast(`🧹 已合併 ${groups.length} 組，刪除 ${removed} 筆重複，轉移 ${moved} 筆電訪紀錄`);
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
  await ctAdminLoad(); ctRenderPairs();
};
window.ctImportFiles = async function(files) {
  if (!files?.length) return;
  showLoading('解析 PDF...');
  try {
    for (const f of files) {
      const pages = await ctPdfPages(f);
      if (!pages.length) { showToast(`${f.name}：找不到點名表格式，請改用貼上文字`, 'error'); continue; }
      // 同一班超過一頁（例如 36 格分兩頁）：班別相同的連續頁合併成一張表
      pages.forEach(p => {
        const last = ctImportPages[ctImportPages.length - 1];
        const students = p.students.map(s => ({ ...s, include:true }));
        if (last && last._file === f.name && last.className && last.className === p.className) {
          last.students.push(...students);
          return;
        }
        ctImportPages.push({ ...p, _file:f.name, teacherId: ctMatchTeacher(p.teacherName), students });
      });
    }
    document.getElementById('ctImportFile').value = '';
    ctRenderImportPreview();
  } catch(e) { showToast('❌ PDF 解析失敗：' + (e.message||e), 'error'); console.error(e); }
  hideLoading();
};
window.ctImportText = function() {
  const text = document.getElementById('ctImportTextArea').value;
  const r = ctParseRosterText(text);
  if (!r.students.length) { showToast('沒有解析到任何「姓名 電話」','error'); return; }
  r.className = document.getElementById('ctImportTextClass').value.trim();
  ctImportPages.push({ ...r, teacherId:'', students:r.students.map(s => ({ ...s, include:true })) });
  document.getElementById('ctImportTextArea').value = '';
  ctRenderImportPreview();
};
window.ctImportClear = function() { ctImportPages = []; ctRenderImportPreview(); };
window.ctImportSetClass   = (pi, v) => { ctImportPages[pi].className = v.trim(); };
window.ctImportSetTeacher = (pi, v) => { ctImportPages[pi].teacherId = v; };
window.ctImportToggle     = (pi, si, on) => { ctImportPages[pi].students[si].include = on; };
window.ctImportSetPhones  = (pi, si, v) => { const ph = []; ctExtractPhones(v, ph); ctImportPages[pi].students[si].phones = ph; };
window.ctImportSetName    = (pi, si, v) => { ctImportPages[pi].students[si].name = v.trim(); };
window.ctImportRemovePage = pi => { ctImportPages.splice(pi,1); ctRenderImportPreview(); };
window.ctRenderImportPreview = function() {
  const box = document.getElementById('ctImportPreview');
  if (!ctImportPages.length) { box.innerHTML = ''; document.getElementById('ctImportActions').style.display = 'none'; return; }
  document.getElementById('ctImportActions').style.display = 'flex';
  const tOpts = sel => '<option value="">（不配對）</option>' + teachers.map(t => `<option value="${esc(t.userId)}"${t.userId===sel?' selected':''}>${esc(t.name)}</option>`).join('');
  box.innerHTML = ctImportPages.map((p, pi) => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px">
        <div><label class="field-label">班別</label><input class="form-input" value="${esc(p.className)}" oninput="ctImportSetClass(${pi},this.value)" placeholder="例：國小-全科班-一年級"></div>
        <div><label class="field-label">配對老師 ${p.teacherName?`<span style="color:var(--muted);font-weight:400">（點名表：${esc(p.teacherName)}${p.teacherId?'':'，未對應到帳號'}）</span>`:''}</label>
          <select class="select-input" onchange="ctImportSetTeacher(${pi},this.value)">${tOpts(p.teacherId)}</select></div>
        <button class="btn btn-ghost btn-sm" onclick="ctImportRemovePage(${pi})">移除</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${p.dateRange?'期間 '+esc(p.dateRange)+'　':''}${p.students.length} 位學生</div>
      <table class="score-table"><thead><tr><th style="width:36px"></th><th style="text-align:left">姓名</th><th style="text-align:left">電話（可修改，用、分隔）</th><th style="text-align:left">狀態</th></tr></thead><tbody>
      ${p.students.map((s, si) => {
        const ex = ctFindExisting(s.name, s.phones);
        const status = ex.match ? '<span class="tag tag-green">合併既有</span>' : ex.sameName ? '<span class="tag tag-yellow">同名不同電話 → 新建</span>' : '<span class="tag tag-blue">新增</span>';
        return `<tr>
          <td style="text-align:center"><input type="checkbox" ${s.include?'checked':''} onchange="ctImportToggle(${pi},${si},this.checked)" style="accent-color:var(--teal);width:16px;height:16px"></td>
          <td><input class="form-input" style="padding:6px 8px;font-size:13px" value="${esc(s.name)}" oninput="ctImportSetName(${pi},${si},this.value)"></td>
          <td><input class="form-input" style="padding:6px 8px;font-size:13px" value="${esc(s.phones.join('、'))}" onchange="ctImportSetPhones(${pi},${si},this.value)"></td>
          <td>${status}</td></tr>`;
      }).join('')}
      </tbody></table>
    </div>`).join('');
};
// 學生的 classTeachers = { 班別: 老師id }，記錄「哪個班帶來哪位老師」的配對，
// 讓「以新表為準」移除班別時知道該取消哪位老師（老師若還教該生其他班則保留）。
function ctDropClass(s, className) {
  const ct = { ...(s.classTeachers||{}) };
  const tid = ct[className];
  delete ct[className];
  const sourceClasses = (s.sourceClasses||[]).filter(c => c !== className);
  let teacherIds = s.teacherIds || [];
  if (tid && !Object.values(ct).includes(tid)) teacherIds = teacherIds.filter(x => x !== tid);
  const patch = { sourceClasses, classTeachers:ct, teacherIds, updatedAt:Date.now() };
  if (!sourceClasses.length) patch.active = false;
  return patch;
}
// ── 名冊快照（匯入前自動存，保留最近 CT_SNAPSHOT_KEEP 份）──
const CT_SNAPSHOT_KEEP = 3;
async function ctSaveSnapshot(label) {
  const students = ctStudents.map(s => ({ ...s }));
  await addDoc(collection(db,'ctSnapshots'), { label, createdAt:Date.now(), createdBy:currentUser.id, count:students.length, students });
  const snap = await getDocs(collection(db,'ctSnapshots'));
  const all = snap.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
  for (const old of all.slice(CT_SNAPSHOT_KEEP)) await deleteDoc(doc(db,'ctSnapshots',old._id));
}
window.ctRenderSnapshots = async function() {
  const box = document.getElementById('ctSnapshotList'); if (!box) return;
  try {
    const snap = await getDocs(collection(db,'ctSnapshots'));
    const all = snap.docs.map(d => ({ _id:d.id, label:d.data().label, createdAt:d.data().createdAt, count:d.data().count })).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    box.innerHTML = all.length ? all.map(x => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border);font-size:12px">
        <span>${esc(new Date(x.createdAt).toLocaleString('zh-TW'))}　${esc(x.label||'')}　<span style="color:var(--muted)">${x.count} 位</span></span>
        <button class="btn btn-ghost btn-sm" onclick="ctRestoreSnapshot('${x._id}')">↩ 還原到這份</button>
      </div>`).join('') : '<div style="font-size:12px;color:var(--muted)">尚無快照（第一次匯入時會自動建立）</div>';
  } catch(e) { box.innerHTML = `<div style="font-size:12px;color:var(--red)">❌ ${esc(authErrMsg(e))}（規則可能尚未更新）</div>`; }
};
// 還原：快照裡的學生整筆寫回；快照之後才新增、且沒有電訪紀錄的學生會刪除
window.ctRestoreSnapshot = async function(id) {
  const ds = await getDoc(doc(db,'ctSnapshots',id)); if (!ds.exists()) return;
  const snapData = ds.data();
  if (!confirm(`還原名冊到「${new Date(snapData.createdAt).toLocaleString('zh-TW')}」的狀態（${snapData.count} 位）？\n這之後匯入的新學生若沒有電訪紀錄會被刪除；電訪紀錄本身不受影響。`)) return;
  showLoading('還原中...');
  try {
    await ctSaveSnapshot('還原前');
    const ids = new Set();
    for (const st of snapData.students) {
      const { _id, ...data } = st; ids.add(_id);
      await setDoc(doc(db,'ctStudents',_id), data);
    }
    let removed = 0;
    for (const s of ctStudents.filter(x => !ids.has(x._id))) {
      const n = (await getDocs(query(collection(db,'contacts'), where('studentId','==',s._id)))).size;
      if (!n) { await deleteDoc(doc(db,'ctStudents',s._id)); removed++; }
    }
    showToast(`↩ 已還原 ${snapData.count} 位${removed?`，刪除 ${removed} 位快照後新增的學生`:''}`);
    await ctAdminLoad(); ctAdminSwitch('pairs');
  } catch(e) { showToast('❌ '+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
};

window.ctRunImport = async function() {
  const replace = document.getElementById('ctImportReplace').checked;
  const pages = ctImportPages.map(p => ({ ...p, students:p.students.filter(s => s.include && s.name) })).filter(p => p.students.length);
  if (!pages.length) { showToast('沒有勾選任何學生','error'); return; }
  if (replace && pages.some(p => !p.className)) { showToast('「以新表為準」需要每張表都有班別','error'); return; }
  if (replace && !confirm(`以新表為準：${pages.map(p => p.className).join('、')}\n不在表上的學生會被移除該班別與該班老師的配對，沒有任何班別的學生會停用。確定？`)) return;
  showLoading('匯入名冊...');
  let created = 0, merged = 0, dropped = 0;
  try {
    // 匯入前先存一份名冊快照，匯錯了可以一鍵還原
    document.getElementById('loadingText').textContent = '儲存名冊快照...';
    await ctSaveSnapshot(`匯入前（${replace?'以新表為準':'只新增'}：${pages.map(p => p.className||'未命名').join('、').slice(0,60)}）`);
    document.getElementById('loadingText').textContent = '匯入名冊...';
    // 以新表為準：先把整批匯入完成，再以「班別」為單位判斷誰不在表上（同一班可能分多頁／多張表）
    const onSheet = {};   // { className: Set(studentId) }
    const sheetTeacher = {};
    for (const p of pages) {
      const C = p.className, T = p.teacherId;
      const onPage = onSheet[C] || (onSheet[C] = new Set());
      if (C && T) sheetTeacher[C] = T;
      for (const s of p.students) {
        const ex = ctFindExisting(s.name, s.phones);
        if (ex.match) {
          const m = ex.match;
          const ct = { ...(m.classTeachers||{}) };
          let teacherIds = [...(m.teacherIds||[])];
          if (C && T) {
            const oldT = ct[C];
            ct[C] = T;
            // 以新表為準：這個班換老師 → 舊老師若沒教該生其他班就取消
            if (replace && oldT && oldT !== T && !Object.values(ct).includes(oldT)) teacherIds = teacherIds.filter(x => x !== oldT);
          }
          if (T) teacherIds = [...new Set([...teacherIds, T])];
          const patch = {
            phones: [...new Set([...(m.phones||[]), ...s.phones])],
            sourceClasses: [...new Set([...(m.sourceClasses||[]), ...(C?[C]:[])])],
            teacherIds, classTeachers:ct, active:true, updatedAt:Date.now()
          };
          if (s.english && !m.english) patch.english = s.english;
          await updateDoc(doc(db,'ctStudents',m._id), patch);
          Object.assign(m, patch); merged++; onPage.add(m._id);
        } else {
          const data = { name:s.name, english:s.english||'', phones:s.phones, sourceClasses:C?[C]:[], teacherIds:T?[T]:[],
                         classTeachers:(C&&T)?{[C]:T}:{}, active:true, createdAt:Date.now(), updatedAt:Date.now() };
          const ref = await addDoc(collection(db,'ctStudents'), data);
          const ns = { _id:ref.id, ...data };
          ctStudents.push(ns); created++; onPage.add(ns._id);
        }
      }
    }
    if (replace) {
      for (const C of Object.keys(onSheet)) {
        if (!C) continue;
        const T = sheetTeacher[C];
        // 原本在這個班、整批新表上都沒有的學生
        for (const s of ctStudents.filter(x => (x.sourceClasses||[]).includes(C) && !onSheet[C].has(x._id))) {
          // 舊資料沒有 classTeachers 時，以這張表的老師當作該班老師
          if (!(s.classTeachers||{})[C] && T) s.classTeachers = { ...(s.classTeachers||{}), [C]:T };
          const patch = ctDropClass(s, C);
          await updateDoc(doc(db,'ctStudents',s._id), patch);
          Object.assign(s, patch); dropped++;
        }
      }
    }
    showToast(`✅ 匯入完成：新增 ${created}、合併 ${merged}${replace?`、移除班別 ${dropped}`:''}`);
    ctImportPages = [];
    await ctAdminLoad();
    ctAdminSwitch('pairs');
  } catch(e) { showToast('❌ 匯入失敗：'+authErrMsg(e),'error'); console.error(e); }
  hideLoading();
};


// 登出時由 app.js 呼叫，清掉本模組狀態
window.ctResetState = function() { ctStudents = []; ctContacts = []; ctLoadedFrom = null; ctOpenStudentId = null; ctImportPages = []; };
