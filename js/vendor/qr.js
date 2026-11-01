// 極簡 QR Code 產生器（byte 模式、糾錯等級 M、自動選版本 1–6（最多 108 bytes）、自動選遮罩）
// 版本 7 以上需要額外的版本資訊區，本檔不支援；學生連結約 75 bytes，版本 5 即可。
// 自行實作，無外部相依；用 OpenCV 驗證過可解碼。
// 用法：import { qrMatrix, qrSvg } from './vendor/qr.js'; qrSvg(text, size)

const EC_M = {  // [版本] = [總碼字, 糾錯碼字/區塊, 區塊數 g1, g1 每塊資料碼字, 區塊數 g2, g2 每塊資料碼字]
  1: [26, 10, 1, 16, 0, 0],  2: [44, 16, 1, 28, 0, 0],  3: [70, 26, 1, 44, 0, 0],  4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

// GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
function rsEncode(data, n) { const g = rsGen(n); const r = new Array(n).fill(0); for (const d of data) { const f = d ^ r.shift(); r.push(0); if (f) for (let j = 0; j < n; j++) r[j] ^= gmul(g[j + 1], f); } return r; }

function utf8(s) { return Array.from(new TextEncoder().encode(s)); }

export function qrMatrix(text) {
  const bytes = utf8(text);
  let ver = 0;
  for (let v = 1; v <= 6; v++) { const e = EC_M[v]; const cap = e[2] * e[3] + e[4] * e[5]; if (bytes.length + 2 <= cap) { ver = v; break; } }
  if (!ver) throw new Error('QR: text too long (max 108 bytes)');
  const [total, ecLen, g1, d1, g2, d2] = EC_M[ver];
  const dataLen = g1 * d1 + g2 * d2;
  // bit stream: mode 0100, count(8 bits for v<10, 16 for v>=10), data, terminator, pad
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(4, 4); push(bytes.length, 8); bytes.forEach(b => push(b, 8));
  for (let i = 0; i < 4 && bits.length < dataLen * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < dataLen; p++) cw.push(p % 2 ? 0x11 : 0xec);
  // blocks + interleave
  const blocks = []; let off = 0;
  for (let i = 0; i < g1; i++) { blocks.push(cw.slice(off, off + d1)); off += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(cw.slice(off, off + d2)); off += d2; }
  const ecs = blocks.map(b => rsEncode(b, ecLen));
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  // matrix
  const N = ver * 4 + 17;
  const m = Array.from({ length: N }, () => new Array(N).fill(null));   // null = 未定（資料區）
  const set = (r, c, v) => { if (r >= 0 && r < N && c >= 0 && c < N) m[r][c] = v; };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const on = (i >= 0 && i <= 6 && j >= 0 && j <= 6) && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)); set(r + i, c + j, on ? 1 : 0); } };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  for (let i = 8; i < N - 8; i++) { m[6][i] = i % 2 ? 0 : 1; m[i][6] = i % 2 ? 0 : 1; }
  const al = ALIGN[ver];
  const last = al.length - 1;
  al.forEach((r, i) => al.forEach((c, j) => { if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, (Math.max(Math.abs(i), Math.abs(j)) === 1) ? 0 : 1); }));
  // reserve format areas
  for (let i = 0; i < 8; i++) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; if (m[8][N - 1 - i] === null) m[8][N - 1 - i] = 0; if (m[N - 1 - i][8] === null) m[N - 1 - i][8] = 0; }
  m[8][8] = 0; m[N - 8][8] = 1;   // dark module
  // place data
  const reserved = m.map(row => row.map(v => v !== null));
  let bi = 0; const dbits = []; out.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1); });
  for (let col = N - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < N; k++) {
      const row = ((col + 1) & 2) === 0 ? N - 1 - k : k;   // 由下往上、再由上往下
      for (const c of [col, col - 1]) { if (!reserved[row][c]) { m[row][c] = dbits[bi++] || 0; } }
    }
  }
  // mask + format, pick lowest penalty
  const MASKS = [(r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  let best = null, bestScore = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const mm = m.map((row, r) => row.map((v, c) => reserved[r][c] ? v : (v ^ (MASKS[mk](r, c) ? 1 : 0))));
    writeFormat(mm, N, mk);
    const s = penalty(mm, N);
    if (s < bestScore) { bestScore = s; best = mm; }
  }
  return best;
}
function writeFormat(m, N, mask) {
  let f = (0b00 << 3) | mask;   // EC level M = 00
  let v = f << 10;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0b10100110111 << (i - 10);
  const bitsv = ((f << 10) | v) ^ 0b101010000010010;
  const b = i => (bitsv >> i) & 1;
  // 第一份：左上角（bit 0..5 在第 8 欄 0..5 列；6→(7,8) 7→(8,8) 8→(8,7)；9..14 在第 8 列 5..0 欄）
  for (let i = 0; i <= 5; i++) m[i][8] = b(i);
  m[7][8] = b(6); m[8][8] = b(7); m[8][7] = b(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = b(i);
  // 第二份：右上列 + 左下欄
  for (let i = 0; i < 8; i++) m[8][N - 1 - i] = b(i);
  for (let i = 8; i < 15; i++) m[N - 15 + i][8] = b(i);
  m[N - 8][8] = 1;
}
function penalty(m, N) {
  let s = 0;
  const run = line => { let i = 0; while (i < N) { let j = i; while (j < N && line[j] === line[i]) j++; if (j - i >= 5) s += 3 + (j - i - 5); i = j; } };
  for (let r = 0; r < N; r++) { run(m[r]); run(m.map(row => row[r])); }
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) s += 3; }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const chk = get => { for (let i = 0; i <= N - 11; i++) { let a = true, b = true; for (let k = 0; k < 11; k++) { const v = get(i + k); if (v !== pat[k]) a = false; if (v !== pat2[k]) b = false; } if (a || b) s += 40; } };
  for (let r = 0; r < N; r++) { chk(i => m[r][i]); chk(i => m[i][r]); }
  let dark = 0; for (const row of m) for (const v of row) dark += v;
  s += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10;
  return s;
}
export function qrSvg(text, size = 200, quiet = 2) {
  const m = qrMatrix(text), N = m.length, S = N + quiet * 2;
  let d = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${S}" height="${S}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
