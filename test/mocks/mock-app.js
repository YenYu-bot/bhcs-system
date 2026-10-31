const apps = [];
export function initializeApp(config, name = '[DEFAULT]') { const a = { name, options: config }; apps.push(a); return a; }
export function getApps() { return apps.slice(); }
export function getApp(name = '[DEFAULT]') { const a = apps.find(x => x.name === name); if (!a) throw new Error('no app ' + name); return a; }
