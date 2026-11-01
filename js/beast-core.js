// 百宏文教 · 小森靈獸 — 純資料與純函式（不碰 Firebase、不碰 DOM）
// beasts.js（老師端）與 beast-view.js（學生端）都 import 本檔。
// 設定文件：https://claude.ai/artifact/DvcTpCWrMjF71RCzrwxoVy

// ── 12 境界（累計靈氣門檻；trial = 晉升需通過突破試煉）──
export const REALMS = [
  { lv: 1,  name: '煉氣',     pts: 0,    trial: false, stage: 1, unlock: '選定靈獸、天賦' },
  { lv: 2,  name: '築基',     pts: 20,   trial: false, stage: 1, unlock: '第一式' },
  { lv: 3,  name: '結丹',     pts: 50,   trial: false, stage: 1, unlock: '內丹光點、特權券 ×1' },
  { lv: 4,  name: '元嬰',     pts: 90,   trial: true,  stage: 2, unlock: '進化：靈獸、第二式' },
  { lv: 5,  name: '化神',     pts: 150,  trial: false, stage: 2, unlock: '專屬頭像框' },
  { lv: 6,  name: '煉虛',     pts: 240,  trial: false, stage: 2, unlock: '特權券 ×1' },
  { lv: 7,  name: '合體',     pts: 370,  trial: true,  stage: 3, unlock: '進化：聖獸、第三式' },
  { lv: 8,  name: '大乘',     pts: 550,  trial: false, stage: 3, unlock: '全身光環' },
  { lv: 9,  name: '渡劫',     pts: 820,  trial: false, stage: 3, unlock: '雷劫特效、特權券 ×2' },
  { lv: 10, name: '真仙',     pts: 1200, trial: true,  stage: 4, unlock: '進化：神獸、第四式' },
  { lv: 11, name: '金仙',     pts: 1750, trial: false, stage: 4, unlock: '金身外觀' },
  { lv: 12, name: '大羅金仙', pts: 2600, trial: true,  stage: 4, unlock: '本命神通、名人堂' },
];
export const STAGE_NAMES = { 1: '幼靈', 2: '靈獸', 3: '聖獸', 4: '神獸' };
export const TRIAL_HINTS = {
  4:  '元嬰：近 4 週全勤，或小考一次 ≥ 80 分',
  7:  '合體：段考或模考任一科進步 ≥ 10 分，或達 85 分',
  10: '真仙（渡天劫）：天劫三問，老師當場出 3 題全對即過；失敗隔週可再挑戰',
  12: '大羅金仙：老師依綜合表現核定',
};

// ── 12 隻本命靈獸（v2：日系可愛 × 萬界神獸；主色平均分布在色環上，整班排在一起才協調）──
// key = 圖檔名前綴（assets/beasts/{key}-{1..4}.png、{key}-{1..4}-scared.png）；color = 主色（進度條、招式特效）
export const BEASTS = [
  { key: 'qinglong', name: '青龍',   origin: '東方', attr: '木',     color: '#4ecb8d', talent: '生生不息', skills: ['青藤纏', '龍吟', '萬木回春', '蒼龍出海'],       ultimate: '青龍蔽天', fit: '沉穩領袖' },
  { key: 'zhuque',   name: '朱雀',   origin: '東方', attr: '火',     color: '#ff6b6b', talent: '涅槃',     skills: ['星火', '赤羽', '焚天翼', '涅槃重生'],           ultimate: '南明離火', fit: '熱情愛表現' },
  { key: 'qilin',    name: '麒麟',   origin: '東方', attr: '祥瑞',   color: '#f6c343', talent: '祥瑞',     skills: ['踏雲', '麟火', '瑞氣千條', '仁獸降福'],         ultimate: '麒麟踏世', fit: '溫和全能' },
  { key: 'jiuwei',   name: '九尾狐', origin: '日本', attr: '幻',     color: '#b58cf5', talent: '一尾一命', skills: ['狐火', '幻影分身', '魅影迷陣', '九尾天狐'],       ultimate: '九尾通天', fit: '聰慧靈巧' },
  { key: 'orochi',   name: '八岐大蛇', origin: '日本', attr: '雷',   color: '#7c5cff', talent: '八首同心', skills: ['雷牙', '雙首齊鳴', '八岡雷劫', '天叢雲劍'],       ultimate: '八岐雷海', fit: '爆發行動派' },
  { key: 'baku',     name: '夢貘',   origin: '日本', attr: '夢',     color: '#6c7bd9', talent: '食夢',     skills: ['安眠', '夢幕', '百夢幻境', '吞夢歸寂'],           ultimate: '萬夢歸一', fit: '安靜專注' },
  { key: 'angel',    name: '小天使', origin: '西方', attr: '光',     color: '#ffe6a3', talent: '祝福',     skills: ['光羽', '聖諭', '天啟之光', '六翼降臨'],           ultimate: '天光普照', fit: '善良愛幫忙' },
  { key: 'mermaid',  name: '人魚',   origin: '西方', attr: '水',     color: '#4fd1e0', talent: '海之歌',   skills: ['水泡', '潮詠', '深海聖歌', '海神之歌'],           ultimate: '萬海潮生', fit: '溫柔愛唱歌' },
  { key: 'unicorn',  name: '獨角獸', origin: '西方', attr: '聖・治癒', color: '#ff9ecf', talent: '淨化',   skills: ['光角', '治癒之光', '彩虹蹄', '聖角天光'],         ultimate: '聖角寧世', fit: '純真善良' },
  { key: 'griffin',  name: '獅鷲',   origin: '西方', attr: '風',     color: '#ff9f43', talent: '鷹眼',     skills: ['風爪', '鷲鳴', '獅鷲俯衝', '王者之翼'],           ultimate: '天空之王', fit: '勇敢守護' },
  { key: 'fenrir',   name: '芬里爾', origin: '北歐', attr: '冰',     color: '#9ed8ff', talent: '冰心',     skills: ['冰牙', '霜嘯', '極光巨狼', '吞日之狼'],           ultimate: '永凍極夜', fit: '獨立堅強' },
  { key: 'bastet',   name: '巴斯特貓', origin: '埃及', attr: '月・夜', color: '#3b3f6b', talent: '九命',   skills: ['月爪', '夜視', '貓神審判', '金字塔之光'],         ultimate: '月神降世', fit: '優雅有主見' },
];
export const BEAST_MAP = Object.fromEntries(BEASTS.map(b => [b.key, b]));

// ── 道具（靈石購買）──
// kind: item = 消耗品（items[key]++）、cosmetic = 外觀（cosmetics 陣列）、rename = 改名、swap = 洗髓丹、real = 現實獎勵（老師兌換）
export const SHOP = [
  { key: 'hat',      name: '靈獸飾品・仙帽',  kind: 'cosmetic', price: 10,  desc: '頭上戴一頂小仙帽' },
  { key: 'cloud',    name: '靈獸飾品・坐騎雲', kind: 'cosmetic', price: 25,  desc: '腳下踩一朵祥雲' },
  { key: 'bg',       name: '靈獸飾品・仙山背景', kind: 'cosmetic', price: 40, desc: '投影時顯示專屬仙山背景' },
  { key: 'rename',   name: '改名卡',          kind: 'rename',   price: 15,  desc: '幫靈獸取名字' },
  { key: 'dingxin',  name: '定心符',          kind: 'item',     price: 20,  desc: '個人免疫一次管家「受驚」' },
  { key: 'pojing',   name: '破境丹',          kind: 'item',     price: 30,  desc: '突破試煉失敗後當場重試，不用等一週' },
  { key: 'juling',   name: '聚靈丹',          kind: 'item',     price: 40,  desc: '下一次加分靈氣 ×2（每週限購 1 顆）', weeklyLimit: 1 },
  { key: 'xisui',    name: '洗髓丹',          kind: 'swap',     price: 150, desc: '免費換獸用完後，保留進度再換一次' },
];
export const SHOP_MAP = Object.fromEntries(SHOP.map(s => [s.key, s]));

// ── 預設設定（存於 beastConfig/main，主管可改；缺的欄位用這裡的預設）──
export const DEFAULT_CONFIG = {
  reasons: [
    { label: '準時到班', pts: 1 }, { label: '作業按時繳交', pts: 1 }, { label: '課堂答對 / 主動發問', pts: 1 },
    { label: '作業全對', pts: 2 }, { label: '幫助同學', pts: 2 },
    { label: '小考 ≥ 90 分', pts: 3 }, { label: '小考比上次進步 ≥ 10 分', pts: 3 },
  ],
  penaltyReasons: ['遲到', '未交作業', '上課干擾', '不尊重同學'],
  caps: {
    weekPts: 25,            // 單門課每週靈氣上限（× 課程倍率）
    weekStones: 40,         // 單門課每週靈石入帳上限（× 課程倍率）
    holdStones: 200,        // 單門課持有靈石上限（× 課程倍率）
    taskMax: 20,            // 單一任務最多靈石
    classWeekPerStudent: 30,// 每班每週發放總額 = 人數 × 此值
    penaltyPtsMax: 10,      // 單次最多扣靈氣
    penaltyStonesMax: 20,   // 單次最多扣靈石
    classGoalPts: 2,        // 全班目標每人加
  },
  mult: [1, 1.5, 1.8],      // 第 1、2、3 門課的倍率；第 4 門起不再增加
  swapFreeMaxRealm: 3,      // 免費換獸限此境界以前
  trialCooldownDays: 7,
  steward: { dbAbove: 15, holdSec: 1, cooldownSec: 5, level: 'mid', resetMin: 10, scaredMin: 10 },
  realReward: [             // 現實獎勵（老師自訂，主管核價）
    { label: '選座位一次', price: 30 }, { label: '作業免寫一題', price: 40 }, { label: '當日小老師', price: 25 },
  ],
};
export function mergeConfig(saved) {
  const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!saved) return c;
  for (const k of Object.keys(saved)) {
    if (k === 'caps' || k === 'steward') c[k] = { ...c[k], ...saved[k] };
    else c[k] = saved[k];
  }
  return c;
}

// ── 時間：週一 00:00（台灣時間）起算；weekKey = 該週週一的 YYYY-MM-DD ──
export function taipeiNow(now = Date.now()) { return new Date(now + 8 * 3600 * 1000); }  // 以 UTC 欄位當台灣時間用
export function weekKey(now = Date.now()) {
  const d = taipeiNow(now);
  const dow = (d.getUTCDay() + 6) % 7;      // 週一 = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export function dayKey(now = Date.now()) { return taipeiNow(now).toISOString().slice(0, 10); }
export function monthKey(now = Date.now()) { return dayKey(now).slice(0, 7); }

// ── 倍率與上限 ──
export function multiplier(courseCount, cfg = DEFAULT_CONFIG) {
  const n = Math.max(1, courseCount | 0);
  const m = cfg.mult || DEFAULT_CONFIG.mult;
  return m[Math.min(n, m.length) - 1];
}
export function capWeekPts(courseCount, cfg)    { return Math.round(cfg.caps.weekPts    * multiplier(courseCount, cfg)); }
export function capWeekStones(courseCount, cfg) { return Math.round(cfg.caps.weekStones * multiplier(courseCount, cfg)); }
export function capHoldStones(courseCount, cfg) { return Math.round(cfg.caps.holdStones * multiplier(courseCount, cfg)); }

// ── 境界計算：靈氣達門檻且所有需試煉的境界都已通過 ──
export function realmFor(pts, trials = {}) {
  let lv = 1;
  for (const r of REALMS) {
    if (pts < r.pts) break;
    if (r.trial && !trials[r.lv]) break;
    lv = r.lv;
  }
  return lv;
}
export function realmInfo(lv) { return REALMS[Math.min(Math.max(lv, 1), 12) - 1]; }
export function nextRealm(lv) { return lv >= 12 ? null : REALMS[lv]; }
// 進度（0~1）到下一境
export function progress(pts, lv) {
  const cur = realmInfo(lv), nxt = nextRealm(lv);
  if (!nxt) return 1;
  return Math.min(1, Math.max(0, (pts - cur.pts) / (nxt.pts - cur.pts)));
}
// 卡在試煉：靈氣已達下一境門檻、下一境需試煉、尚未通過
export function trialPending(b) {
  const nxt = nextRealm(b.realm);
  return !!(nxt && nxt.trial && b.pts >= nxt.pts && !(b.trials || {})[nxt.lv]);
}
export function trialCooldownLeft(b, cfg = DEFAULT_CONFIG, now = Date.now()) {
  const nxt = nextRealm(b.realm);
  if (!nxt) return 0;
  const failAt = (b.trialFailAt || {})[nxt.lv] || 0;
  const until = failAt + cfg.trialCooldownDays * 86400000;
  return Math.max(0, until - now);
}

// ── 全新靈獸文件 ──
export function newBeast(name, beastKey, courseCount = 1, now = Date.now()) {
  return {
    name, nameKey: normName(name), beast: beastKey, petName: '',
    realm: 1, pts: 0, stones: 0,
    weekKey: weekKey(now), weekPts: 0, weekStones: 0, weekBuys: {},
    courseCount, swapUsed: false, trials: {}, trialFailAt: {},
    items: {}, cosmetics: [], julingActive: false, hall: false,
    createdAt: now, updatedAt: now,
  };
}
export function normName(s) { return String(s || '').replace(/\s+/g, '').trim(); }

// 週切換：回傳套用「本週歸零」後的新欄位（不改原物件）
export function rollWeek(b, now = Date.now()) {
  const wk = weekKey(now);
  if (b.weekKey === wk) return {};
  return { weekKey: wk, weekPts: 0, weekStones: 0, weekBuys: {} };
}

// 加分試算：回傳 { delta, capped, halved, doubled }（純函式；transaction 內用）
//   delta 為正；opts: { bypassCap, scared(受驚中), hasDingxin }
export function applyPts(b, delta, cfg, opts = {}) {
  const r = { ...b, ...rollWeek(b, opts.now) };
  let d = Math.max(0, delta | 0);
  let halved = false, doubled = false, capped = false, usedDingxin = false;
  if (opts.scared) {
    if ((r.items || {}).dingxin > 0) usedDingxin = true;        // 定心符擋一次
    else { d = Math.ceil(d / 2); halved = true; }                // 無條件進位：+1 仍是 +1
  }
  if (r.julingActive && d > 0) { d *= 2; doubled = true; }
  if (!opts.bypassCap) {
    const room = Math.max(0, capWeekPts(r.courseCount, cfg) - (r.weekPts || 0));
    if (d > room) { d = room; capped = true; }
  }
  return { delta: d, capped, halved, doubled, usedDingxin, rolled: rollWeek(b, opts.now) };
}

// 扣靈氣：最多扣到當前境界門檻、單次上限
export function penaltyPts(b, want, cfg) {
  const floor = realmInfo(b.realm).pts;
  const max = Math.min(cfg.caps.penaltyPtsMax, Math.max(0, b.pts - floor));
  return Math.min(Math.max(0, want | 0), max);
}
export function penaltyStones(b, want, cfg) {
  return Math.min(Math.max(0, want | 0), cfg.caps.penaltyStonesMax, Math.max(0, b.stones || 0));
}

// 發靈石：個人週上限、持有上限（回傳實際入帳數）
export function grantStones(b, want, cfg, now = Date.now()) {
  const r = { ...b, ...rollWeek(b, now) };
  const roomWeek = Math.max(0, capWeekStones(r.courseCount, cfg) - (r.weekStones || 0));
  const roomHold = Math.max(0, capHoldStones(r.courseCount, cfg) - (r.stones || 0));
  return Math.max(0, Math.min(want | 0, roomWeek, roomHold));
}

// 招式／顯示
export function skillsUnlocked(b) {
  const lv = b.realm;
  return [2, 4, 7, 10].filter(x => lv >= x).length;   // 築基、元嬰、合體、真仙各解鎖一式
}
export function stageOf(lv) { return realmInfo(lv).stage; }
export function imgSrc(beastKey, stage) { return `assets/beasts/${beastKey}-${stage}.png`; }
export function imgFallback(beastKey, stage) { return `assets/beasts/${beastKey}-${stage}.svg`; }
export function imgScared(beastKey, stage) { return `assets/beasts/${beastKey}-${stage}-scared.png`; }

export function fmtTs(ts) {
  const d = taipeiNow(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
export function randomId(n = 20) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const arr = new Uint8Array(n);
  (globalThis.crypto || { getRandomValues: a => a.forEach((_, i) => a[i] = Math.random() * 256) }).getRandomValues(arr);
  for (const v of arr) s += chars[v % chars.length];
  return s;
}
