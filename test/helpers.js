// 測試共用：靜態伺服器 + Playwright + Firebase 假件（不連真的 Firebase）
// 執行：node test/<檔名>.js   （需先 npm i -D playwright && npx playwright install chromium）
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOCK = path.join(__dirname, 'mocks');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json', '.pdf':'application/pdf' };

async function launch(opts = {}) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const f = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/invalid-credential/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
  const dialogs = [];
  let promptAnswers = [];
  page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message().slice(0, 60)); d.accept(d.type() === 'prompt' ? promptAnswers.shift() : undefined); });
  for (const [re, f] of [[/firebase-app\.js/, 'mock-app.js'], [/firebase-firestore\.js/, 'mock-firestore.js'], [/firebase-auth\.js/, 'mock-auth.js']])
    await page.route(re, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(MOCK, f)) }));
  await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  // pdf.js：本機有 pdfjs-dist 就用本機（沙盒連不到 CDN），否則放行真的 CDN
  const local = opts.pdfjsDir || process.env.PDFJS_DIR;
  if (local && fs.existsSync(path.join(local, 'pdf.min.mjs'))) {
    await page.route(/pdf\.min\.mjs$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(local, 'pdf.min.mjs')) }));
    await page.route(/pdf\.worker\.min\.mjs$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(local, 'pdf.worker.min.mjs')) }));
  }
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(300);

  const log = (...a) => console.log('•', ...a);
  const toast = async () => (await page.locator('#toast').textContent()).trim();
  const visible = sel => page.locator(sel).isVisible();
  const passForce = async () => { if (await visible('#forcePassModal')) { await page.click('text=稍後再說'); await page.waitForTimeout(200); } };
  const setupAdmin = async (pw = 'admin123') => {
    await page.click('text=首次使用？建立主管帳號');
    await page.fill('#setupPass', pw); await page.fill('#setupPass2', pw);
    await page.click('text=建立主管帳號 >> nth=1'); await page.waitForTimeout(300);
  };
  const addTeacher = async (name, userId, pw = 'teach123') => {
    await page.click('text=⚙️ 帳號管理');
    await page.fill('#newName', name); await page.fill('#newUser', userId); await page.fill('#newPass', pw); await page.fill('#newPass2', pw);
    await page.click('text=✅ 新增帳號'); await page.waitForTimeout(250);
  };
  const login = async (user, pw) => {
    await page.fill('#loginUser', user); await page.fill('#loginPass', pw);
    await page.click('#loginPage button:has-text("登入")'); await page.waitForTimeout(400);
    await passForce();
  };
  const logout = async () => {
    const sel = (await visible('#adminPage')) ? '#adminPage >> text=登出' : '#appPage >> text=登出';
    await page.click(sel); await page.waitForTimeout(200);
  };
  const seed = fn => page.evaluate(fn);
  const store = () => page.evaluate(() => window.__store);
  const finish = async () => {
    console.log('ERRORS:', errors.length ? errors : 'none');
    await browser.close(); server.close();
    if (errors.length) process.exitCode = 1;
  };
  return { page, log, toast, visible, passForce, setupAdmin, addTeacher, login, logout, seed, store, finish, errors, dialogs, setPrompts: a => { promptAnswers = a; } };
}
module.exports = { launch, ROOT };
