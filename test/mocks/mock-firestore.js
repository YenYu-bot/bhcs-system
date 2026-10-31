// 極簡 in-memory Firestore mock（只支援本專案用到的 API）
const store = (window.__store = window.__store || {});
let idSeq = 1;
const col = name => (store[name] = store[name] || {});
export function getFirestore() { return { __db: true }; }
export function collection(db, name) { return { kind: 'col', name }; }
export function doc(db, name, id) { return { kind: 'doc', name, id }; }
export function query(c, ...clauses) { return { kind: 'query', name: c.name, clauses }; }
export function where(field, op, value) { return { field, op, value }; }
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
const snap = (id, data) => ({ id, exists: () => data !== undefined, data: () => data && JSON.parse(JSON.stringify(data)) });
export async function getDocs(q) {
  window.__reads = (window.__reads || 0) + 1;
  const c = col(q.name);
  const clauses = q.clauses || [];
  const docs = Object.entries(c).filter(([, d]) => clauses.every(cl => matches(d, cl))).map(([id, d]) => snap(id, d));
  return { docs, empty: !docs.length, size: docs.length };
}
export async function getDoc(ref) { return snap(ref.id, col(ref.name)[ref.id]); }
export async function addDoc(c, data) { const id = 'id' + (idSeq++); col(c.name)[id] = JSON.parse(JSON.stringify(data)); return { id }; }
export async function setDoc(ref, data) { col(ref.name)[ref.id] = JSON.parse(JSON.stringify(data)); }
export async function updateDoc(ref, patch) {
  const c = col(ref.name);
  if (!c[ref.id]) throw new Error('No document to update: ' + ref.name + '/' + ref.id);
  Object.assign(c[ref.id], JSON.parse(JSON.stringify(patch)));
}
export async function deleteDoc(ref) { delete col(ref.name)[ref.id]; }
