// 電訪週期（每月 11 日～次月 10 日）：老師端月份切換、主管未填回報／紀錄的月份選擇、跨年
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch(); const { page, log } = t;
  await t.seed(() => {
    const S = window.__store;
    S.ctStudents = { a: { name:'甲', phones:['0911'], sourceClasses:['X班'], teacherIds:['t1'], classTeachers:{X班:'t1'}, active:true },
                     b: { name:'乙', phones:['0922'], sourceClasses:['X班'], teacherIds:['t1'], classTeachers:{X班:'t1'}, active:true } };
    S.contacts = {
      k1: { studentId:'a', studentName:'甲', teacherId:'t1', teacherName:'T', date:'2026-10-05', method:'phone', content:'9月份期（10/5）' },
      k2: { studentId:'b', studentName:'乙', teacherId:'t1', teacherName:'T', date:'2026-09-20', method:'phone', content:'9月份期' },
      k3: { studentId:'a', studentName:'甲', teacherId:'t1', teacherName:'T', date:'2026-12-20', method:'phone', content:'12月份期' },
      k4: { studentId:'b', studentName:'乙', teacherId:'t1', teacherName:'T', date:'2027-01-08', method:'phone', content:'12月份期（跨年）' },
    };
  });
  await t.setupAdmin(); await t.addTeacher('T', 't1');
  await page.click('text=📞 電訪管理'); await page.waitForTimeout(300);
  // 未填回報：選 2026-09 → 9/11～10/10，兩人皆已填
  await page.fill('#ctMissMonth', '2026-09'); await page.dispatchEvent('#ctMissMonth', 'change'); await page.waitForTimeout(400);
  eq([await page.inputValue('#ctMissFrom'), await page.inputValue('#ctMissTo')], ['2026-09-11', '2026-10-10'], 'Sep period bounds');
  eq((await page.locator('#ctMissingOut .summary-num').allTextContents()).slice(0, 2), ['2', '0'], 'Sep: both done');
  // 12 月份跨年：12/11～1/10
  await page.fill('#ctMissMonth', '2026-12'); await page.dispatchEvent('#ctMissMonth', 'change'); await page.waitForTimeout(400);
  eq([await page.inputValue('#ctMissFrom'), await page.inputValue('#ctMissTo')], ['2026-12-11', '2027-01-10'], 'Dec period crosses year');
  eq((await page.locator('#ctMissingOut .summary-num').allTextContents()).slice(0, 2), ['2', '0'], 'Dec: both done incl. 1/8');
  // 紀錄頁：全部 → 分段
  await page.click('#ctSubTabs >> text=📋 紀錄 / 匯出'); await page.waitForTimeout(200);
  await page.click('#ct-sec-records button:has-text("全部")'); await page.waitForTimeout(400);
  const heads = await page.evaluate(() => [...document.querySelectorAll('#ctRecordsOut > div')].filter(d => d.textContent.startsWith('📅')).map(d => d.textContent.trim()));
  eq(heads, ['📅 2026 年 12 月份（12/11～1/10）（2 筆）', '📅 2026 年 9 月份（9/11～10/10）（2 筆）'], 'period headers');
  // 老師端
  await t.logout(); await t.login('t1', 'teach123');
  await page.click('#appPage >> text=📞 電訪表'); await page.waitForTimeout(300);
  await page.fill('#ctTeacherMonth', '2026-09'); await page.dispatchEvent('#ctTeacherMonth', 'change'); await page.waitForTimeout(300);
  includes(await page.locator('#ctTeacherSummary').textContent(), '9 月份（9/11～10/10）');
  eq(await page.locator('#ctTeacherList .card .tag').allTextContents(), ['已填', '已填'], 'Sep tags');
  eq([await page.inputValue('#ctExpFrom'), await page.inputValue('#ctExpTo')], ['2026-09-11', '2026-10-10'], 'export range follows period');
  log('period.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
