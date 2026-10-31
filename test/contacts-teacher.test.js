// 老師端電訪表：名單分組、未填／已填、未接通不計、只看未填、新增／編輯／移除學生、電訪新增／編輯／旗標、匯出、快取
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
const fs = require('fs');
(async () => {
  const t = await launch(); const { page, log, toast, visible } = t;
  await t.seed(() => {
    const S = window.__store;
    S.ctStudents = {
      a: { name:'甲', phones:['0911'], sourceClasses:['X班'], teacherIds:['t1'], classTeachers:{X班:'t1'}, active:true },
      b: { name:'乙', phones:['0922','0933'], sourceClasses:['X班','Y班'], teacherIds:['t1','t2'], classTeachers:{X班:'t1',Y班:'t2'}, active:true },
      c: { name:'丙', phones:['0944'], sourceClasses:['Z班'], teacherIds:['t2'], classTeachers:{Z班:'t2'}, active:true },
      d: { name:'丁', phones:['0955'], sourceClasses:['W班'], teacherIds:['t1'], classTeachers:{}, active:true },
    };
    S.contacts = { k1: { studentId:'a', studentName:'甲', teacherId:'t1', teacherName:'T', date:'2026-10-20', method:'noanswer', content:'沒接' } };
  });
  await t.setupAdmin(); await t.addTeacher('T', 't1'); await t.logout(); await t.login('t1', 'teach123');
  await page.click('#appPage >> text=📞 電訪表'); await page.waitForTimeout(300);
  eq(await page.locator('#ctTeacherList .card').count(), 3, 'only my students');
  const groups = await page.evaluate(() => [...document.querySelectorAll('#ctTeacherList > div')].filter(d => !d.classList.contains('card')).map(d => d.textContent.trim()));
  eq(groups, ['X班（2）', '未標示班別（1）'], 'grouped by my class');
  const tags = await page.locator('#ctTeacherList .card .tag').allTextContents();
  ok(tags.includes('未填（已嘗試 1 次）'), 'noanswer shows tries: ' + tags);
  includes(await page.locator('#ctTeacherSummary').textContent(), '0 / 3');

  // 新增電訪 + 旗標
  await page.locator('#ctTeacherList .card', { hasText: '乙' }).locator('text=＋ 新增電訪').click(); await page.waitForTimeout(200);
  eq(await page.inputValue('#ctfDate'), new Date().toISOString().slice(0, 10), 'date default today');
  await page.fill('#ctfContent', '家長反映作業太多'); await page.check('#ctfFlag');
  await page.click('#ctModal >> text=☁️ 儲存'); await page.waitForTimeout(300);
  includes(await toast(), '電訪已儲存');
  const c = Object.values((await t.store()).contacts).find(x => x.studentId === 'b');
  eq([c.teacherId, c.flag, c.method], ['t1', true, 'phone'], 'contact saved');
  includes(await page.locator('#ctTeacherSummary').textContent(), '1 / 3');

  // 只看未填
  await page.click('#ctFilterMissing'); await page.waitForTimeout(200);
  eq(await page.locator('#ctTeacherList .card').count(), 2, 'missing filter');
  await page.click('#ctFilterAll'); await page.waitForTimeout(100);

  // 編輯電訪
  const card = page.locator('#ctTeacherList .card', { hasText: '乙' });
  await card.locator('div[onclick^="ctToggleStudent"]').click(); await page.waitForTimeout(200);
  await card.locator('button:has-text("✏️"):not([title])').first().click(); await page.waitForTimeout(200);
  includes(await page.locator('#ctModalTitle').textContent(), '編輯電訪：乙');
  await page.fill('#ctfContent', '（已編輯）'); await page.click('#ctModal >> text=☁️ 儲存'); await page.waitForTimeout(300);
  eq(Object.values((await t.store()).contacts).find(x => x.studentId === 'b').content, '（已編輯）', 'edited');

  // 學生：新增／編輯／移除
  await page.click('#tab-contacts >> text=＋ 新增學生'); await page.waitForTimeout(200);
  await page.fill('#ctsName', '新生'); await page.fill('#ctsPhones', '0966'); await page.fill('#ctsClasses', 'X班');
  await page.click('#ctStudentModal >> text=儲存'); await page.waitForTimeout(400);
  const ns = Object.values((await t.store()).ctStudents).find(s => s.name === '新生');
  eq([ns.teacherIds, ns.classTeachers], [['t1'], { X班:'t1' }], 'teacher-added student paired to self');
  await page.locator('#ctTeacherList .card', { hasText: '新生' }).locator('button[title="編輯學生資料"]').click(); await page.waitForTimeout(200);
  await page.fill('#ctsName', '新生2'); await page.click('#ctStudentModal >> text=儲存'); await page.waitForTimeout(400);
  ok(await page.locator('#ctTeacherList .card', { hasText: '新生2' }).isVisible(), 'renamed');
  await page.locator('#ctTeacherList .card', { hasText: '新生2' }).locator('button[title="從我的名單移除"]').click(); await page.waitForTimeout(400);
  const rs = Object.values((await t.store()).ctStudents).find(s => s.name === '新生2');
  eq([rs.teacherIds, rs.active], [[], false], 'removed self → inactive');

  // 匯出
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tab-contacts >> text=📄 CSV')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  includes(csv.split('\r\n')[0], '需主管關注'); includes(csv, '乙');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#tab-contacts >> text=🖨 列印版')]);
  await popup.waitForLoadState(); includes(await popup.title(), '電訪表（T）'); await popup.close();

  // 快取：切 tab 不重撈
  const r1 = await page.evaluate(() => window.__reads);
  await page.click('#appPage >> text=📋 歷史記錄'); await page.waitForTimeout(150);
  await page.click('#appPage >> text=📞 電訪表'); await page.waitForTimeout(150);
  await page.click('#appPage >> text=📋 歷史記錄'); await page.waitForTimeout(150);
  await page.click('#appPage >> text=📞 電訪表'); await page.waitForTimeout(150);
  const r2 = await page.evaluate(() => window.__reads);
  ok(r2 - r1 <= 1, `tab switches cached (reads=${r2 - r1})`);
  await page.click('#appPage button[title="重新載入資料"]'); await page.waitForTimeout(400);
  ok((await page.evaluate(() => window.__reads)) > r2, 'refresh re-reads');
  log('contacts-teacher.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
