// 極簡 in-memory Firestore mock（只支援本專案用到的 API）
// 集合以路徑為鍵：頂層 'classes'、子集合 'beasts/<id>/log'；window.__store 可在測試裡直接檢視／塞資料。
const store = (window.__store = window.__store || {});
let idSeq = 1;
const col = name => (store[name] = store[name] || {});
const clone = d => d === undefined ? undefined : JSON.parse(JSON.stringify(d));
const listeners = new Set();
export function getFirestore() { return { __db: true }; }
// collection(db, 'a') / collection(db, 'a', id, 'sub') / collection(docRef, 'sub')
export function collection(dbOrRef, ...segs) {
  const base = dbOrRef && dbOrRef.kind === 'doc' ? [dbOrRef.name, dbOrRef.id] : [];
  return { kind: 'col', name: [...base, ...segs].join('/') };
}
// doc(db, 'a', id) / doc(db, 'a', id, 'sub', id2) / doc(colRef) → 自動 id
export function doc(dbOrRef, ...segs) {
  if (dbOrRef && dbOrRef.kind === 'col') return { kind: 'doc', name: dbOrRef.name, id: segs[0] || ('id' + (idSeq++)) };
  const id = segs.pop();
  return { kind: 'doc', name: segs.join('/'), id };
}
export function query(c, ...clauses) { return { kind: 'query', name: c.name, clauses: [...(c.clauses || []), ...clauses] }; }
export function where(field, op, value) { return { type: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { type: 'orderBy', field, dir }; }
export function limit(n) { return { type: 'limit', n }; }
function matches(data, cl) {
  const v = data[cl.field];
  if (cl.op === '==') return v === cl.value;
  if (cl.op === 'in') return cl.value.includes(v);
  if (cl.op === 'array-contains') return Array.isArray(v) && v.includes(cl.value);
  if (cl.op === '>=') return v >= cl.value;
  if (cl.op === '<=') return v <= cl.value;
  if (cl.op === '>')  return v > cl.value;
  if (cl.op === '<')  return v < cl.value;
  throw new Error('unsupported op ' + cl.op);
}
const snap = (id, data) => ({ id, exists: () => data !== undefined, data: () => clone(data) });
function runQuery(q) {
  const c = col(q.name);
  const clauses = q.clauses || [];
  let rows = Object.entries(c).filter(([, d]) => clauses.filter(x => x.type === 'where' || x.op).every(cl => matches(d, cl)));
  for (const o of clauses.filter(x => x.type === 'orderBy')) rows.sort((a, b) => (a[1][o.field] > b[1][o.field] ? 1 : a[1][o.field] < b[1][o.field] ? -1 : 0) * (o.dir === 'desc' ? -1 : 1));
  const l = clauses.find(x => x.type === 'limit'); if (l) rows = rows.slice(0, l.n);
  return rows.map(([id, d]) => snap(id, d));
}
export async function getDocs(q) {
  window.__reads = (window.__reads || 0) + 1;
  const docs = runQuery(q);
  return { docs, empty: !docs.length, size: docs.length };
}
export async function getDoc(ref) { return snap(ref.id, col(ref.name)[ref.id]); }
// 支援 'a.b' 點路徑（updateDoc / transaction.update）
function applyPatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) { const ks = k.split('.'); let o = target; for (const kk of ks.slice(0, -1)) o = o[kk] = o[kk] || {}; o[ks.at(-1)] = clone(v); }
    else target[k] = clone(v);
  }
}
function deepMerge(target, src) { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v); else target[k] = clone(v); } }
function notify() { for (const l of [...listeners]) l(); }
window.__notify = notify;   // 測試直接改 __store 後呼叫，讓 onSnapshot 重送
export async function addDoc(c, data) { const id = 'id' + (idSeq++); col(c.name)[id] = clone(data); notify(); return { id }; }
export async function setDoc(ref, data, opts) {
  const c = col(ref.name);
  if (opts && opts.merge && c[ref.id]) deepMerge(c[ref.id], data); else c[ref.id] = clone(data);
  notify();
}
export async function updateDoc(ref, patch) {
  const c = col(ref.name);
  if (!c[ref.id]) throw new Error('No document to update: ' + ref.name + '/' + ref.id);
  applyPatch(c[ref.id], patch); notify();
}
export async function deleteDoc(ref) { delete col(ref.name)[ref.id]; notify(); }
// 交易：先讀後寫（寫入先排隊，最後一次套用）
export async function runTransaction(db, fn) {
  const writes = [];
  const t = {
    get: async ref => ref.kind === 'doc' ? snap(ref.id, col(ref.name)[ref.id]) : { docs: runQuery(ref) },
    set: (ref, data, opts) => writes.push(() => { const c = col(ref.name); if (opts && opts.merge && c[ref.id]) deepMerge(c[ref.id], data); else c[ref.id] = clone(data); }),
    update: (ref, patch) => writes.push(() => { const c = col(ref.name); if (!c[ref.id]) throw new Error('No document to update: ' + ref.name + '/' + ref.id); applyPatch(c[ref.id], patch); }),
    delete: ref => writes.push(() => { delete col(ref.name)[ref.id]; }),
  };
  const out = await fn(t);
  writes.forEach(w => w()); if (writes.length) notify();
  return out;
}
// 即時監聽：每次寫入後重新計算；docChanges 以上次結果比對
export function onSnapshot(target, onNext, onErr) {
  let prev = new Map();
  const emit = () => {
    try {
      if (target.kind === 'doc') { onNext(snap(target.id, col(target.name)[target.id])); return; }
      const docs = runQuery(target);
      const cur = new Map(docs.map(d => [d.id, JSON.stringify(d.data())]));
      const changes = [];
      for (const d of docs) { if (!prev.has(d.id)) changes.push({ type: 'added', doc: d }); else if (prev.get(d.id) !== cur.get(d.id)) changes.push({ type: 'modified', doc: d }); }
      for (const [id] of prev) if (!cur.has(id)) changes.push({ type: 'removed', doc: snap(id, JSON.parse(prev.get(id))) });
      prev = cur;
      onNext({ docs, empty: !docs.length, size: docs.length, docChanges: () => changes });
    } catch (e) { if (onErr) onErr(e); else throw e; }
  };
  listeners.add(emit);
  setTimeout(emit, 0);
  return () => listeners.delete(emit);
}
