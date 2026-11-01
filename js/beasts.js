// 百宏文教 · 百宏靈獸 — 老師／主管端
// 沿用 bhcs-system 的 Firebase 專案與老師帳號（logins/{userId} → 合成信箱 → Auth；teachers/{uid}）。
// 事件綁定走 inline onclick，所以對外函式掛在 window.*。
//
// Firestore（規則見 firestore.rules）：
//   beastConfig/main        : 主管設定（缺的欄位用 beast-core.js 的 DEFAULT_CONFIG）
//   beasts/{token}          : 一個學生一隻靈獸，跨班共用；token 同時是學生 QR 連結的鑰匙（不可列舉）
//   beasts/{token}/log/{id} : 加分／扣分／靈石／購買／試煉紀錄（可撤銷）
//   beastTasks/{id}         : 任務（靈石），依 classId
//   beastClass/{classId}    : 班級狀態：全班目標、本週靈石發放總額、管家狀態、月統計
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { REALMS, STAGE_NAMES, TRIAL_HINTS, BEASTS, BEAST_MAP, SHOP, SHOP_MAP, DEFAULT_CONFIG, mergeConfig,
  weekKey, dayKey, monthKey, multiplier, capWeekPts, capWeekStones, capHoldStones, realmFor, realmInfo, nextRealm, progress,
  trialPending, trialCooldownLeft, newBeast, normName, rollWeek, applyPts, penaltyPts, penaltyStones, grantStones,
  stageOf, imgSrc, imgFallback, imgScared, fmtTs, randomId,
  DECO, DECO_CATS, DECO_MAP, decoClasses, titleOf, FORGE_MAX, forgeCost, forgeStars } from "./beast-core.js";
import { qrSvg } from "./vendor/qr.js";

const firebaseConfig = {
  apiKey: "AIzaSyA4l5zcyEVzbLfpeCbDvDjQsw2Rfkfizao",
  authDomain: "bhcs-system.firebaseapp.com",
  projectId: "bhcs-system",
  storageBucket: "bhcs-system.firebasestorage.app",
  messagingSenderId: "920353312937",
  appId: "1:920353312937:web:7517cabddd3aacd83659b8"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const AUTH_DOMAIN_SUFFIX = '@bhcs.local', ADMIN_USER = 'admin', ADMIN_EMAIL = 'admin@bhcs.local';

// ── state ──
let me = null;                 // { id, name, uid, isAdmin }
let cfg = mergeConfig(null);
let allClasses = [];           // 全校班級（算課程數用）
let myClasses = [];            // 可操作的班級
let courseCount = {};          // nameKey → 班級數
let cls = null;                // 目前班級
let beasts = {};               // nameKey → { _id, ...doc }
let prevBeasts = {};           // 上一版（偵測變化做動畫）
let classState = {};           // beastClass/{classId}
let tasks = [];
let unsubs = [];
let openBeastId = null;        // 學生面板
let openLogs = [];
let stTab = 'award';
let projectorOn = false;

// ── UI utils ──
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _toastT = null;
function showToast(msg, type = 'success') { const t = $('toast'); t.textContent = msg; t.className = `toast show ${type}`; clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function showLoading(msg = '處理中...') { $('loadingText').textContent = msg; $('loadingOverlay').classList.add('show'); }
function hideLoading() { $('loadingOverlay').classList.remove('show'); }
function authErrMsg(e) {
  const c = e?.code || '';
  if (/wrong-password|invalid-credential|invalid-login-credentials|user-not-found/.test(c)) return '帳號或密碼錯誤';
  if (/too-many-requests/.test(c)) return '嘗試次數過多，請稍後再試';
  if (/network-request-failed/.test(c)) return '連線失敗，請檢查網路';
  if (/permission-denied/.test(c)) return '沒有權限（請確認 firestore.rules 已更新）';
  return e?.message || String(e);
}
// 受驚中用專屬受驚圖；該隻還沒有受驚圖時退回一般圖並加 CSS 灰階抖動（class fx）
const img = (b, extra = '', scared = false) => {
  const st = stageOf(b.realm), normal = imgSrc(b.beast, st), svg = imgFallback(b.beast, st);
  const fallback = `this.onerror=function(){this.onerror=null;this.src='${svg}'};this.src='${normal}';this.classList.add('fx')`;
  return `<div class="beast-art">${scared ? `<img class="beast-img" src="${imgScared(b.beast, st)}" onerror="${fallback}" alt="${esc(BEAST_MAP[b.beast]?.name || '')}" ${extra}>`
    : `<img class="beast-img" src="${normal}" onerror="this.onerror=null;this.src='${svg}'" alt="${esc(BEAST_MAP[b.beast]?.name || '')}" ${extra}>`}</div>`;
};
const beastLink = id => location.origin + location.pathname.replace(/beasts\.html$/, 'beast.html') + '?t=' + id;

// ══════════════════════════════════════════════════════════════
// 登入
// ══════════════════════════════════════════════════════════════
window.login = async function () {
  const userId = $('loginUser').value.trim(), pass = $('loginPass').value;
  $('loginErr').textContent = '';
  if (!userId || !pass) { $('loginErr').textContent = '請輸入帳號與密碼'; return; }
  showLoading('驗證中...');
  try {
    let email = ADMIN_EMAIL;
    if (userId.includes('@')) email = userId;
    else if (userId !== ADMIN_USER) {
      const ls = await getDoc(doc(db, 'logins', userId));
      if (!ls.exists()) { hideLoading(); $('loginErr').textContent = '帳號或密碼錯誤'; return; }
      email = ls.data().authEmail;
    }
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await enterApp(cred.user);
  } catch (e) { hideLoading(); console.error(e); $('loginErr').textContent = authErrMsg(e); }
};
async function enterApp(user) {
  showLoading('載入中...');
  try {
    let isAdmin = user.email === ADMIN_EMAIL;
    if (!isAdmin && user.email && !user.email.endsWith(AUTH_DOMAIN_SUFFIX)) {
      const ad = await getDoc(doc(db, 'admins', user.uid)).catch(() => null);
      isAdmin = !!(ad && ad.exists());
      if (!isAdmin) { await signOut(auth); hideLoading(); $('loginErr').textContent = '此帳號不是主管帳號'; return; }
    }
    if (isAdmin) me = { id: ADMIN_USER, name: '主管', uid: user.uid, isAdmin: true };
    else {
      const ts = await getDoc(doc(db, 'teachers', user.uid));
      if (!ts.exists()) { await signOut(auth); hideLoading(); $('loginErr').textContent = '此帳號已停用，請聯絡主管'; return; }
      me = { id: ts.data().userId, name: ts.data().name, uid: user.uid, isAdmin: false };
    }
    await loadConfig();
    await loadClasses();
    $('userBadge').textContent = me.name;
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = me.isAdmin ? '' : 'none');
    $('loginPage').style.display = 'none'; $('appPage').style.display = '';
    hideLoading();
    const last = localStorage.getItem('beast.class');
    if (last && myClasses.some(c => c._id === last)) { $('classSelect').value = last; selectClass(last); }
  } catch (e) { hideLoading(); console.error(e); $('loginErr').textContent = authErrMsg(e); }
}
let _authInit = false;
onAuthStateChanged(auth, user => { if (_authInit) return; _authInit = true; if (user) enterApp(user); });
window.logout = async function () {
  stopSteward(true);
  unsubs.forEach(u => u()); unsubs = [];
  try { await signOut(auth); } catch (e) { console.error(e); }
  me = null; cls = null; beasts = {}; myClasses = [];
  $('appPage').style.display = 'none'; $('loginPage').style.display = '';
};

// ══════════════════════════════════════════════════════════════
// 設定與班級
// ══════════════════════════════════════════════════════════════
async function loadConfig() {
  const s = await getDoc(doc(db, 'beastConfig', 'main')).catch(() => null);
  cfg = mergeConfig(s && s.exists() ? s.data() : null);
  applyThresholds(cfg.thresholds || null);
  $('goalPts').textContent = cfg.caps.classGoalPts;
  $('stDb').value = cfg.steward.dbAbove; $('stHold').value = cfg.steward.holdSec; $('stCool').value = cfg.steward.cooldownSec; $('stLevel').value = cfg.steward.level;
}
async function loadClasses() {
  const snap = await getDocs(collection(db, 'classes'));
  allClasses = snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  courseCount = {};
  for (const c of allClasses) for (const n of new Set((c.students || []).map(normName))) courseCount[n] = (courseCount[n] || 0) + 1;
  myClasses = me.isAdmin ? allClasses : allClasses.filter(c => c.teacherId === me.id || (c.memberIds || []).includes(me.id));
  $('classSelect').innerHTML = '<option value="">選擇班級…</option>' + myClasses.map(c => `<option value="${c._id}">${esc(c.name)}（${(c.students || []).length}人）</option>`).join('');
}
window.selectClass = function (id) {
  unsubs.forEach(u => u()); unsubs = [];
  cls = myClasses.find(c => c._id === id) || null;
  beasts = {}; prevBeasts = {}; classState = {}; tasks = [];
  localStorage.setItem('beast.class', id || '');
  $('goalCard').style.display = cls ? '' : 'none';
  if (!cls) { $('beastGrid').innerHTML = '<div class="empty">請先選擇班級</div>'; $('classStats').innerHTML = ''; $('taskList').innerHTML = ''; return; }
  // 靈獸（依姓名 in 查詢，每 30 人一組）
  const keys = [...new Set((cls.students || []).map(normName).filter(Boolean))];
  for (let i = 0; i < keys.length; i += 30) {
    const chunk = keys.slice(i, i + 30);
    unsubs.push(onSnapshot(query(collection(db, 'beasts'), where('nameKey', 'in', chunk)), snap => {
      snap.docChanges().forEach(ch => {
        const d = { _id: ch.doc.id, ...ch.doc.data() };
        if (ch.type === 'removed') delete beasts[d.nameKey]; else beasts[d.nameKey] = d;
      });
      renderGrid(); if (openBeastId) renderStudent(false);
    }, e => { console.error(e); showToast('讀取靈獸失敗：' + authErrMsg(e), 'error'); }));
  }
  unsubs.push(onSnapshot(doc(db, 'beastClass', cls._id), snap => { classState = snap.exists() ? snap.data() : {}; renderClassBar(); renderGrid(); renderStewardRemote(); }));
  unsubs.push(onSnapshot(query(collection(db, 'beastTasks'), where('classId', '==', cls._id)), snap => { tasks = snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt); renderTasks(); }));
  renderGrid(); renderTaskPick();
};
function csWeek() { const wk = weekKey(); const iss = classState.issued || {}; return iss.weekKey === wk ? (iss.total || 0) : 0; }
function classBudget() { return (cls?.students || []).length * cfg.caps.classWeekPerStudent; }
function scaredNow() { const s = classState.steward || {}; return s.scaredUntil > Date.now() && (s.scaredLevel === 'mid' || s.scaredLevel === 'heavy'); }   // 加分減半
function scaredVisual() { const s = classState.steward || {}; return s.scaredUntil > Date.now(); }   // 受驚圖＋抖動（輕級也有）
function renderClassBar() {
  if (!cls) return;
  const used = csWeek(), budget = classBudget();
  const g = classState.goal || {}; const wk = weekKey();
  const chips = [`<span class="chip">本週靈石額度 ${used}/${budget}${used >= budget ? '（已用完）' : ''}</span>`];
  if (scaredVisual()) chips.push(`<span class="chip bad">😨 受驚中${scaredNow() ? '，加分減半' : ''}至 ${fmtTs(classState.steward.scaredUntil).slice(-5)}</span>`);
  if ((classState.steward || {}).on) chips.push(`<span class="chip warn">🔔 管家 ${classState.steward.strikes || 0}/2</span>`);
  $('classStats').innerHTML = chips.join('');
  if (document.activeElement !== $('goalText')) $('goalText').value = g.weekKey === wk ? (g.text || '') : '';
  const blocked = g.blockedWeek === wk, done = g.doneWeek === wk;
  $('goalBtn').disabled = blocked || done || !(g.weekKey === wk && g.text);
  $('goalNote').textContent = blocked ? '本週全班目標已因管家懲罰取消' : done ? '本週已達成並加分 ✅' : '老師自訂目標；達成由老師按鈕核定，每人加分不計入每週上限。';
  if (projectorOn) renderProjector();
}

// ══════════════════════════════════════════════════════════════
// 課堂：靈獸格
// ══════════════════════════════════════════════════════════════
function cardHtml(b, name, pj = false) {
  if (!b) return `<div class="beast-card unassigned" data-name="${esc(name)}" onclick="openPick(this.dataset.name)"><div style="font-size:40px;margin:14px 0">🥚</div><div class="beast-name">${esc(name)}</div><div class="beast-pet">尚未選獸，點我選擇</div></div>`;
  const info = BEAST_MAP[b.beast] || BEASTS[0], r = realmInfo(b.realm), nxt = nextRealm(b.realm);
  const pend = trialPending(b);
  const scared = scaredVisual() && !(b.items || {}).dingxin;
  const title = titleOf(b), stars = forgeStars(b.forge);
  return `<div class="${pj ? 'pj-card' : 'beast-card'} stage-${r.stage} ${scared ? 'scared' : ''} ${decoClasses(b)}" style="--c:${info.color}" data-id="${b._id}" ${pj ? '' : `onclick="openStudent('${b._id}')"`}>
    ${stars ? `<span class="forge-stars">${stars}</span>` : ''}${b.julingActive ? '<span class="mark2">聚靈</span>' : ''}
    ${img(b, '', scared)}
    <div class="beast-name">${esc(b.name)}</div>
    <div class="beast-pet">${esc(b.petName || info.name)}</div>${title ? `<div class="beast-title">${esc(title)}</div>` : ''}
    <div class="beast-realm ${pend ? 'trial' : ''}">${r.name}${pend ? ' · 待試煉' : ''}</div>
    <div class="progress"><div class="progress-bar" style="width:${Math.round(progress(b.pts, b.realm) * 100)}%"></div></div>
    <div class="beast-foot"><span>${b.pts}${nxt ? '/' + nxt.pts : ''} 靈氣</span><span class="stone">💎 ${b.stones || 0}</span></div>
  </div>`;
}
function renderGrid() {
  if (!cls) return;
  const names = cls.students || [];
  $('beastGrid').innerHTML = names.map(n => cardHtml(beasts[normName(n)], n)).join('') || '<div class="empty">這個班還沒有學生</div>';
  animateDiff('#beastGrid');
  if (projectorOn) renderProjector();
  prevBeasts = Object.fromEntries(Object.entries(beasts).map(([k, v]) => [k, { pts: v.pts, realm: v.realm, stones: v.stones }]));
}
// 偵測靈氣／境界變化 → 浮動數字、進化動畫、投影橫幅
function animateDiff(scope) {
  for (const [k, b] of Object.entries(beasts)) {
    const p = prevBeasts[k]; if (!p) continue;
    const el = document.querySelector(`${scope} [data-id="${b._id}"]`); if (!el) continue;
    const dp = b.pts - p.pts, ds = (b.stones || 0) - (p.stones || 0);
    if (dp) float(el, (dp > 0 ? '+' : '') + dp, dp < 0 ? 'neg' : '');
    if (ds) float(el, (ds > 0 ? '+' : '') + ds + ' 💎', 'stone');
    if (dp > 0 && b.realm === p.realm) { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 600); }
    if (b.realm > p.realm) {
      el.classList.add('evolve'); setTimeout(() => el.classList.remove('evolve'), 1700);
      const info = BEAST_MAP[b.beast], r = realmInfo(b.realm);
      const skillIdx = [2, 4, 7, 10].indexOf(b.realm);
      banner(`${esc(b.name)} 突破 · ${r.name}`, skillIdx >= 0 ? `習得「${info.skills[skillIdx]}」` : (b.realm === 12 ? `本命神通「${info.ultimate}」` : r.unlock), info.color);
    }
  }
}
function float(el, text, cls2 = '') { const f = document.createElement('div'); f.className = 'float-pts ' + cls2; f.textContent = text; el.appendChild(f); setTimeout(() => f.remove(), 1300); }
let _bannerT = null;
function banner(main, sub, color) {
  if (!projectorOn) return;
  const b = $('pjBanner'); b.innerHTML = `${main}<small>${sub || ''}</small>`; b.style.setProperty('--c', color || '#fff');
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(_bannerT); _bannerT = setTimeout(() => b.classList.remove('show'), 2500);
}

// ══════════════════════════════════════════════════════════════
// 選獸 / 換獸
// ══════════════════════════════════════════════════════════════
let pickFor = null;   // { name } 或 { beastId, mode:'free'|'xisui'|'reset' }
window.openPick = function (name) { pickFor = { name }; $('pickTitle').textContent = `${name} · 選擇本命靈獸`; $('pickSub').textContent = '入學時選定；結丹（第 3 境）前可免費換一次。'; renderPick(); $('pickModal').classList.add('show'); };
window.closePick = function () { $('pickModal').classList.remove('show'); pickFor = null; };
function renderPick() {
  $('pickGrid').innerHTML = BEASTS.map(b => `<div class="pick-card" style="--c:${b.color}" onclick="pickBeast('${b.key}')">
    <img src="${imgSrc(b.key, 1)}" onerror="this.onerror=null;this.src='${imgFallback(b.key, 1)}'" alt="${b.name}">
    <div class="pk-name">${b.name}</div><div class="pk-attr">${b.attr} · ${b.talent}</div><div class="pk-fit">${b.fit}</div></div>`).join('');
}
window.pickBeast = async function (key) {
  if (!pickFor) return;
  try {
    if (pickFor.name) {
      const nk = normName(pickFor.name);
      if (beasts[nk]) { showToast('這位學生已經有靈獸了', 'error'); closePick(); return; }
      // 同名學生在別班可能已建過：先查
      const ex = await getDocs(query(collection(db, 'beasts'), where('nameKey', '==', nk)));
      if (!ex.empty) { showToast('這個姓名已有靈獸（可能在別班建立），重新整理後可見', 'error'); closePick(); return; }
      const id = randomId();
      const b = newBeast(pickFor.name, key, courseCount[nk] || 1);
      await setDoc(doc(db, 'beasts', id), b);
      await addLog(id, { type: 'new', delta: 0, stones: 0, reason: `選定本命靈獸：${BEAST_MAP[key].name}` });
      showToast(`${pickFor.name} 的本命靈獸：${BEAST_MAP[key].name}`);
    } else {
      await swapBeast(pickFor.beastId, key, pickFor.mode);
    }
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
  closePick();
};

// ══════════════════════════════════════════════════════════════
// 交易核心
// ══════════════════════════════════════════════════════════════
function logBase(extra) {
  return { ts: Date.now(), by: me.id, byName: me.name, classId: cls?._id || '', className: cls?.name || '', undone: false, delta: 0, stones: 0, reason: '', ...extra };
}
async function addLog(beastId, extra) { await addDoc(collection(db, 'beasts', beastId, 'log'), logBase(extra)); }
// 月統計（寫在 beastClass，報表直接讀）
function statPatch(cs, field, n) {
  if (!cls || !n) return {};
  const mk = monthKey(); const stats = { ...(cs.stats || {}) }; const m = { ...(stats[mk] || {}) };
  m[field] = (m[field] || 0) + n; stats[mk] = m; return { stats };
}
// 通用交易：fn(b, cs) → { patch, log, csPatch }；自動重算境界、寫 log、更新班級統計
async function tx(beastId, fn, { touchClass = false } = {}) {
  const bref = doc(db, 'beasts', beastId);
  const cref = cls ? doc(db, 'beastClass', cls._id) : null;
  return runTransaction(db, async t => {
    const bs = await t.get(bref); if (!bs.exists()) throw new Error('找不到靈獸');
    const b = { _id: beastId, ...bs.data() };
    let cs = {};
    if (cref && touchClass) { const c = await t.get(cref); cs = c.exists() ? c.data() : {}; }
    const r = fn(b, cs) || {};
    if (r.abort) return { aborted: r.abort };
    const patch = { ...(r.patch || {}), updatedAt: Date.now() };
    const nb = { ...b, ...patch };
    const newRealm = realmFor(nb.pts, nb.trials || {});
    const realmLog = [];
    if (newRealm !== b.realm) { patch.realm = newRealm; if (newRealm === 12) patch.hall = true; if (newRealm > b.realm) realmLog.push(logBase({ type: 'realm', reason: `突破 → ${realmInfo(newRealm).name}` })); }
    t.update(bref, patch);
    if (r.log) t.set(doc(collection(bref, 'log')), logBase(r.log));
    for (const l of realmLog) t.set(doc(collection(bref, 'log')), l);
    if (r.logRef) t.update(r.logRef, r.logPatch);
    if (cref && (r.csPatch || r.stat)) {
      const cp = { ...(r.csPatch || {}), ...(r.stat ? statPatch(cs, r.stat[0], r.stat[1]) : {}), updatedAt: Date.now() };
      t.set(cref, cp, { merge: true });
    }
    return { patch, realmUp: newRealm > b.realm ? newRealm : 0, extra: r.extra };
  });
}

// ── 加分 ──
window.award = async function (beastId, pts, reason) {
  pts = pts | 0; if (pts <= 0 || !reason) return;
  try {
    const res = await tx(beastId, (b, cs) => {
      const st = cs.steward || {};
      const scared = st.scaredUntil > Date.now() && (st.scaredLevel === 'mid' || st.scaredLevel === 'heavy');
      const a = applyPts(b, pts, cfg, { scared });
      const patch = { ...a.rolled, pts: b.pts + a.delta, weekPts: (a.rolled.weekPts ?? b.weekPts ?? 0) + a.delta };
      if (a.usedDingxin) patch.items = { ...(b.items || {}), dingxin: b.items.dingxin - 1 };
      if (a.doubled) patch.julingActive = false;
      const note = [a.halved ? '受驚減半' : '', a.doubled ? '聚靈丹 ×2' : '', a.usedDingxin ? '定心符抵擋' : '', a.capped ? '達本週上限' : ''].filter(Boolean).join('、');
      return { patch, log: { type: 'pts', delta: a.delta, reason: reason + (note ? `（${note}）` : '') }, stat: ['ptsIssued', a.delta], extra: a };
    }, { touchClass: true });
    const a = res.extra;
    showToast(a.delta > 0 ? `+${a.delta} 靈氣${a.capped ? '（達本週上限）' : a.doubled ? '（聚靈丹 ×2）' : a.halved ? '（受驚減半）' : ''}` : '已達本週上限，未加分', a.delta > 0 ? 'success' : 'error');
  } catch (e) { console.error(e); showToast('加分失敗：' + authErrMsg(e), 'error'); }
};
// ── 懲罰（扣靈氣 / 扣靈石）──
window.penalize = async function (beastId, kind, n, reason) {
  n = Math.abs(n | 0); if (!n || !reason) { showToast('請填數量與原因', 'error'); return; }
  try {
    const r = await tx(beastId, b => {
      if (kind === 'pts') { const d = penaltyPts(b, n, cfg); if (!d) return { abort: '靈氣已在境界門檻，無法再扣' }; return { patch: { pts: b.pts - d }, log: { type: 'penalty', delta: -d, reason }, stat: ['penaltyPts', d] }; }
      const d = penaltyStones(b, n, cfg); if (!d) return { abort: '沒有靈石可扣' };
      return { patch: { stones: (b.stones || 0) - d }, log: { type: 'penalty', stones: -d, reason }, stat: ['penaltyStones', d] };
    }, { touchClass: true });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast('已記錄懲罰');
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
// ── 試煉 ──
window.trial = async function (beastId, pass) {
  try {
    const r = await tx(beastId, b => {
      const nxt = nextRealm(b.realm); if (!nxt || !nxt.trial || b.pts < nxt.pts) return { abort: '尚未達到試煉條件' };
      if (pass) return { patch: { trials: { ...(b.trials || {}), [nxt.lv]: true } }, log: { type: 'trial', reason: `${nxt.name} 突破試煉通過` } };
      return { patch: { trialFailAt: { ...(b.trialFailAt || {}), [nxt.lv]: Date.now() } }, log: { type: 'trial', reason: `${nxt.name} 突破試煉未通過，${cfg.trialCooldownDays} 天後可再挑戰` } };
    });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast(pass ? '試煉通過，突破！' : '已記錄，下次再挑戰');
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.usePojing = async function (beastId) {
  try {
    const r = await tx(beastId, b => {
      const nxt = nextRealm(b.realm); if (!(b.items || {}).pojing) return { abort: '沒有破境丹' };
      if (!nxt || !(b.trialFailAt || {})[nxt.lv]) return { abort: '目前不在冷卻中' };
      return { patch: { items: { ...b.items, pojing: b.items.pojing - 1 }, trialFailAt: { ...b.trialFailAt, [nxt.lv]: 0 } }, log: { type: 'item', reason: '使用破境丹，可當場重試試煉' } };
    });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast('破境丹生效，可重試');
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
// ── 商店 ──
window.buy = async function (beastId, key) {
  const item = SHOP_MAP[key]; if (!item) return;
  const price = (cfg.shopPrice || {})[key] ?? item.price;
  let petName = null;
  if (item.kind === 'rename') { petName = prompt('靈獸的新名字（最多 8 字）'); if (!petName) return; petName = petName.trim().slice(0, 8); }
  if (item.kind === 'swap') { pickFor = { beastId, mode: 'xisui' }; $('pickTitle').textContent = '洗髓丹 · 保留進度換獸'; $('pickSub').textContent = `花費 ${price} 靈石，境界與靈氣全數保留。`; renderPick(); $('pickModal').classList.add('show'); return; }
  try {
    const r = await tx(beastId, b => {
      const rolled = rollWeek(b); const wb = rolled.weekBuys ?? b.weekBuys ?? {};
      if ((b.stones || 0) < price) return { abort: `靈石不足（需要 ${price}）` };
      if (item.weeklyLimit && (wb[key] || 0) >= item.weeklyLimit) return { abort: '本週已買過，每週限購 1 顆' };
      const patch = { ...rolled, stones: b.stones - price, weekBuys: { ...wb, [key]: (wb[key] || 0) + 1 } };
      if (item.kind === 'rename') patch.petName = petName;
      else if (key === 'juling') patch.julingActive = true;
      else patch.items = { ...(b.items || {}), [key]: ((b.items || {})[key] || 0) + 1 };
      return { patch, log: { type: 'buy', stones: -price, reason: `購買 ${item.name}${petName ? '：' + petName : ''}` }, stat: ['stonesSpent', price] };
    }, { touchClass: true });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast(`已購買 ${item.name}`);
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
// ── 裝扮（DECO）與鍛體（增強）──
const decoPrice = id => (cfg.shopPrice || {})[id] ?? DECO_MAP[id]?.price ?? 0;
const SWATCH = { 'dye-frost': '#9ed8ff', 'dye-shadow': '#2a2d44', 'dye-gold': '#f6c343', 'dye-rainbow': 'conic-gradient(#ff6b6b,#f6c343,#4ecb8d,#4fd1e0,#7c5cff,#ff6b6b)',
  'aura-jade': '#4ecb8d', 'aura-violet': '#b58cf5', 'aura-gold': '#f6c343', 'aura-flame': '#ff6b6b', 'stand-cloud': '#ffffff', 'stand-jade': '#2f9d74', 'stand-lotus': '#ff8fc6', 'stand-gold': '#e0a419',
  'frame-bronze': '#b87333', 'frame-silver': '#d7dde5', 'frame-gold': '#f6c343', 'frame-rainbow': 'conic-gradient(#ff6b6b,#f6c343,#4ecb8d,#4fd1e0,#7c5cff,#ff6b6b)',
  'bg-bamboo': '#2f9d74', 'bg-sea': '#2b8ea0', 'bg-sakura': '#d97aa8', 'bg-night': '#3b3f6b' };
function decoHtml(b) {
  const owned = b.decoOwned || [], equip = b.equip || {}, id = b._id;
  return DECO_CATS.map(c => `<div class="deco-cat"><div class="deco-cat-title">${c.name}<span>${c.desc}</span></div><div class="deco-row">${DECO.filter(d => d.cat === c.key).map(d => {
    const has = owned.includes(d.id), on = equip[c.key] === d.id, price = decoPrice(d.id);
    const sw = c.key === 'title' ? '' : `<span class="sw" style="background:${SWATCH[d.id] || '#888'}"></span>`;
    return has ? `<button class="deco-chip owned ${on ? 'on' : ''}" onclick="equipDeco('${id}','${c.key}','${on ? '' : d.id}')">${sw}${esc(d.name)} ${on ? '✓ 裝備中' : '・裝備'}</button>`
      : `<button class="deco-chip" ${(b.stones || 0) < price ? 'disabled' : ''} onclick="buyDeco('${id}','${d.id}')">${sw}${esc(d.name)} <span class="pr">💎${price}</span></button>`;
  }).join('')}</div></div>`).join('');
}
function forgeHtml(b) {
  const lv = b.forge || 0, cost = forgeCost(lv);
  return `<div class="forge-box"><div style="flex:1"><div class="si-name">🔨 鍛體 Lv.${lv}/${FORGE_MAX} ${forgeStars(lv) ? `<span style="color:var(--gold)">${forgeStars(lv)}</span>` : ''}</div>
    <div class="si-desc">每級多一顆星；5 級閃光、10 級「極」。純展示，不影響靈氣。</div></div>
    ${lv >= FORGE_MAX ? '<span class="si-own">已滿級</span>' : `<span class="si-price">💎 ${cost}</span><button class="btn btn-teal btn-sm" ${(b.stones || 0) < cost ? 'disabled' : ''} onclick="forgeUp('${b._id}')">鍛體</button>`}</div>`;
}
window.buyDeco = async function (beastId, decoId) {
  const d = DECO_MAP[decoId]; if (!d) return; const price = decoPrice(decoId);
  try {
    const r = await tx(beastId, b => {
      if ((b.decoOwned || []).includes(decoId)) return { abort: '已經擁有' };
      if ((b.stones || 0) < price) return { abort: `靈石不足（需要 ${price}）` };
      return { patch: { ...rollWeek(b), stones: b.stones - price, decoOwned: [...(b.decoOwned || []), decoId], equip: { ...(b.equip || {}), [d.cat]: decoId } },
        log: { type: 'buy', stones: -price, reason: `購買裝扮：${DECO_CATS.find(c => c.key === d.cat).name}・${d.name}` }, stat: ['stonesSpent', price] };
    }, { touchClass: true });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast(`已購買並裝備「${d.name}」`);
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.equipDeco = async function (beastId, cat, decoId) {
  try {
    const r = await tx(beastId, b => {
      if (decoId && !(b.decoOwned || []).includes(decoId)) return { abort: '尚未擁有' };
      const equip = { ...(b.equip || {}) }; if (decoId) equip[cat] = decoId; else delete equip[cat];
      return { patch: { equip } };
    });
    if (r.aborted) showToast(r.aborted, 'error');
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.forgeUp = async function (beastId) {
  try {
    const r = await tx(beastId, b => {
      const lv = b.forge || 0, cost = forgeCost(lv);
      if (lv >= FORGE_MAX) return { abort: '已滿級' };
      if ((b.stones || 0) < cost) return { abort: `靈石不足（需要 ${cost}）` };
      return { patch: { ...rollWeek(b), stones: b.stones - cost, forge: lv + 1 }, log: { type: 'buy', stones: -cost, reason: `鍛體 Lv.${lv} → Lv.${lv + 1}` }, stat: ['stonesSpent', cost], extra: lv + 1 };
    }, { touchClass: true });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast(r.extra >= FORGE_MAX ? '鍛體滿級：極！' : `鍛體升到 Lv.${r.extra}`);
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.buyReal = async function (beastId, idx) {
  const rw = cfg.realReward[idx]; if (!rw) return;
  if (!confirm(`兌換「${rw.label}」，花費 ${rw.price} 靈石？由你（${me.name}）負責兌現。`)) return;
  try {
    const r = await tx(beastId, b => { if ((b.stones || 0) < rw.price) return { abort: '靈石不足' }; return { patch: { ...rollWeek(b), stones: b.stones - rw.price }, log: { type: 'buy', stones: -rw.price, reason: `兌換現實獎勵：${rw.label}` }, stat: ['stonesSpent', rw.price] }; }, { touchClass: true });
    if (r.aborted) showToast(r.aborted, 'error'); else showToast('已兌換，請記得兌現');
  } catch (e) { console.error(e); showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.startSwap = function (beastId, mode) {
  pickFor = { beastId, mode };
  $('pickTitle').textContent = mode === 'free' ? '免費換獸（一次）' : '重新開始換獸';
  $('pickSub').textContent = mode === 'free' ? '境界與靈氣全數保留；免費機會只有一次。' : '⚠️ 境界與靈氣歸零、試煉紀錄清除，靈石與道具保留。';
  renderPick(); $('pickModal').classList.add('show');
};
async function swapBeast(beastId, key, mode) {
  const price = (cfg.shopPrice || {}).xisui ?? SHOP_MAP.xisui.price;
  const r = await tx(beastId, b => {
    if (b.beast === key) return { abort: '跟原本一樣' };
    const name = BEAST_MAP[key].name;
    if (mode === 'free') { if (b.swapUsed || b.realm > cfg.swapFreeMaxRealm) return { abort: '免費換獸已用完或境界過高' }; return { patch: { beast: key, swapUsed: true }, log: { type: 'swap', reason: `免費換獸 → ${name}` } }; }
    if (mode === 'xisui') { if ((b.stones || 0) < price) return { abort: `靈石不足（需要 ${price}）` }; return { patch: { ...rollWeek(b), beast: key, stones: b.stones - price }, log: { type: 'swap', stones: -price, reason: `洗髓丹換獸 → ${name}` }, stat: ['stonesSpent', price] }; }
    return { patch: { beast: key, realm: 1, pts: 0, trials: {}, trialFailAt: {}, weekPts: 0 }, log: { type: 'swap', reason: `重新開始換獸 → ${name}` } };
  }, { touchClass: true });
  if (r.aborted) showToast(r.aborted, 'error'); else showToast('已換獸');
}
// ── 撤銷（當天、自己或主管）──
window.undoLog = async function (beastId, logId) {
  try {
    const bref = doc(db, 'beasts', beastId), lref = doc(db, 'beasts', beastId, 'log', logId);
    const cref = cls ? doc(db, 'beastClass', cls._id) : null;
    const out = await runTransaction(db, async t => {
      const [bs, ls] = await Promise.all([t.get(bref), t.get(lref)]);
      const cs = cref ? (await t.get(cref)).data() || {} : {};
      const b = bs.data(), l = ls.data();
      if (!l || l.undone) throw new Error('已撤銷');
      if (dayKey(l.ts) !== dayKey()) throw new Error('只能撤銷當天的紀錄');
      if (!me.isAdmin && l.by !== me.id) throw new Error('只能撤銷自己的紀錄');
      if (!['pts', 'penalty', 'stones', 'goal'].includes(l.type)) throw new Error('此類紀錄不能撤銷');
      const sameWeek = weekKey(l.ts) === weekKey();
      const patch = { updatedAt: Date.now() };
      if (l.delta) { patch.pts = Math.max(0, b.pts - l.delta); if (sameWeek && l.delta > 0 && l.type === 'pts') patch.weekPts = Math.max(0, (b.weekPts || 0) - l.delta); }
      if (l.stones) { patch.stones = Math.max(0, (b.stones || 0) - l.stones); if (sameWeek && l.stones > 0) patch.weekStones = Math.max(0, (b.weekStones || 0) - l.stones); }
      const nb = { ...b, ...patch }; patch.realm = realmFor(nb.pts, nb.trials || {});
      t.update(bref, patch);
      t.update(lref, { undone: true, undoneAt: Date.now(), undoneBy: me.id });
      t.set(doc(collection(bref, 'log')), logBase({ type: 'undo', reason: `撤銷：${l.reason}`, delta: -(l.delta || 0), stones: -(l.stones || 0) }));
      if (cref) {
        const cp = { updatedAt: Date.now() };
        if (l.stones > 0 && sameWeek) { const iss = cs.issued || {}; cp.issued = { weekKey: weekKey(), total: Math.max(0, (iss.weekKey === weekKey() ? iss.total || 0 : 0) - l.stones) }; }
        const f = l.type === 'pts' || l.type === 'goal' ? ['ptsIssued', -l.delta] : l.type === 'stones' ? ['stonesIssued', -l.stones] : l.delta ? ['penaltyPts', l.delta] : ['penaltyStones', l.stones];
        Object.assign(cp, statPatch(cs, f[0], f[1]));
        t.set(cref, cp, { merge: true });
      }
      return true;
    });
    if (out) showToast('已撤銷');
  } catch (e) { console.error(e); showToast(e.message || '撤銷失敗', 'error'); }
};
// ── 全班目標 ──
window.saveGoal = async function () {
  if (!cls) return; const text = $('goalText').value.trim();
  await setDoc(doc(db, 'beastClass', cls._id), { goal: { ...(classState.goal || {}), text, weekKey: weekKey() }, updatedAt: Date.now() }, { merge: true }).catch(e => showToast(authErrMsg(e), 'error'));
};
window.awardGoal = async function () {
  if (!cls) return; const g = classState.goal || {}; const wk = weekKey();
  if (g.doneWeek === wk || g.blockedWeek === wk) return;
  if (!confirm(`全班達成「${g.text}」，每人 +${cfg.caps.classGoalPts} 靈氣？`)) return;
  showLoading('發放中...');
  let n = 0;
  for (const b of Object.values(beasts)) {
    try { await tx(b._id, bb => ({ patch: { ...rollWeek(bb), pts: bb.pts + cfg.caps.classGoalPts }, log: { type: 'goal', delta: cfg.caps.classGoalPts, reason: `全班目標達成：${g.text}` }, stat: ['ptsIssued', cfg.caps.classGoalPts] }), { touchClass: true }); n++; } catch (e) { console.error(e); }
  }
  await setDoc(doc(db, 'beastClass', cls._id), { goal: { ...g, doneWeek: wk }, updatedAt: Date.now() }, { merge: true });
  hideLoading(); showToast(`已為 ${n} 位學生加分`);
};

// ══════════════════════════════════════════════════════════════
// 學生面板
// ══════════════════════════════════════════════════════════════
let unsubLog = null;
window.openStudent = function (id) {
  openBeastId = id; stTab = 'award'; openLogs = [];
  if (unsubLog) unsubLog();
  unsubLog = onSnapshot(query(collection(db, 'beasts', id, 'log'), orderBy('ts', 'desc'), limit(40)), s => { openLogs = s.docs.map(d => ({ _id: d.id, ...d.data() })); if (stTab === 'log') renderStudent(); });
  renderStudent(); $('studentModal').classList.add('show');
};
window.closeStudent = function () { $('studentModal').classList.remove('show'); openBeastId = null; if (unsubLog) { unsubLog(); unsubLog = null; } };
window.smTab = function (t) { stTab = t; renderStudent(true); };
function curBeast() { return Object.values(beasts).find(b => b._id === openBeastId); }
function renderStudent(full = true) {
  const b = curBeast(); if (!b) return;
  const info = BEAST_MAP[b.beast], r = realmInfo(b.realm), nxt = nextRealm(b.realm), mult = multiplier(b.courseCount, cfg);
  $('smImg').innerHTML = img(b, '', scaredVisual() && !(b.items || {}).dingxin);
  $('smName').textContent = `${b.name}${b.petName ? '・' + b.petName : ''}`;
  $('smRealm').textContent = `第 ${b.realm} 境 ${r.name} · ${STAGE_NAMES[r.stage]}${info.name} · ${info.attr}`;
  $('smBar').style.width = Math.round(progress(b.pts, b.realm) * 100) + '%'; $('smBar').style.setProperty('--c', info.color);
  const wk = rollWeek(b); const wp = wk.weekPts ?? b.weekPts ?? 0, ws = wk.weekStones ?? b.weekStones ?? 0;
  $('smMeta').innerHTML = `靈氣 <b>${b.pts}</b>${nxt ? `／下一境 ${nxt.name} ${nxt.pts}` : '（已登頂）'} · 靈石 <b style="color:var(--stone)">💎 ${b.stones || 0}</b><br>
    本週靈氣 ${wp}/${capWeekPts(b.courseCount, cfg)} · 本週靈石 ${ws}/${capWeekStones(b.courseCount, cfg)} · ${b.courseCount} 門課 ×${mult}<br>
    天賦「${info.talent}」· 已習得 ${[2, 4, 7, 10].filter(x => b.realm >= x).map(x => info.skills[[2, 4, 7, 10].indexOf(x)]).join('、') || '尚無招式'}${b.realm === 12 ? ` · 神通「${info.ultimate}」` : ''}`;
  document.querySelectorAll('#smTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.st === stTab));
  document.querySelectorAll('.st-pane').forEach(p => p.style.display = 'none');
  $('st-' + stTab).style.display = '';
  const id = b._id;
  if (!full && (stTab === 'award' || stTab === 'penalty') && $('st-' + stTab).innerHTML) return;   // 快照更新時不要蓋掉老師正在打的字
  if (stTab === 'award') {
    $('st-award').innerHTML = `<div class="reason-grid">${cfg.reasons.map(x => `<button class="reason-btn" onclick="award('${id}',${x.pts},'${esc(x.label)}')"><span>${esc(x.label)}</span><b>+${x.pts}</b></button>`).join('')}</div>
      <div class="custom-row"><input class="field-input" id="awReason" placeholder="自訂原因"><input class="field-input" id="awPts" type="number" min="1" max="10" value="1"><button class="btn btn-teal btn-sm" onclick="award('${id}',+document.getElementById('awPts').value,document.getElementById('awReason').value.trim())">加分</button></div>
      ${scaredNow() && !(b.items || {}).dingxin ? '<div class="hint">😨 全班受驚中：加分減半（無條件進位）。</div>' : ''}${b.julingActive ? '<div class="hint">✨ 聚靈丹生效中：下一次加分 ×2。</div>' : ''}`;
  } else if (stTab === 'penalty') {
    $('st-penalty').innerHTML = `<div class="hint" style="margin:0 0 10px">靈氣最多扣到目前境界門檻（${r.pts}），不會跌境；單次最多扣 ${cfg.caps.penaltyPtsMax} 靈氣、${cfg.caps.penaltyStonesMax} 靈石。原因必填，當天可撤銷。</div>
      <div class="custom-row"><select class="select-input" id="pnKind" style="width:110px;flex:none"><option value="pts">扣靈氣</option><option value="stones">扣靈石</option></select>
        <select class="select-input" id="pnReason">${cfg.penaltyReasons.map(x => `<option>${esc(x)}</option>`).join('')}<option value="__c">自訂…</option></select>
        <input class="field-input" id="pnCustom" placeholder="自訂原因" style="display:none"></div>
      <div class="reason-grid" style="margin-top:10px">${[1, 3, 5].map(n => `<button class="reason-btn neg" onclick="doPenalty('${id}',${n})"><span>扣 ${n}</span><b>−${n}</b></button>`).join('')}
        <div class="custom-row" style="margin:0"><input class="field-input" id="pnN" type="number" min="1" placeholder="自訂數量"><button class="btn btn-primary btn-sm" onclick="doPenalty('${id}',+document.getElementById('pnN').value)">扣</button></div></div>`;
    $('pnReason').onchange = () => { $('pnCustom').style.display = $('pnReason').value === '__c' ? '' : 'none'; };
  } else if (stTab === 'trial') {
    const pend = trialPending(b), cd = trialCooldownLeft(b, cfg);
    const nt = nxt && nxt.trial ? nxt : null;
    $('st-trial').innerHTML = !nt ? `<div class="trial-box">下一境 ${nxt ? nxt.name : '—'} 不需試煉，靈氣達門檻自動突破。</div>` :
      `<div class="trial-box"><div class="tb-title">⚡ ${nt.name} 突破試煉（第 ${nt.lv} 境）</div><div class="hint" style="margin:0 0 10px">${esc(TRIAL_HINTS[nt.lv] || '')}<br>標準僅供參考，由老師核定。</div>
       ${!pend ? `<div>靈氣 ${b.pts}/${nt.pts}，尚未達門檻。</div>` : cd > 0 ? `<div>上次未通過，冷卻剩 ${Math.ceil(cd / 86400000)} 天。${(b.items || {}).pojing ? `<button class="btn btn-purple btn-sm" onclick="usePojing('${id}')">用破境丹當場重試（剩 ${b.items.pojing}）</button>` : ''}</div>` :
       `<div style="display:flex;gap:10px"><button class="btn btn-teal" onclick="trial('${id}',true)">✅ 通過</button><button class="btn btn-ghost" onclick="trial('${id}',false)">❌ 未通過</button></div>`}</div>`;
  } else if (stTab === 'shop') {
    const own = k => { const s = SHOP_MAP[k]; if (s.kind === 'item') return (b.items || {})[k] ? `持有 ${b.items[k]}` : ''; if (k === 'juling') return b.julingActive ? '生效中' : ''; return ''; };
    const price = k => (cfg.shopPrice || {})[k] ?? SHOP_MAP[k].price;
    $('st-shop').innerHTML = `<div class="hint" style="margin:0 0 10px">購買只在補習班由老師操作；學生可在 QR 頁的衣櫃自己換已擁有的裝扮。持有上限 ${capHoldStones(b.courseCount, cfg)} 靈石。</div>
      <div class="shop-list">${SHOP.map(s => `<div class="shop-item"><div style="flex:1"><div class="si-name">${s.name}</div><div class="si-desc">${s.desc}</div></div><span class="si-own">${own(s.key)}</span><span class="si-price">💎 ${price(s.key)}</span><button class="btn btn-teal btn-sm" ${(b.stones || 0) < price(s.key) ? 'disabled' : ''} onclick="buy('${id}','${s.key}')">買</button></div>`).join('')}
      ${cfg.realReward.map((rw, i) => `<div class="shop-item"><div style="flex:1"><div class="si-name">🎁 ${esc(rw.label)}</div><div class="si-desc">現實獎勵，由發放老師兌現</div></div><span class="si-price">💎 ${rw.price}</span><button class="btn btn-purple btn-sm" ${(b.stones || 0) < rw.price ? 'disabled' : ''} onclick="buyReal('${id}',${i})">兌換</button></div>`).join('')}</div>
      <div class="custom-row" style="margin-top:14px">${!b.swapUsed && b.realm <= cfg.swapFreeMaxRealm ? `<button class="btn btn-ghost btn-sm" onclick="startSwap('${id}','free')">🔁 免費換獸（保留進度，限一次）</button>` : ''}<button class="btn btn-ghost btn-sm" onclick="startSwap('${id}','reset')">♻️ 重新開始換獸（歸零）</button></div>
      ${forgeHtml(b)}${decoHtml(b)}`;
  } else if (stTab === 'log') {
    const today = dayKey();
    $('st-log').innerHTML = `<div class="log-list">${openLogs.map(l => {
      const canUndo = !l.undone && dayKey(l.ts) === today && ['pts', 'penalty', 'stones', 'goal'].includes(l.type) && (me.isAdmin || l.by === me.id);
      const d = l.delta ? `<span class="lg-d ${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${l.delta}</span>` : l.stones ? `<span class="lg-d stone">${l.stones > 0 ? '+' : ''}${l.stones}💎</span>` : '<span class="lg-d">·</span>';
      return `<div class="log-row ${l.undone ? 'undone' : ''}">${d}<span class="lg-r">${esc(l.reason)}<br><span class="lg-t">${esc(l.byName || '')}${l.className ? ' · ' + esc(l.className) : ''}</span></span><span class="lg-t">${fmtTs(l.ts)}</span>${canUndo ? `<button class="btn btn-ghost btn-sm" onclick="undoLog('${id}','${l._id}')">撤銷</button>` : ''}</div>`;
    }).join('') || '<div class="empty">還沒有紀錄</div>'}</div>`;
  } else if (stTab === 'qr') {
    const link = beastLink(id);
    $('st-qr').innerHTML = `<div class="qr-box">${qrSvg(link, 220)}<div class="qr-link">${esc(link)}</div><div class="hint">貼在聯絡簿；掃描只能看靈獸、靈石與紀錄，不能操作。</div><button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${link}').then(()=>showToast('已複製連結'))">複製連結</button></div>`;
  }
}
window.showToast = showToast;
window.doPenalty = function (id, n) {
  const kind = $('pnKind').value; let reason = $('pnReason').value; if (reason === '__c') reason = $('pnCustom').value.trim();
  penalize(id, kind, n, reason);
};

// ══════════════════════════════════════════════════════════════
// 任務與靈石
// ══════════════════════════════════════════════════════════════
window.showTab = function (t) {
  document.querySelectorAll('#tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  ['class', 'tasks', 'steward', 'config', 'report', 'hall'].forEach(x => $('tab-' + x).style.display = x === t ? '' : 'none');
  $('classBar').style.display = ['class', 'tasks', 'steward'].includes(t) ? '' : 'none';
  if (t === 'config') renderConfig(); if (t === 'report') loadReport(); if (t === 'hall') loadHall();
};
window.taskScopeChanged = function () { $('taskStudentPick').style.display = $('taskScope').value === 'students' ? '' : 'none'; };
function renderTaskPick() {
  if (!cls) return;
  $('taskStudentPick').innerHTML = (cls.students || []).map(n => `<label><input type="checkbox" value="${esc(n)}" style="display:none" onchange="this.parentNode.classList.toggle('on',this.checked)">${esc(n)}</label>`).join('');
  $('taskHint').textContent = `單一任務最多 ${cfg.caps.taskMax} 靈石；每人每週最多入帳 ${cfg.caps.weekStones}×倍率；本班本週總額 ${classBudget()}。`;
}
window.createTask = async function () {
  if (!cls) { showToast('請先選班級', 'error'); return; }
  const title = $('taskTitle').value.trim(), stones = +$('taskStones').value | 0, kind = $('taskKind').value, scope = $('taskScope').value, deadline = $('taskDeadline').value;
  if (!title || stones <= 0) { showToast('請填名稱與靈石', 'error'); return; }
  if (stones > cfg.caps.taskMax) { showToast(`單一任務最多 ${cfg.caps.taskMax} 靈石`, 'error'); return; }
  const students = scope === 'students' ? [...document.querySelectorAll('#taskStudentPick input:checked')].map(i => i.value) : [];
  if (scope === 'students' && !students.length) { showToast('請勾選學生', 'error'); return; }
  try {
    await addDoc(collection(db, 'beastTasks'), { title, stones, kind, scope, students, deadline, classId: cls._id, className: cls.name, teacherId: me.id, teacherName: me.name, createdAt: Date.now(), active: true, awarded: {} });
    $('taskTitle').value = ''; $('taskStones').value = ''; showToast('任務已建立');
  } catch (e) { showToast('失敗：' + authErrMsg(e), 'error'); }
};
window.deleteTask = async function (id) { if (!confirm('刪除此任務？已發放的靈石不受影響。')) return; await deleteDoc(doc(db, 'beastTasks', id)).catch(e => showToast(authErrMsg(e), 'error')); };
function awardedKey(t) { return t.kind === 'daily' ? dayKey() : t.kind === 'weekly' ? weekKey() : 'once'; }
function renderTasks() {
  if (!cls) return;
  const names = cls.students || [];
  $('taskList').innerHTML = tasks.map(t => {
    const targets = t.scope === 'students' ? t.students : names;
    const k = awardedKey(t);
    const done = n => { const a = (t.awarded || {})[normName(n)] || []; return a.includes(k); };
    const left = targets.filter(n => !done(n));
    return `<div class="task-card"><div class="task-head"><div class="task-title">${esc(t.title)}</div><span class="task-stones">💎 ${t.stones}</span><span class="task-meta">${{ once: '一次性', daily: '每日', weekly: '每週' }[t.kind]} · ${t.scope === 'students' ? `${t.students.length} 人` : '全班'}${t.deadline ? ' · 期限 ' + t.deadline : ''} · ${esc(t.teacherName)}</span>
      ${(me.isAdmin || t.teacherId === me.id) ? `<button class="btn btn-ghost btn-sm" onclick="deleteTask('${t._id}')">刪除</button>` : ''}</div>
      <div class="pick-list" style="margin-top:8px">${targets.map(n => `<label class="${done(n) ? 'done' : ''}"><input type="checkbox" value="${esc(n)}" style="display:none" ${done(n) ? 'disabled' : ''} onchange="this.parentNode.classList.toggle('on',this.checked)">${esc(n)}${done(n) ? ' ✓' : ''}</label>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="this.closest('.task-card').querySelectorAll('input:not(:disabled)').forEach(i=>{i.checked=true;i.parentNode.classList.add('on')})">全選未發</button><button class="btn btn-teal btn-sm" onclick="awardTask('${t._id}',this.closest('.task-card'))">發放靈石給勾選的學生</button><span class="task-meta" style="align-self:center">未發 ${left.length} 人</span></div></div>`;
  }).join('') || '<div class="empty">這個班還沒有任務</div>';
}
window.awardTask = async function (taskId, card) {
  const t = tasks.find(x => x._id === taskId); if (!t) return;
  const picked = [...card.querySelectorAll('input:checked')].map(i => i.value);
  if (!picked.length) { showToast('請勾選學生', 'error'); return; }
  showLoading('發放中...');
  const k = awardedKey(t); let ok = 0, partial = [], none = [];
  for (const n of picked) {
    const b = beasts[normName(n)]; if (!b) { none.push(n + '（未選獸）'); continue; }
    try {
      const r = await tx(b._id, (bb, cs) => {
        const iss = cs.issued || {}; const wk = weekKey(); const used = iss.weekKey === wk ? (iss.total || 0) : 0;
        const roomClass = Math.max(0, classBudget() - used);
        const d = Math.min(grantStones(bb, t.stones, cfg), roomClass);
        if (d <= 0) return { abort: 'cap' };
        const rolled = rollWeek(bb);
        return { patch: { ...rolled, stones: (bb.stones || 0) + d, weekStones: (rolled.weekStones ?? bb.weekStones ?? 0) + d }, extra: d,
          log: { type: 'stones', stones: d, reason: `任務：${t.title}${d < t.stones ? `（達上限，只入帳 ${d}）` : ''}` },
          csPatch: { issued: { weekKey: wk, total: used + d } }, stat: ['stonesIssued', d] };
      }, { touchClass: true });
      if (r.aborted) { none.push(n); continue; }
      ok++; if (r.extra < t.stones) partial.push(n);
      await updateDoc(doc(db, 'beastTasks', taskId), { [`awarded.${normName(n)}`]: [...(((t.awarded || {})[normName(n)]) || []), k] });
    } catch (e) { console.error(e); none.push(n); }
  }
  hideLoading();
  showToast(`已發放 ${ok} 人${partial.length ? `，${partial.length} 人達上限只入帳部分` : ''}${none.length ? `，未發：${none.join('、')}` : ''}`, none.length ? 'error' : 'success');
};

// ══════════════════════════════════════════════════════════════
// 護山管家（音量偵測，只在本機跑；狀態寫 beastClass 讓投影／手機同步）
// ══════════════════════════════════════════════════════════════
const sw = { on: false, paused: false, stream: null, ctx: null, an: null, buf: null, timer: null, baseline: null, samples: [], holdStart: 0, lastStrike: 0 };
function stSettings() { return { dbAbove: +$('stDb').value || cfg.steward.dbAbove, holdSec: +$('stHold').value || cfg.steward.holdSec, cooldownSec: +$('stCool').value || cfg.steward.cooldownSec, level: $('stLevel').value || cfg.steward.level }; }
window.toggleSteward = async function () {
  if (sw.on) { stopSteward(); return; }
  if (!cls) { showToast('請先選班級', 'error'); return; }
  try {
    sw.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    sw.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = sw.ctx.createMediaStreamSource(sw.stream); sw.an = sw.ctx.createAnalyser(); sw.an.fftSize = 2048; src.connect(sw.an); sw.buf = new Float32Array(sw.an.fftSize);
    sw.on = true; sw.paused = false; sw.baseline = null; sw.samples = []; sw.holdStart = 0; sw.lastStrike = 0;
    $('stewardToggle').textContent = '🔕 關閉管家'; $('stewardPause').disabled = false;
    $('stewardStatus').textContent = '校準中…請保持教室平常的安靜程度 10 秒';
    sw.timer = setInterval(stewardTick, 100);
    await writeSteward({ on: true, strikes: 0, by: me.id, paused: false });
  } catch (e) { console.error(e); showToast('無法使用麥克風：' + (e.message || e), 'error'); }
};
function stopSteward(silent) {
  if (!sw.on) return;
  clearInterval(sw.timer); sw.on = false;
  try { sw.stream.getTracks().forEach(t => t.stop()); sw.ctx.close(); } catch (e) { }
  $('stewardToggle').textContent = '🔔 開啟管家（先校準 10 秒）'; $('stewardPause').disabled = true; $('stewardPause').textContent = '⏸ 暫停';
  $('stewardStatus').textContent = '已關閉'; $('meter').style.width = '0';
  if (!silent) writeSteward({ on: false, strikes: 0 });
}
window.pauseSteward = function () { if (!sw.on) return; sw.paused = !sw.paused; $('stewardPause').textContent = sw.paused ? '▶ 繼續' : '⏸ 暫停'; $('stewardStatus').textContent = sw.paused ? '已暫停（老師講課中）' : '偵測中'; writeSteward({ paused: sw.paused }); };
window.resetStrikes = async function () { sw.holdStart = 0; await writeSteward({ strikes: 0, scaredUntil: 0, lastStrikeAt: 0 }); showToast('已歸零'); };
async function writeSteward(patch) { if (!cls) return; await setDoc(doc(db, 'beastClass', cls._id), { steward: { ...(classState.steward || {}), ...patch }, updatedAt: Date.now() }, { merge: true }).catch(e => console.error(e)); }
function stewardTick() {
  sw.an.getFloatTimeDomainData(sw.buf);
  let s = 0; for (let i = 0; i < sw.buf.length; i++) s += sw.buf[i] * sw.buf[i];
  const db = 20 * Math.log10(Math.sqrt(s / sw.buf.length) + 1e-8);   // -160 ~ 0 dBFS
  const set = stSettings(); const now = Date.now();
  if (sw.baseline === null) {
    sw.samples.push(db);
    if (sw.samples.length >= 100) { const a = [...sw.samples].sort((x, y) => x - y); sw.baseline = a[Math.floor(a.length / 2)]; $('stewardStatus').textContent = `偵測中（環境音 ${sw.baseline.toFixed(0)} dBFS，門檻 +${set.dbAbove}）`; }
    $('meter').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
    return;
  }
  const th = sw.baseline + set.dbAbove;
  $('meter').style.width = Math.max(0, Math.min(100, (db - sw.baseline + 10) / (set.dbAbove + 20) * 100)) + '%';
  $('meterTh').style.left = Math.max(0, Math.min(100, (set.dbAbove + 10) / (set.dbAbove + 20) * 100)) + '%';
  const st = classState.steward || {};
  if (st.strikes > 0 && st.lastStrikeAt && now - st.lastStrikeAt > cfg.steward.resetMin * 60000 && !sw.resetting) { sw.resetting = true; writeSteward({ strikes: 0 }).finally(() => { sw.resetting = false; }); }
  if (sw.paused) return;
  if (db > th) {
    if (!sw.holdStart) sw.holdStart = now;
    if (now - sw.holdStart >= set.holdSec * 1000 && now - sw.lastStrike >= set.cooldownSec * 1000) { sw.lastStrike = now; sw.holdStart = 0; strike(set); }
  } else sw.holdStart = 0;
}
async function strike(set) {
  const st = classState.steward || {}; const n = (st.strikes || 0) + 1;
  beep(n === 1 ? 660 : 330, n === 1 ? 0.25 : 0.6);
  if (n === 1) { await writeSteward({ strikes: 1, lastStrikeAt: Date.now() }); $('stewardStatus').textContent = '⚠️ 第一次警告'; return; }
  const patch = { strikes: 0, lastStrikeAt: Date.now(), scaredUntil: Date.now() + cfg.steward.scaredMin * 60000, scaredLevel: set.level };
  await writeSteward(patch);
  if (set.level === 'heavy') await setDoc(doc(db, 'beastClass', cls._id), { goal: { ...(classState.goal || {}), blockedWeek: weekKey() }, updatedAt: Date.now() }, { merge: true });
  $('stewardStatus').textContent = `😨 全班靈獸受驚（${{ light: '輕', mid: '中', heavy: '重' }[set.level]}）`;
  banner('😨 全班靈獸受驚！', set.level === 'light' ? '' : '接下來 10 分鐘加分減半', '#ff6b6b');
}
function beep(freq, dur) { try { const c = sw.ctx || new AudioContext(); const o = c.createOscillator(), g = c.createGain(); o.frequency.value = freq; o.connect(g); g.connect(c.destination); g.gain.value = 0.15; o.start(); o.stop(c.currentTime + dur); } catch (e) { } }
function renderStewardRemote() {
  const st = classState.steward || {}; const fig = $('stewardFig');
  fig.classList.toggle('warn', st.strikes === 1); fig.classList.toggle('angry', scaredVisual());
  const pj = $('pjSteward');
  if (!st.on) { pj.style.display = 'none'; return; }
  pj.style.display = ''; pj.className = 'pj-steward ' + (scaredVisual() ? 'angry' : st.strikes ? 'warn' : '');
  pj.innerHTML = `<img src="assets/beasts/steward-${scaredVisual() ? 3 : st.strikes ? 2 : 1}.png" onerror="this.onerror=null;this.src=this.src.replace('.png','.svg')"> 管家 ${scaredVisual() ? '😨 受驚中' : st.paused ? '⏸' : (st.strikes || 0) + '/2'}`;
}

// ══════════════════════════════════════════════════════════════
// 投影模式
// ══════════════════════════════════════════════════════════════
window.openProjector = function () { if (!cls) { showToast('請先選班級', 'error'); return; } projectorOn = true; $('projector').style.display = ''; renderProjector(); document.documentElement.requestFullscreen?.().catch(() => { }); };
window.closeProjector = function () { projectorOn = false; $('projector').style.display = 'none'; document.exitFullscreen?.().catch(() => { }); };
function renderProjector() {
  if (!projectorOn || !cls) return;
  $('pjTitle').textContent = cls.name;
  const g = classState.goal || {}; $('pjGoal').textContent = g.weekKey === weekKey() && g.text ? `🎯 本週目標：${g.text}${g.doneWeek === weekKey() ? ' ✅' : ''}` : '';
  const n = (cls.students || []).length; $('pjGrid').style.setProperty('--pjw', n > 30 ? '120px' : n > 16 ? '150px' : '190px');
  $('pjGrid').innerHTML = (cls.students || []).map(nm => { const b = beasts[normName(nm)]; return b ? cardHtml(b, nm, true) : `<div class="pj-card"><div style="font-size:48px;margin:20px 0">🥚</div><div class="beast-name">${esc(nm)}</div></div>`; }).join('');
  renderStewardRemote();
  animateDiff('#pjGrid');
}

// ══════════════════════════════════════════════════════════════
// 主管：設定、報表；名人堂
// ══════════════════════════════════════════════════════════════
function renderConfig() {
  const row = (list, i, kind) => kind === 'reasons' ? `<div class="cfg-row"><input class="field-input" value="${esc(list[i].label)}" data-k="label"><input class="field-input" type="number" value="${list[i].pts}" data-k="pts"><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>`
    : kind === 'realReward' ? `<div class="cfg-row"><input class="field-input" value="${esc(list[i].label)}" data-k="label"><input class="field-input" type="number" value="${list[i].price}" data-k="price"><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>`
    : `<div class="cfg-row"><input class="field-input" value="${esc(list[i])}" data-k="label"><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>`;
  $('cfgReasons').innerHTML = cfg.reasons.map((_, i) => row(cfg.reasons, i, 'reasons')).join('');
  $('cfgPenalty').innerHTML = cfg.penaltyReasons.map((_, i) => row(cfg.penaltyReasons, i, 'penaltyReasons')).join('');
  $('cfgReal').innerHTML = cfg.realReward.map((_, i) => row(cfg.realReward, i, 'realReward')).join('');
  const capLabels = { weekPts: '每週靈氣上限', weekStones: '每週靈石入帳上限', holdStones: '持有靈石上限', taskMax: '單一任務最多靈石', classWeekPerStudent: '每班每週總額（×人數）', penaltyPtsMax: '單次最多扣靈氣', penaltyStonesMax: '單次最多扣靈石', classGoalPts: '全班目標每人加' };
  $('cfgCaps').innerHTML = Object.entries(capLabels).map(([k, l]) => `<label>${l}<input type="number" data-cap="${k}" value="${cfg.caps[k]}"></label>`).join('');
  [0, 1, 2].forEach(i => $('mult' + i).value = cfg.mult[i]);
  $('cfgShop').innerHTML = SHOP.map(s => `<div class="cfg-row"><span style="flex:1;font-size:13px">${s.name}<span class="hint" style="margin:0 0 0 8px;display:inline">${s.desc}</span></span><input class="field-input" type="number" data-shop="${s.key}" value="${(cfg.shopPrice || {})[s.key] ?? s.price}"></div>`).join('')
    + DECO_CATS.map(c => `<div class="hint" style="margin:10px 0 4px;font-weight:700">裝扮・${c.name}</div>` + DECO.filter(d => d.cat === c.key).map(d => `<div class="cfg-row"><span style="flex:1;font-size:13px">${esc(d.name)}</span><input class="field-input" type="number" data-shop="${d.id}" value="${(cfg.shopPrice || {})[d.id] ?? d.price}"></div>`).join('')).join('');
  const stL = { dbAbove: '門檻：環境音 + dB', holdSec: '持續秒數', cooldownSec: '冷卻秒數', resetMin: '安靜幾分鐘歸零', scaredMin: '受驚持續分鐘' };
  $('cfgSteward').innerHTML = Object.entries(stL).map(([k, l]) => `<label>${l}<input type="number" step="0.5" data-st="${k}" value="${cfg.steward[k]}"></label>`).join('') + `<label>預設懲罰<select data-st="level" style="background:var(--surface);color:var(--text);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:4px"><option value="light" ${cfg.steward.level === 'light' ? 'selected' : ''}>輕</option><option value="mid" ${cfg.steward.level === 'mid' ? 'selected' : ''}>中</option><option value="heavy" ${cfg.steward.level === 'heavy' ? 'selected' : ''}>重</option></select></label>`;
  const th = cfg.thresholds || REALMS.map(r => r.pts);
  $('cfgRealms').innerHTML = REALMS.map((r, i) => `<label>第 ${r.lv} 境 ${r.name}${r.trial ? ' ★' : ''}<input type="number" data-th="${i}" value="${th[i]}" ${i === 0 ? 'disabled' : ''}></label>`).join('');
}
window.cfgAddRow = function (kind) {
  const el = $({ reasons: 'cfgReasons', penaltyReasons: 'cfgPenalty', realReward: 'cfgReal' }[kind]);
  el.insertAdjacentHTML('beforeend', kind === 'penaltyReasons' ? `<div class="cfg-row"><input class="field-input" data-k="label" placeholder="原因"><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>` : `<div class="cfg-row"><input class="field-input" data-k="label" placeholder="名稱"><input class="field-input" type="number" data-k="${kind === 'reasons' ? 'pts' : 'price'}" placeholder="數"><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>`);
};
window.saveConfig = async function () {
  const rows = (id, f) => [...$(id).querySelectorAll('.cfg-row')].map(r => f(k => r.querySelector(`[data-k="${k}"]`)?.value)).filter(Boolean);
  const out = {
    reasons: rows('cfgReasons', v => v('label')?.trim() ? { label: v('label').trim(), pts: Math.max(1, +v('pts') | 0) } : null),
    penaltyReasons: rows('cfgPenalty', v => v('label')?.trim() || null),
    realReward: rows('cfgReal', v => v('label')?.trim() ? { label: v('label').trim(), price: Math.max(1, +v('price') | 0) } : null),
    caps: Object.fromEntries([...$('cfgCaps').querySelectorAll('input')].map(i => [i.dataset.cap, Math.max(0, +i.value || 0)])),
    mult: [0, 1, 2].map(i => +$('mult' + i).value || DEFAULT_CONFIG.mult[i]),
    shopPrice: Object.fromEntries([...$('cfgShop').querySelectorAll('input')].map(i => [i.dataset.shop, Math.max(1, +i.value | 0)])),
    steward: Object.fromEntries([...$('cfgSteward').querySelectorAll('[data-st]')].map(i => [i.dataset.st, i.dataset.st === 'level' ? i.value : +i.value])),
    thresholds: [...$('cfgRealms').querySelectorAll('input')].map(i => +i.value | 0),
    updatedAt: Date.now(), updatedBy: me.id,
  };
  for (let i = 1; i < 12; i++) if (out.thresholds[i] <= out.thresholds[i - 1]) { showToast('境界門檻必須遞增', 'error'); return; }
  try { await setDoc(doc(db, 'beastConfig', 'main'), out); applyThresholds(out.thresholds); await loadConfig(); showToast('設定已儲存'); } catch (e) { showToast('儲存失敗：' + authErrMsg(e), 'error'); }
};
window.resetConfig = async function () { if (!confirm('還原為預設設定？')) return; await deleteDoc(doc(db, 'beastConfig', 'main')).catch(() => { }); applyThresholds(null); await loadConfig(); renderConfig(); showToast('已還原'); };
function applyThresholds(th) { const d = [0, 20, 50, 90, 150, 240, 370, 550, 820, 1200, 1750, 2600]; REALMS.forEach((r, i) => r.pts = th ? th[i] : d[i]); }

async function loadReport() {
  if (!me.isAdmin) return;
  const mk = $('reportMonth').value || monthKey(); $('reportMonth').value = mk;
  const snap = await getDocs(collection(db, 'beastClass')).catch(() => null);
  const rows = (snap?.docs || []).map(d => { const c = allClasses.find(x => x._id === d.id); const s = (d.data().stats || {})[mk] || {}; return { name: c?.name || d.id, ...s }; }).filter(r => r.ptsIssued || r.stonesIssued || r.stonesSpent || r.penaltyPts || r.penaltyStones);
  const tot = rows.reduce((a, r) => { for (const k of ['ptsIssued', 'stonesIssued', 'stonesSpent', 'penaltyPts', 'penaltyStones']) a[k] = (a[k] || 0) + (r[k] || 0); return a; }, {});
  $('reportBody').innerHTML = rows.length ? `<table class="rep"><tr><th>班級</th><th>靈氣發出</th><th>靈氣扣除</th><th>靈石發出</th><th>靈石花掉</th><th>靈石扣除</th><th>發出/花掉</th></tr>
    ${[...rows, { name: '合計', ...tot }].map(r => `<tr><td>${esc(r.name)}</td><td>${r.ptsIssued || 0}</td><td>${r.penaltyPts || 0}</td><td>${r.stonesIssued || 0}</td><td>${r.stonesSpent || 0}</td><td>${r.penaltyStones || 0}</td><td>${r.stonesSpent ? (r.stonesIssued / r.stonesSpent).toFixed(1) : '—'}</td></tr>`).join('')}</table>` : '<div class="empty">本月尚無資料</div>';
}
async function loadHall() {
  const snap = await getDocs(query(collection(db, 'beasts'), where('hall', '==', true))).catch(() => null);
  const list = (snap?.docs || []).map(d => ({ _id: d.id, ...d.data() }));
  $('hallGrid').innerHTML = list.length ? list.map(b => `<div class="beast-card stage-4 ${decoClasses(b)}" style="--c:${BEAST_MAP[b.beast]?.color}">${img(b)}<div class="beast-name">${esc(b.name)}</div><div class="beast-pet">${esc(b.petName || BEAST_MAP[b.beast]?.name)} · ${BEAST_MAP[b.beast]?.ultimate}</div><div class="beast-realm trial">大羅金仙</div></div>`).join('') : '<div class="empty">尚無人登頂</div>';
}
