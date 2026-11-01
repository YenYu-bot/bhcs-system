// 百宏靈獸：選獸 → 加分（上限、倍率）→ 試煉 → 任務發靈石 → 商店 → 懲罰 → 撤銷 → 全班目標 → 主管設定 → 學生頁
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch({ path: 'beasts.html' }); const { page, log, toast, visible } = t;
  const wait = (ms = 250) => page.waitForTimeout(ms);
  // 種子：老師 t1、主管、兩個班（甲 同時在兩班 → 2 門課）
  await t.seed(() => {
    window.__users['t1@bhcs.local'] = { uid: 'uidT', password: 'teach123' };
    window.__users['admin@bhcs.local'] = { uid: 'uidA', password: 'admin123' };
    window.__store.teachers = { uidT: { userId: 't1', name: '老師甲', authEmail: 't1@bhcs.local' } };
    window.__store.logins = { t1: { authEmail: 't1@bhcs.local', uid: 'uidT' } };
    window.__store.classes = { c1: { teacherId: 't1', name: '國一英文', students: ['甲', '乙', '丙'] }, c2: { teacherId: 't2', name: '國一數學', students: ['甲'] } };
  });
  const login = async (u, p) => { await page.fill('#loginUser', u); await page.fill('#loginPass', p); await page.click('#loginPage button:has-text("登入")'); await wait(500); };
  await login('t1', 'teach123');
  ok(await visible('#appPage'), 'teacher logged in');
  eq(await page.locator('#classSelect option').count(), 2, 'only own class listed (+placeholder)');
  await page.selectOption('#classSelect', 'c1'); await wait(300);
  eq(await page.locator('#beastGrid .beast-card.unassigned').count(), 3, '3 unassigned');

  // 選獸
  await page.locator('#beastGrid .beast-card.unassigned').first().click(); await wait(200);
  ok(await visible('#pickModal'), 'pick modal');
  await page.click('#pickGrid .pick-card:has-text("青龍")'); await wait(400);
  let beasts = Object.values((await t.store()).beasts);
  eq(beasts.length, 1, 'beast created');
  const bid = Object.keys((await t.store()).beasts)[0];
  eq([beasts[0].name, beasts[0].beast, beasts[0].realm, beasts[0].courseCount], ['甲', 'qinglong', 1, 2], 'beast fields (2 courses)');
  const beast = async () => (await t.store()).beasts[bid];

  // 加分：固定原因 +1，自訂 +10 ×4 → 2 門課上限 38
  await page.locator('#beastGrid .beast-card[data-id]').first().click(); await wait(300);
  ok(await visible('#studentModal'), 'student modal');
  await page.click('#st-award .reason-btn:has-text("準時到班")'); await wait(300);
  eq((await beast()).pts, 1, '+1');
  for (let i = 0; i < 4; i++) { await page.fill('#awReason', '測試'); await page.fill('#awPts', '10'); await page.click('#st-award .custom-row button'); await wait(300); }
  let b = await beast();
  eq([b.pts, b.weekPts, b.realm], [38, 38, 2], 'capped at 38 for 2 courses, realm 築基');
  includes(await toast(), '上限', 'cap toast');

  // 試煉：直接把靈氣塞到 95（元嬰門檻 90 需試煉）→ 境界仍 3，面板出現通過按鈕
  await t.seed(() => { const b = Object.values(window.__store.beasts)[0]; b.pts = 95; b.realm = 3; b.weekPts = 0; });
  await page.fill('#awReason', '觸發重算'); await page.fill('#awPts', '1'); await page.click('#st-award .custom-row button'); await wait(300);
  b = await beast(); eq([b.pts, b.realm], [96, 3], 'stuck at 結丹 pending trial');
  await page.click('#smTabs .tab:has-text("試煉")'); await wait(200);
  ok(await visible('#st-trial button:has-text("✅ 通過")'), 'trial pass button');
  await page.click('#st-trial button:has-text("未通過")'); await wait(300);
  b = await beast(); ok(b.trialFailAt && b.trialFailAt[4] > 0, 'fail recorded');
  await wait(200); includes(await page.locator('#st-trial').textContent(), '冷卻', 'cooldown shown');
  await t.seed(() => { Object.values(window.__store.beasts)[0].trialFailAt = {}; window.__notify(); });
  await page.click('#smTabs .tab:has-text("加分")'); await page.click('#smTabs .tab:has-text("試煉")'); await wait(200);
  await page.click('#st-trial button:has-text("✅ 通過")'); await wait(300);
  b = await beast(); eq([b.realm, b.trials[4]], [4, true], '元嬰 after trial pass');
  await page.click('#studentModal >> text=✕'); await wait(200);

  // 任務：5 靈石一次性 → 發給甲 → 入帳、班級額度、awarded
  await page.click('#tabs .tab:has-text("任務")'); await wait(200);
  await page.fill('#taskTitle', '背單字'); await page.fill('#taskStones', '25'); await page.click('#tab-tasks button:has-text("建立")'); await wait(200);
  includes(await toast(), '最多 20', 'task cap');
  await page.fill('#taskStones', '5'); await page.click('#tab-tasks button:has-text("建立")'); await wait(300);
  eq(await page.locator('.task-card').count(), 1, 'task listed');
  await page.click('.task-card label:has-text("甲")'); await page.click('.task-card button:has-text("發放")'); await wait(400);
  b = await beast(); eq([b.stones, b.weekStones], [5, 5], 'stones granted');
  const cs = (await t.store()).beastClass.c1; eq(cs.issued.total, 5, 'class issued total');
  const task = Object.values((await t.store()).beastTasks)[0]; eq(task.awarded['甲'], ['once'], 'awarded once');
  await wait(200); ok(await page.locator('.task-card label.done:has-text("甲")').count() === 1, '甲 marked done');

  // 商店：靈石不足 → 按鈕 disabled；塞 100 靈石 → 買仙帽、聚靈丹 → 下次加分 ×2
  await page.click('#tabs .tab:has-text("課堂")'); await wait(200);
  await page.locator('#beastGrid .beast-card[data-id]').first().click(); await wait(300);
  await page.click('#smTabs .tab:has-text("商店")'); await wait(200);
  ok(await page.locator('#st-shop .shop-item:has-text("仙帽") button').isDisabled(), 'cannot afford hat');
  await t.seed(() => { Object.values(window.__store.beasts)[0].stones = 100; window.__notify(); });
  await wait(300);
  await page.click('#st-shop .shop-item:has-text("仙帽") button'); await wait(300);
  b = await beast(); eq([b.stones, b.cosmetics], [90, ['hat']], 'hat bought');
  await page.click('#st-shop .shop-item:has-text("聚靈丹") button'); await wait(300);
  b = await beast(); eq([b.stones, b.julingActive], [50, true], 'juling bought');
  await page.click('#st-shop .shop-item:has-text("聚靈丹") button'); await wait(300);
  includes(await toast(), '限購', 'weekly limit');
  await page.click('#smTabs .tab:has-text("加分")'); await wait(200);
  await page.click('#st-award .reason-btn:has-text("幫助同學")'); await wait(300);
  b = await beast(); eq([b.pts, b.julingActive], [100, false], '+2 doubled to +4, juling consumed');

  // 懲罰：扣 3 靈氣（元嬰門檻 90，100-3=97）→ 撤銷 → 100
  await page.click('#smTabs .tab:has-text("懲罰")'); await wait(200);
  await page.click('#st-penalty .reason-btn:has-text("扣 3")'); await wait(300);
  b = await beast(); eq(b.pts, 97, 'penalty -3');
  await page.selectOption('#pnKind', 'stones'); await page.click('#st-penalty .reason-btn:has-text("扣 5")'); await wait(300);
  b = await beast(); eq(b.stones, 45, 'penalty -5 stones');
  await page.click('#smTabs .tab:has-text("紀錄")'); await wait(300);
  const rows = page.locator('#st-log .log-row');
  ok((await rows.count()) >= 8, 'log rows');
  await rows.filter({ hasText: '遲到' }).first().locator('button:has-text("撤銷")').click(); await wait(400);
  b = await beast(); eq(b.stones, 50, 'stones penalty undone (latest 遲到 row)');
  await page.click('#studentModal >> text=✕'); await wait(200);

  // 全班目標：+2 不受上限
  await page.fill('#goalText', '作業全交'); await page.press('#goalText', 'Tab'); await wait(300);
  await page.click('#goalBtn'); await wait(500);
  b = await beast(); eq(b.pts, 99, 'goal +2');
  eq((await t.store()).beastClass.c1.goal.doneWeek.length, 10, 'goal done week recorded');
  ok(await page.locator('#goalBtn').isDisabled(), 'goal button disabled after done');

  // 主管：設定上限 → 存檔
  await page.click('#appPage >> text=登出'); await wait(300);
  await login('admin', 'admin123');
  await page.click('#tabs .tab:has-text("設定")'); await wait(300);
  await page.fill('#cfgCaps input[data-cap="weekPts"]', '30');
  await page.click('button:has-text("儲存設定")'); await wait(400);
  eq((await t.store()).beastConfig.main.caps.weekPts, 30, 'config saved');
  eq(await page.locator('#classSelect option').count(), 3, 'admin sees all classes');

  // 學生頁（同一份 store 重新注入後開 beast.html）
  const dump = await t.store();
  await page.addInitScript(s => { window.__store = s; }, dump);
  await page.goto(page.url().replace(/beasts\.html.*$/, '') + 'beast.html?t=' + bid); await wait(500);
  const txt = await page.locator('#view').textContent();
  includes(txt, '甲 的本命靈獸', 'student page name'); includes(txt, '元嬰', 'student page realm'); includes(txt, '99', 'student page pts');
  includes(txt, '仙帽', 'student page cosmetics'); includes(txt, '作業全交', 'student page log');
  ok(!(await page.locator('#view button').count()), 'student page has no buttons');

  log('beasts test OK');
  await t.finish();
})().catch(e => { console.error(e); process.exit(1); });
