// 百宏文教 · 小森靈獸 — 學生 QR 檢視頁（無登入、唯讀）
// beast.html?t=<token>；token = beasts/{token} 的文件 id，規則只開 get、不開列舉。
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { REALMS, STAGE_NAMES, BEAST_MAP, SHOP_MAP, DEFAULT_CONFIG, mergeConfig, realmInfo, nextRealm, progress, trialPending, capWeekPts, capWeekStones, multiplier, rollWeek, stageOf, imgSrc, imgFallback, fmtTs } from "./beast-core.js";

const app = initializeApp({
  apiKey: "AIzaSyA4l5zcyEVzbLfpeCbDvDjQsw2Rfkfizao", authDomain: "bhcs-system.firebaseapp.com", projectId: "bhcs-system",
  storageBucket: "bhcs-system.firebasestorage.app", messagingSenderId: "920353312937", appId: "1:920353312937:web:7517cabddd3aacd83659b8"
});
const db = getFirestore(app);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = document.getElementById('view');
const token = new URLSearchParams(location.search).get('t');
let cfg = mergeConfig(null), logs = [];

async function main() {
  if (!token) { view.innerHTML = '<div class="empty">連結不完整，請掃描聯絡簿上的 QR Code。</div>'; return; }
  // 設定（門檻可能被主管調整過；學生頁沒有權限讀 beastConfig 時就用預設）
  try { const c = await getDoc(doc(db, 'beastConfig', 'main')); if (c.exists()) { cfg = mergeConfig(c.data()); if (cfg.thresholds) REALMS.forEach((r, i) => r.pts = cfg.thresholds[i]); } } catch (e) { }
  onSnapshot(doc(db, 'beasts', token), snap => {
    if (!snap.exists()) { view.innerHTML = '<div class="empty">找不到這隻靈獸，請向老師確認連結。</div>'; return; }
    render(snap.data());
  }, e => { console.error(e); view.innerHTML = `<div class="empty">讀取失敗：${esc(e.message)}</div>`; });
  onSnapshot(query(collection(db, 'beasts', token, 'log'), orderBy('ts', 'desc'), limit(30)), s => { logs = s.docs.map(d => d.data()); const el = document.getElementById('logs'); if (el) el.innerHTML = logsHtml(); }, () => { });
}
function logsHtml() {
  return logs.filter(l => l.type !== 'undo').map(l => {
    const d = l.delta ? `<span class="lg-d ${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${l.delta}</span>` : l.stones ? `<span class="lg-d stone">${l.stones > 0 ? '+' : ''}${l.stones}💎</span>` : '<span class="lg-d">·</span>';
    return `<div class="log-row ${l.undone ? 'undone' : ''}">${d}<span class="lg-r">${esc(l.reason)}<br><span class="lg-t">${esc(l.byName || '')}${l.className ? ' · ' + esc(l.className) : ''}</span></span><span class="lg-t">${fmtTs(l.ts).slice(5)}</span></div>`;
  }).join('') || '<div class="hint">還沒有紀錄</div>';
}
function render(b) {
  const info = BEAST_MAP[b.beast] || Object.values(BEAST_MAP)[0], r = realmInfo(b.realm), nxt = nextRealm(b.realm);
  const wk = rollWeek(b); const wp = wk.weekPts ?? b.weekPts ?? 0, ws = wk.weekStones ?? b.weekStones ?? 0;
  const skillLv = [2, 4, 7, 10];
  const items = Object.entries(b.items || {}).filter(([, n]) => n > 0).map(([k, n]) => `<span>${SHOP_MAP[k]?.name || k} ×${n}</span>`);
  const cos = (b.cosmetics || []).map(k => `<span>${SHOP_MAP[k]?.name.replace('靈獸飾品・', '') || k}</span>`);
  if (b.julingActive) items.push('<span>聚靈丹 生效中</span>');
  view.innerHTML = `
    <div class="sv-hero stage-${r.stage}" style="--c:${info.color}">
      <img class="beast-img" src="${imgSrc(b.beast, stageOf(b.realm))}" onerror="this.onerror=null;this.src='${imgFallback(b.beast, stageOf(b.realm))}'" alt="${info.name}">
      <div class="sv-name">${esc(b.petName || info.name)}</div>
      <div class="sv-pet">${esc(b.name)} 的本命靈獸 · ${STAGE_NAMES[r.stage]}${info.name} · ${info.attr}</div>
      <div class="sv-realm">第 ${b.realm} 境 ${r.name}${trialPending(b) ? ' · 待突破試煉' : ''}</div>
    </div>
    <div class="progress" style="--c:${info.color};height:10px"><div class="progress-bar" style="width:${Math.round(progress(b.pts, b.realm) * 100)}%"></div></div>
    <div class="hint" style="text-align:center">${nxt ? `靈氣 ${b.pts} / ${nxt.pts}，再 ${Math.max(0, nxt.pts - b.pts)} 到「${nxt.name}」${nxt.trial ? '（需試煉）' : ''}` : `靈氣 ${b.pts}，已是大羅金仙`}</div>
    <div class="sv-stats">
      <div class="sv-stat"><b>${b.pts}</b><span>靈氣</span></div>
      <div class="sv-stat"><b style="color:var(--stone)">💎 ${b.stones || 0}</b><span>靈石</span></div>
      <div class="sv-stat"><b>${wp}<small style="font-size:11px;color:var(--muted)">/${capWeekPts(b.courseCount, cfg)}</small></b><span>本週靈氣</span></div>
    </div>
    <div class="card"><div class="card-title">天賦與招式</div>
      <div class="skill">✨ 天賦「${info.talent}」</div>
      ${info.skills.map((s, i) => `<div class="skill ${b.realm >= skillLv[i] ? '' : 'locked'}">${b.realm >= skillLv[i] ? '⚔️' : '🔒'} 第${['一', '二', '三', '四'][i]}式「${s}」<span class="hint" style="margin:0 0 0 auto">${realmInfo(skillLv[i]).name}解鎖</span></div>`).join('')}
      <div class="skill ${b.realm >= 12 ? '' : 'locked'}">${b.realm >= 12 ? '🌟' : '🔒'} 本命神通「${info.ultimate}」<span class="hint" style="margin:0 0 0 auto">大羅金仙</span></div>
    </div>
    <div class="card"><div class="card-title">道具與飾品</div><div class="sv-items">${[...items, ...cos].join('') || '<span class="hint" style="margin:0">還沒有道具，完成老師的任務賺靈石，到補習班跟老師買。</span>'}</div>
      <div class="hint">本週靈石入帳 ${ws}/${capWeekStones(b.courseCount, cfg)} · ${b.courseCount} 門課 ×${multiplier(b.courseCount, cfg)}</div></div>
    <div class="card"><div class="card-title">最近紀錄</div><div class="log-list" id="logs">${logsHtml()}</div></div>
    <div class="sv-foot">百宏文教 · 小森靈獸<br>這一頁只能看，加分、購買請在補習班由老師操作。</div>`;
}
main();
