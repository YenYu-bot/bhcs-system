// 帳號：建立主管、新增老師、改密碼提醒、備援主管、忘記密碼、重設密碼、刪除老師清配對
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch(); const { page, log, toast, visible } = t;
  await t.setupAdmin();
  ok(await visible('#adminPage'), 'admin page after setup');
  await t.addTeacher('巫奕潔', 'bhcst0010', '123456');
  const teachers = Object.values(await t.store().then(s => s.teachers));
  eq(teachers.map(x => [x.userId, x.mustChangePassword]), [['bhcst0010', true]], 'teacher doc');
  eq(await page.locator('.teacher-card .tag-yellow').count(), 1, '登入會提醒改密碼 tag');

  // 備援主管
  t.setPrompts(['boss@gmail.com', 'bosspass1']);
  await page.click('text=＋ 新增備援帳號'); await page.waitForTimeout(400);
  includes(await toast(), '備援主管帳號已建立');
  eq(Object.values((await t.store()).admins).map(a => a.email), ['boss@gmail.com'], 'admins doc');

  // 老師登入 → 提醒（不強迫）
  await t.logout();
  await page.fill('#loginUser', 'bhcst0010'); await page.fill('#loginPass', '123456');
  await page.click('#loginPage button:has-text("登入")'); await page.waitForTimeout(400);
  ok(await visible('#forcePassModal'), 'reminder shown');
  await page.click('text=稍後再說'); await page.waitForTimeout(200);
  ok(!(await visible('#forcePassModal')) && await visible('#appPage'), 'dismissed, page usable');
  await page.click('#appPage >> text=🔑 改密碼').catch(() => {});
  // 改密碼走 prompt
  await t.logout();
  await page.fill('#loginUser', 'bhcst0010'); await page.fill('#loginPass', '123456');
  await page.click('#loginPage button:has-text("登入")'); await page.waitForTimeout(400);
  await page.fill('#forcePass1', 'mynewpass9'); await page.fill('#forcePass2', 'mynewpass9'); await page.click('text=設定新密碼'); await page.waitForTimeout(400);
  includes(await toast(), '密碼已更新');
  eq(Object.values((await t.store()).teachers)[0].mustChangePassword, false, 'flag cleared');

  // 備援主管用 Email 登入
  await t.logout();
  await t.login('boss@gmail.com', 'bosspass1');
  ok(await visible('#adminPage'), 'backup admin → admin page');

  // 重設密碼 → 新 auth user、舊 teachers 文件刪除
  await page.click('text=⚙️ 帳號管理'); await page.waitForTimeout(200);
  t.setPrompts(['resetpw123']);
  await page.locator('.teacher-card', { hasText: '巫奕潔' }).locator('text=🔑 重設密碼').click(); await page.waitForTimeout(400);
  includes(await toast(), '密碼已重設');
  const s1 = await t.store();
  eq(Object.keys(s1.teachers).length, 1, 'one teacher doc after reset');
  ok(s1.logins.bhcst0010.authEmail.startsWith('bhcst0010-r'), 'new auth email');

  // 忘記密碼
  await t.logout();
  t.setPrompts(['boss@gmail.com']);
  await page.click('text=忘記密碼？'); await page.waitForTimeout(300);
  eq(await page.evaluate(() => window.__resetSent), ['boss@gmail.com'], 'reset mail sent');
  t.setPrompts(['bhcst0010']);
  await page.click('text=忘記密碼？'); await page.waitForTimeout(300);
  includes(await toast(), '請聯絡主管');

  // 刪除老師 → 配對清掉
  await t.login('admin', 'admin123');
  await t.seed(() => { window.__store.ctStudents = { s1: { name:'甲', phones:[], sourceClasses:['X'], teacherIds:['bhcst0010'], classTeachers:{X:'bhcst0010'}, active:true } }; });
  await page.click('text=⚙️ 帳號管理'); await page.waitForTimeout(200);
  await page.locator('.teacher-card', { hasText: '巫奕潔' }).locator('text=🗑 刪除').click(); await page.waitForTimeout(200);
  await page.click('#deleteModal button:has-text("確認刪除")'); await page.waitForTimeout(400);
  includes(await toast(), '已取消 1 位學生的配對');
  eq((await t.store()).ctStudents.s1.teacherIds, [], 'pairing cleared');
  log('auth.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
