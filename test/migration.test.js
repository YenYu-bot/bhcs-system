// 舊系統搬遷：老師帳號建立（含初始密碼提醒）、各集合複製（假件裡新舊專案共用同一個 store，驗證流程不報錯）
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch(); const { page, log, toast } = t;
  await t.seed(() => {
    const S = window.__store;
    S.teachers = { old1: { userId:'bhcst0001', name:'余老師', password:'1234' }, old2: { userId:'bhcst0002', name:'Mandy', password:'1234' } };
    S.classes = { c1: { teacherId:'bhcst0001', name:'A班', students:['甲','乙'] } };
    S.entries = { e1: { teacherId:'bhcst0001', classId:'c1', date:'10/20', students:['甲','乙'] } };
  });
  await t.setupAdmin();
  await page.click('text=⚙️ 帳號管理'); await page.waitForTimeout(200);
  await page.fill('#migInitPass', 'bhcs2026');
  await page.click('text=🔁 開始搬遷'); await page.waitForTimeout(800);
  includes(await page.locator('#migLog').textContent(), '搬遷完成');
  const S = await t.store();
  const made = Object.values(S.teachers).filter(x => x.authEmail);
  eq(made.map(x => [x.userId, x.mustChangePassword]).sort(), [['bhcst0001', true], ['bhcst0002', true]], 'teachers provisioned with reminder flag');
  eq(Object.keys(S.logins).sort(), ['bhcst0001', 'bhcst0002'], 'logins');
  // 再跑一次 → 跳過已存在
  await page.click('text=🔁 開始搬遷'); await page.waitForTimeout(800);
  includes(await page.locator('#migLog').textContent(), '新建 0');   // 假件裡新舊共用 store，所以會多列幾筆「跳過」
  // 新帳號可登入
  await t.logout(); await t.login('bhcst0001', 'bhcs2026');
  ok(await t.visible('#appPage'), 'migrated teacher can log in');
  log('migration.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
