// 主管端電訪管理：文字匯入（新增／合併／同名）、以新表為準、配對、未填回報、紀錄（月份／分段載入／旗標）、刪除保護、合併重複、快照還原
const { launch } = require('./helpers'); const { eq, ok, includes } = require('./assert');
(async () => {
  const t = await launch(); const { page, log, toast, visible } = t;
  await t.setupAdmin(); await t.addTeacher('巫奕潔', 'bhcst0010'); await t.addTeacher('余老師', 'bhcst0001');
  const goCt = async sec => { await page.click('text=📞 電訪管理'); await page.waitForTimeout(250); if (sec) { await page.click(`#ctSubTabs >> text=${sec}`); await page.waitForTimeout(250); } };

  // 匯入（文字）
  await goCt('📥 匯入名冊');
  await page.fill('#ctImportTextClass', '國小-全科班-一年級');
  await page.fill('#ctImportTextArea', '吳冠誼 0986396505 0989992551\n卓泰合 0921555913\n卓泰均 0921555913\n洪語喬 0978152732');
  await page.click('text=解析文字'); await page.waitForTimeout(200);
  eq(await page.locator('#ctImportPreview tbody tr').count(), 4, 'preview rows');
  await page.locator('#ctImportPreview select').selectOption('bhcst0010');
  await page.click('text=✅ 匯入勾選的學生'); await page.waitForTimeout(400);
  includes(await toast(), '新增 4、合併 0');
  await page.click('#ctSubTabs >> text=📥 匯入名冊'); await page.waitForTimeout(200);
  await page.fill('#ctImportTextClass', '國小-英文班');
  await page.fill('#ctImportTextArea', '吳冠誼 0986396505\n吳冠誼 0911111111\n陳冠穎 0982933101');
  await page.click('text=解析文字'); await page.waitForTimeout(200);
  eq(await page.locator('#ctImportPreview tbody .tag').allTextContents(), ['合併既有', '同名不同電話 → 新建', '新增'], 'merge statuses');
  await page.locator('#ctImportPreview select').selectOption('bhcst0001');
  await page.click('text=✅ 匯入勾選的學生'); await page.waitForTimeout(400);
  includes(await toast(), '新增 2、合併 1');
  let S = await t.store();
  const wu = Object.values(S.ctStudents).find(s => s.name === '吳冠誼' && s.phones.includes('0989992551'));
  eq([wu.sourceClasses, wu.teacherIds, wu.classTeachers], [['國小-全科班-一年級','國小-英文班'], ['bhcst0010','bhcst0001'], { '國小-全科班-一年級':'bhcst0010', '國小-英文班':'bhcst0001' }], 'merged student');
  eq(Object.keys(S.ctSnapshots).length, 2, 'snapshots saved per import');

  // 配對：單一勾選 + 批次
  ok(await visible('#ct-sec-pairs'), 'pairs after import');
  eq(await page.locator('#ctPairsOut tbody tr').count(), 6, 'pair rows');
  await page.locator('#ctPairsOut tr', { hasText: '卓泰均' }).locator('input[type=checkbox]').nth(1).check(); await page.waitForTimeout(200);
  S = await t.store(); eq(Object.values(S.ctStudents).find(s => s.name === '卓泰均').teacherIds, ['bhcst0010','bhcst0001'], 'toggle pair');
  await page.selectOption('#ctPairClass', '國小-英文班');
  await page.selectOption('#ctBatchTeacher', 'bhcst0010'); await page.click('text=全部指派'); await page.waitForTimeout(300);
  S = await t.store(); eq(Object.values(S.ctStudents).find(s => s.name === '陳冠穎').teacherIds, ['bhcst0001','bhcst0010'], 'batch assign');
  await page.selectOption('#ctPairClass', '');

  // 未填回報（未接通不計）
  await t.seed(() => { const S = window.__store; const id = Object.keys(S.ctStudents).find(k => S.ctStudents[k].name === '卓泰合');
    S.contacts = { k1: { studentId:id, studentName:'卓泰合', teacherId:'bhcst0010', teacherName:'巫', date:new Date().toISOString().slice(0,10), method:'noanswer', content:'x' } }; });
  await page.click('#ctSubTabs >> text=🔎 未填回報'); await page.waitForTimeout(300);
  await page.click('#adminPage >> text=🔄 更新').catch(() => {}); await page.waitForTimeout(300);
  await goCt('🔎 未填回報');
  const nums = await page.locator('#ctMissingOut .summary-num').allTextContents();
  eq(nums[0], '0', 'noanswer not counted (done=0): ' + nums);
  t.dialogs.length = 0;
  await page.click('text=📋 複製催填訊息'); await page.waitForTimeout(400);
  ok((await toast()).includes('催填') || t.dialogs.some(d => d.includes('複製以下訊息')), 'reminder text produced (clipboard or prompt)');

  // 刪除保護
  await page.click('#ctSubTabs >> text=🔗 配對'); await page.waitForTimeout(200);
  t.dialogs.length = 0;
  await page.locator('#ctPairsOut tr', { hasText: '卓泰合' }).locator('button[style*="--red"]').click(); await page.waitForTimeout(300);
  includes(t.dialogs[0], 'alert:'); includes(t.dialogs[0], '不能直接刪除');
  ok(Object.values((await t.store()).ctStudents).some(s => s.name === '卓泰合'), 'student kept');

  // 合併重複：先製造空殼
  await t.seed(() => { window.__store.ctStudents.shell = { name:'洪語喬', phones:['0978152732'], sourceClasses:[], teacherIds:[], classTeachers:{}, active:false, createdAt:1 }; });
  await goCt('🔗 配對');
  await page.click('text=🧹 合併重複'); await page.waitForTimeout(400);
  includes(await toast(), '已合併 1 組');
  ok(!(await t.store()).ctStudents.shell, 'shell removed');

  // 紀錄：旗標徽章 → 待處理 → 已處理
  await t.seed(() => { const S = window.__store; const id = Object.keys(S.ctStudents).find(k => S.ctStudents[k].name === '吳冠誼');
    S.contacts.k2 = { studentId:id, studentName:'吳冠誼', teacherId:'bhcst0010', teacherName:'巫', date:'2026-03-01', method:'phone', content:'舊紀錄 旗標', flag:true }; });
  await page.click('text=⚙️ 帳號管理'); await page.waitForTimeout(200);
  await page.click('text=📞 電訪管理'); await page.waitForTimeout(300);
  eq((await page.locator('#ctFlagBadge').textContent()).trim(), '🚩 1', 'badge');
  await page.click('#ctFlagBadge'); await page.waitForTimeout(400);
  ok(await page.isChecked('#ctRecFlagOnly'), 'badge → flag-only');
  eq(await page.locator('#ctRecCount').textContent(), '1 筆', 'old flagged record loaded even outside range');
  await page.click('#ctRecordsOut >> text=✓ 已處理'); await page.waitForTimeout(300);
  eq(await page.locator('#ctRecCount').textContent(), '0 筆', 'resolved');
  await page.uncheck('#ctRecFlagOnly'); await page.click('#ct-sec-records button:has-text("全部")'); await page.waitForTimeout(300);
  includes(await page.locator('#ctRecLoadedHint').textContent(), '已載入全部');
  eq(await page.locator('#ctRecCount').textContent(), '2 筆　10月份 1、2月份 1', 'all records grouped by period');

  // 以新表為準 + 快照還原
  await goCt('📥 匯入名冊');
  await page.fill('#ctImportTextClass', '國小-全科班-一年級');
  await page.fill('#ctImportTextArea', '吳冠誼 0986396505\n新同學 0955555555');
  await page.click('text=解析文字'); await page.waitForTimeout(200);
  await page.locator('#ctImportPreview select').selectOption('bhcst0010');
  await page.check('#ctImportReplace');
  await page.click('text=✅ 匯入勾選的學生'); await page.waitForTimeout(500);
  includes(await toast(), '移除班別 3');
  S = await t.store();
  eq(Object.values(S.ctStudents).find(s => s.name === '洪語喬').active, false, 'dropped student inactive');
  eq(Object.keys(S.ctSnapshots).length, 3, 'snapshots capped at 3');
  await goCt('📥 匯入名冊');
  await page.locator('#ctSnapshotList button').first().click(); await page.waitForTimeout(500);
  includes(await toast(), '已還原');
  S = await t.store();
  eq(Object.values(S.ctStudents).find(s => s.name === '洪語喬').active, true, 'restored');
  ok(!Object.values(S.ctStudents).some(s => s.name === '新同學'), 'new student without records removed');
  log('contacts-admin.test OK');
  await t.finish();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
