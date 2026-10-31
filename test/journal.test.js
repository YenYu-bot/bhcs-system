// 教室日誌（拆檔後的回歸）：老師新增班級 → 填日誌 → 歷史記錄 → 主管所有日誌看得到 → 停課申請
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch(); const { page, log, toast, visible } = t;
  await t.setupAdmin(); await t.addTeacher('T', 't1'); await t.logout(); await t.login('t1', 'teach123');
  // 班級
  await page.click('#appPage >> text=🏫 班級管理'); await page.waitForTimeout(200);
  await page.click('text=＋ 新增班級'); await page.waitForTimeout(200);
  await page.fill('#className', '國一英文');
  await page.click('#classModal >> text=＋ 新增學生'); await page.locator('.student-build-input').nth(0).fill('甲');
  await page.click('#classModal >> text=＋ 新增學生'); await page.locator('.student-build-input').nth(1).fill('乙');
  await page.click('text=儲存班級'); await page.waitForTimeout(400);
  includes(await toast(), '班級已儲存');
  const cls = Object.values((await t.store()).classes)[0];
  eq([cls.teacherId, cls.name, cls.students], ['t1', '國一英文', ['甲', '乙']], 'class saved');
  // 日誌
  await page.click('#appPage >> text=📝 填寫日誌'); await page.waitForTimeout(200);
  const cid = Object.keys((await t.store()).classes)[0];
  await page.selectOption('#journalClassSelect', cid); await page.waitForTimeout(200);
  ok(await visible('#journalForm'), 'journal form shown');
  await page.fill('#fDate', '10/31'); await page.selectOption('#fWeekday', '六');
  await page.locator('#attendanceGrid .att-chip').nth(1).click();   // 乙 → 遲到
  await page.fill('#fProgress', 'WB p46');
  await page.click('text=☁️ 儲存至雲端'); await page.waitForTimeout(400);
  includes(await toast(), '已儲存至雲端');
  const e = Object.values((await t.store()).entries)[0];
  eq([e.teacherId, e.classId, e.date, e.attendance['乙'], e.todayProgress], ['t1', cid, '10/31', 'late', 'WB p46'], 'entry saved');
  // 歷史
  await page.click('#appPage >> text=📋 歷史記錄'); await page.waitForTimeout(300);
  eq(await page.locator('#historyList .entry-card').count(), 1, 'history shows entry');
  // 停課申請
  await page.click('#appPage >> text=📝 填寫日誌'); await page.waitForTimeout(200);
  await page.click('text=🚫 登記停課'); await page.waitForTimeout(200);
  await page.selectOption('#closureClass', cid);
  await page.fill('#closureDate', '2026-11-03').catch(() => {});
  await page.fill('#closureReason', '颱風');
  await page.click('text=送出申請').catch(async () => { await page.click('#teacherClosurePanel button.btn-teal'); });
  await page.waitForTimeout(400);
  const cl = Object.values((await t.store()).closures || {})[0];
  ok(cl && cl.status === 'pending' && cl.createdBy === 't1', 'closure pending by teacher: ' + JSON.stringify(cl));
  // 主管看所有日誌
  await t.logout(); await t.login('admin', 'admin123');
  await page.click('text=📋 所有日誌'); await page.waitForTimeout(400);
  ok((await page.locator('#admin-tab-entries').textContent()).includes('國一英文'), 'admin sees entry');
  log('journal.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
