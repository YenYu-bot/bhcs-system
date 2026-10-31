// 極簡 Firebase Auth mock
const users = (window.__users = window.__users || {});   // email -> {uid, password}
let uidSeq = 1;
const auths = new Map();
const err = code => Object.assign(new Error(code), { code: 'auth/' + code });
export function getAuth(app) {
  const key = app?.name || '[DEFAULT]';
  if (!auths.has(key)) auths.set(key, { currentUser: null, listeners: [], name: key });
  return auths.get(key);
}
function fire(a) { a.listeners.forEach(l => l(a.currentUser)); }
export async function createUserWithEmailAndPassword(a, email, password) {
  if (users[email]) throw err('email-already-in-use');
  if (password.length < 6) throw err('weak-password');
  users[email] = { uid: 'uid' + (uidSeq++), password };
  a.currentUser = { uid: users[email].uid, email };
  fire(a);
  return { user: a.currentUser };
}
export async function signInWithEmailAndPassword(a, email, password) {
  const u = users[email];
  if (!u || u.password !== password) throw err('invalid-credential');
  a.currentUser = { uid: u.uid, email };
  fire(a);
  return { user: a.currentUser };
}
export async function signOut(a) { a.currentUser = null; fire(a); }
export async function updatePassword(user, p) { if (p.length < 6) throw err('weak-password'); users[user.email].password = p; }
export function onAuthStateChanged(a, cb) { a.listeners.push(cb); setTimeout(() => cb(a.currentUser), 0); return () => {}; }
export async function sendPasswordResetEmail(a, email) { window.__resetSent = (window.__resetSent||[]).concat(email); }
