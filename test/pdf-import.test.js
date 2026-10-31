// 點名表 PDF 匯入（真實 PDF）：需要 test/fixtures/roster.pdf（含個資，不進 repo）；沒有就略過
// 沙盒連不到 CDN 時，設 PDFJS_DIR=<pdfjs-dist/build 目錄> 用本機 pdf.js
const fs = require('fs'); const path = require('path');
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
const PDF = path.join(__dirname, 'fixtures', 'roster.pdf');
if (!fs.existsSync(PDF)) { console.log('• pdf-import.test SKIPPED（沒有 test/fixtures/roster.pdf）'); process.exit(0); }
(async () => {
  const t = await launch(); const { page, log, toast } = t;
  await t.setupAdmin(); await t.addTeacher('巫奕潔', 'bhcst0010'); await t.addTeacher('Mandy', 'bhcst0002');
  t.setPrompts(['廖嘉慧']);
  await page.locator('.teacher-card', { hasText: 'Mandy' }).locator('text=🏷 點名表姓名').click(); await page.waitForTimeout(300);
  await page.click('text=📞 電訪管理'); await page.waitForTimeout(200);
  await page.click('#ctSubTabs >> text=📥 匯入名冊'); await page.waitForTimeout(200);
  await page.setInputFiles('#ctImportFile', PDF);
  await page.waitForFunction(() => document.querySelectorAll('#ctImportPreview .card').length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const tables = await page.evaluate(() => [...document.querySelectorAll('#ctImportPreview .card')].map(c => [c.querySelector('input.form-input').value, c.querySelectorAll('tbody tr').length, c.querySelector('select').value]));
  log('tables:', tables.length, '| students:', tables.reduce((n, x) => n + x[1], 0));
  ok(tables.length > 0, 'parsed at least one roster');
  ok(tables.every(x => x[0]), 'every table has a class name');
  ok(tables.some(x => x[2] === 'bhcst0010'), 'teacher auto-matched by name');
  ok(tables.some(x => x[2] === 'bhcst0002'), 'teacher auto-matched by alias');
  await page.evaluate(() => document.querySelectorAll('#ctImportPreview select').forEach(sel => { if (!sel.value) { sel.value = 'bhcst0010'; sel.dispatchEvent(new Event('change')); } }));
  await page.check('#ctImportReplace');
  await page.click('text=✅ 匯入勾選的學生'); await page.waitForTimeout(3000);
  const first = await toast(); includes(first, '匯入完成');
  const n1 = Object.keys((await t.store()).ctStudents).length;
  // 同一份再匯一次（以新表為準）：不應移除任何人
  await page.click('#ctSubTabs >> text=📥 匯入名冊'); await page.waitForTimeout(200);
  await page.setInputFiles('#ctImportFile', PDF);
  await page.waitForFunction(() => document.querySelectorAll('#ctImportPreview .card').length > 0, null, { timeout: 120000 });
  await page.evaluate(() => document.querySelectorAll('#ctImportPreview select').forEach(sel => { if (!sel.value) { sel.value = 'bhcst0010'; sel.dispatchEvent(new Event('change')); } }));
  await page.check('#ctImportReplace');
  await page.click('text=✅ 匯入勾選的學生'); await page.waitForTimeout(3000);
  includes(await toast(), '新增 0'); includes(await toast(), '移除班別 0');
  eq(Object.keys((await t.store()).ctStudents).length, n1, 'no duplicates on re-import');
  eq(Object.values((await t.store()).ctStudents).filter(s => s.active === false).length, 0, 'nobody deactivated');
  log('pdf-import.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
