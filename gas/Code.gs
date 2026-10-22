/**
 * 百宏文教 · 教室日誌與電訪表（bhcs-system）
 * 每晚 22:00 檢查：
 *   1. 當天有排課但沒填日誌的班級
 *   2. 本月電訪未填（每位老師 × 配對學生）
 *   3. 停課、抽查任務逾期
 * 結果推播到 LINE。
 * ────────────────────────────────────────────────────────────
 * 授權方式：本腳本綁定 Firebase 專案 bhcs-system 的 GCP 專案，
 * 以執行者（專案擁有者）的 Google 帳號呼叫 Firestore REST；
 * IAM 權限不受 firestore.rules 限制，所以規則鎖住也讀得到。
 * 不再需要 FIREBASE_KEY。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   LINE_TOKEN   : LINE Messaging API 的 Channel access token (long-lived)
 *   LINE_TARGET  : 推播對象 ID（userId 或 groupId，用 doPost 取得）
 * ────────────────────────────────────────────────────────────
 */

var PROJECT_ID = 'bhcs-system';
var APP_URL    = 'https://yenyu-bot.github.io/bhcs-system/';
var TZ         = 'Asia/Taipei';
var WEEKDAYS   = ['一','二','三','四','五','六','日'];   // index 0 = 週一

// 電訪未填：每天都報各老師的「已填/應填」數；
// 下列星期幾、以及每月最後 CT_DETAIL_LAST_DAYS 天，才列出未填學生姓名
var CT_DETAIL_WEEKDAYS  = ['一','四'];
var CT_DETAIL_LAST_DAYS = 5;

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('缺少指令碼屬性：' + k);
  return v;
}

// ── Firestore REST helpers ────────────────────────────────────
function fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
}
function fsFetch_(url, opt) {
  opt = opt || {};
  opt.headers = opt.headers || {};
  opt.headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();
  opt.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, opt);
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

/** 讀取整個 collection，回傳 [{_id, ...fields}] */
function fsList_(collectionName) {
  var out = [], pageToken = '';
  do {
    var body = fsFetch_(fsBase_() + '/' + collectionName + '?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : ''));
    (body.documents || []).forEach(function (d) {
      var o = decodeFields_(d.fields || {});
      o._id = d.name.split('/').pop();
      out.push(o);
    });
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** structured query：單一欄位條件（op: EQUAL / GREATER_THAN_OR_EQUAL …）或多條件 AND */
function fsQuery_(collectionId, filters, limit) {
  var fieldFilters = filters.map(function (f) {
    return { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: { stringValue: f.value } } };
  });
  var where = fieldFilters.length === 1 ? fieldFilters[0]
            : { compositeFilter: { op: 'AND', filters: fieldFilters } };
  var body = fsFetch_(
    'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:runQuery',
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: collectionId }], where: where, limit: limit || 2000 } }) }
  );
  return (body || []).filter(function (r) { return r.document; })
    .map(function (r) { var o = decodeFields_(r.document.fields || {}); o._id = r.document.name.split('/').pop(); return o; });
}
function fsEntriesByDate_(mmdd) {
  return fsQuery_('entries', [{ field: 'date', op: 'EQUAL', value: mmdd }], 500);
}
function fsContactsBetween_(from, to) {
  return fsQuery_('contacts', [
    { field: 'date', op: 'GREATER_THAN_OR_EQUAL', value: from },
    { field: 'date', op: 'LESS_THAN_OR_EQUAL',    value: to }
  ], 5000);
}

/** Firestore 的 typed value 轉成一般 JS 值 */
function decodeFields_(fields) {
  var o = {};
  Object.keys(fields).forEach(function (k) { o[k] = decodeValue_(fields[k]); });
  return o;
}
function decodeValue_(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue    !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue   !== undefined) return (v.arrayValue.values || []).map(decodeValue_);
  if (v.mapValue     !== undefined) return decodeFields_(v.mapValue.fields || {});
  return null;
}

// ── LINE push ────────────────────────────────────────────────
function linePush_(text) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') },
    payload: JSON.stringify({
      to: prop_('LINE_TARGET'),
      messages: [{ type: 'text', text: text.slice(0, 4900) }]
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('LINE 推播失敗 (' + res.getResponseCode() + ')：' + res.getContentText());
  }
}

// ── 主流程：每晚 22:00 由觸發器呼叫 ──────────────────────────
function dailyCheck() {
  var now     = new Date();
  var mmdd    = Utilities.formatDate(now, TZ, 'MM/dd');
  var iso     = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var jsDay   = Number(Utilities.formatDate(now, TZ, 'u'));  // 1=Mon ... 7=Sun
  var weekday = WEEKDAYS[jsDay - 1];

  var teachers = fsList_('teachers');
  var nameOf = {};
  teachers.forEach(function (t) { nameOf[t.userId] = t.name; });

  var classes = [];
  try {
    classes = fsList_('classes').filter(function (c) { return !c.archived; });
  } catch (e) { Logger.log('讀取 classes 失敗：' + e.message); }

  var resolved = resolveScheduleSet_(iso, classes);
  var schedMap = resolved.classDays;

  var closures = [];
  try { closures = fsList_('closures'); } catch (e) { Logger.log('讀取 closures 失敗：' + e.message); }
  function closureFor(classId) {
    for (var i = 0; i < closures.length; i++) {
      var c = closures[i];
      if (c.status === 'rejected' || !c.date) continue;
      if (!(c.date <= iso && iso <= (c.dateEnd || c.date))) continue;
      if (c.scope === 'all') return c;
      if ((c.classIds || []).indexOf(classId) >= 0) return c;
    }
    return null;
  }

  var allScheduled = classes.filter(function (c) {
    return (schedMap[c._id] || []).indexOf(weekday) >= 0;
  });
  var closedToday = [], scheduled = [];
  allScheduled.forEach(function (c) {
    var cl = closureFor(c._id);
    if (cl) closedToday.push({ c: c, cl: cl }); else scheduled.push(c);
  });

  var lines = ['📚 百宏文教 · 每日檢查',
               iso + '（週' + weekday + '） 22:00',
               '課表：' + resolved.name, ''];

  // 1. 教室日誌
  if (!scheduled.length) {
    lines.push(closedToday.length
      ? '今天排課的班級全部停課，日誌無需填寫。'
      : '今天沒有班級排課，日誌無需填寫。');
  } else {
    var todayEntries = fsEntriesByDate_(mmdd);
    var classFiled = {};
    todayEntries.forEach(function (e) { if (e.classId) classFiled[e.classId] = true; });

    var missing = scheduled.filter(function (c) { return !classFiled[c._id]; });
    var filed   = scheduled.filter(function (c) { return  classFiled[c._id]; });

    if (missing.length) {
      lines.push('⚠️ 尚未填寫日誌（' + missing.length + '/' + scheduled.length + ' 個班級）');
      missing.forEach(function (c) {
        var who = [nameOf[c.teacherId] || c.teacherId];
        (c.members || []).forEach(function (m) { who.push(m.teacherName); });
        lines.push('　❌ ' + c.name + '（' + who.join('、') + '）');
      });
    } else {
      lines.push('✅ 今日排課的 ' + scheduled.length + ' 個班級都已完成日誌。');
    }
    if (filed.length && missing.length) {
      lines.push('');
      lines.push('已完成：' + filed.map(function (c) { return c.name; }).join('、'));
    }
  }

  // 2. 電訪未填
  try {
    var ct = contactSummary_(iso, weekday, nameOf);
    if (ct) { lines.push(''); lines.push(ct); }
  } catch (e) {
    Logger.log('電訪檢查略過：' + e.message);
    lines.push(''); lines.push('📞 電訪檢查失敗：' + e.message.slice(0, 120));
  }

  // 3. 停課
  if (closedToday.length) {
    lines.push('');
    lines.push('🚫 今日停課（' + closedToday.length + ' 班）');
    closedToday.forEach(function (x) {
      lines.push('　· ' + x.c.name + '（' + (x.cl.reason || '停課') +
                 (x.cl.status === 'pending' ? ' · 待確認' : '') + '）');
    });
  }
  var pending = closures.filter(function (c) { return c.status === 'pending'; });
  if (pending.length) {
    lines.push('');
    lines.push('⏳ 有 ' + pending.length + ' 筆停課申請待確認');
  }

  // 4. 抽查任務逾期
  try {
    var overdue = taskOverdueSummary_(iso, teachers);
    if (overdue) { lines.push(''); lines.push(overdue); }
  } catch (e) {
    Logger.log('任務檢查略過：' + e.message);
  }

  lines.push('');
  lines.push('🔗 ' + APP_URL);

  var msg = lines.join('\n');
  Logger.log(msg);
  linePush_(msg);
}

/**
 * 電訪：本月（1 日～今天）每個「老師 × 學生」配對至少要有一筆紀錄。
 * 每天報各老師的完成數；指定星期幾與月底最後幾天列出未填學生姓名。
 */
function contactSummary_(iso, weekday, nameOf) {
  var from = iso.slice(0, 8) + '01';
  var students = fsList_('ctStudents').filter(function (s) { return s.active !== false; });
  if (!students.length) return '';

  var contacts = fsContactsBetween_(from, iso);
  var done = {};
  contacts.forEach(function (c) { done[c.teacherId + '|' + c.studentId] = true; });

  var byT = {};
  students.forEach(function (s) {
    (s.teacherIds || []).forEach(function (tid) {
      var b = byT[tid] || (byT[tid] = { total: 0, missing: [] });
      b.total++;
      if (!done[tid + '|' + s._id]) b.missing.push(s.name);
    });
  });
  var tids = Object.keys(byT);
  if (!tids.length) return '';

  var lastDay = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
  var dayNum  = Number(iso.slice(8, 10));
  var detail  = CT_DETAIL_WEEKDAYS.indexOf(weekday) >= 0 || (lastDay - dayNum) < CT_DETAIL_LAST_DAYS;

  var totalAll = 0, missAll = 0;
  tids.forEach(function (t) { totalAll += byT[t].total; missAll += byT[t].missing.length; });

  var out = ['📞 本月電訪進度（' + from.slice(5) + '～' + iso.slice(5) + '）　' +
             (totalAll - missAll) + '/' + totalAll + '（' + Math.round((totalAll - missAll) / totalAll * 100) + '%）'];
  tids.sort(function (a, b) { return byT[b].missing.length - byT[a].missing.length; });
  tids.forEach(function (t) {
    var b = byT[t], n = nameOf[t] || t;
    if (!b.missing.length) { out.push('　✅ ' + n + '　' + b.total + '/' + b.total); return; }
    out.push('　' + (dayNum >= lastDay - CT_DETAIL_LAST_DAYS + 1 ? '❌' : '⚠️') + ' ' + n + '　' +
             (b.total - b.missing.length) + '/' + b.total + '　未填 ' + b.missing.length);
    if (detail) out.push('　　' + b.missing.join('、'));
  });
  if (!detail) out.push('　（週' + CT_DETAIL_WEEKDAYS.join('、') + '與月底會列出未填學生）');
  return out.join('\n');
}

/**
 * 挑出指定日期適用的課表。
 * 規則與前端一致：手動指定優先 → 日期區間涵蓋該日者（多份取開始日最晚的）
 *                → 常態課表（沒設起訖日的那份）→ 舊版 schedule collection
 */
function effectiveClassDays_(set, classes) {
  if (set && set.classDays) return set.classDays;
  var out = {};
  var days = (set && set.days) || {};
  classes.forEach(function (c) {
    var d = days[c.teacherId] || [];
    if (d.length) out[c._id] = d;
  });
  return out;
}

function resolveScheduleSet_(iso, classes) {
  var sets = [];
  try { sets = fsList_('scheduleSets'); } catch (e) { Logger.log('讀取 scheduleSets 失敗：' + e.message); }

  if (sets.length) {
    var cfg = null;
    try {
      var cfgs = fsList_('scheduleConfig');
      for (var i = 0; i < cfgs.length; i++) { if (cfgs[i]._id === 'current') cfg = cfgs[i]; }
    } catch (e) { /* 沒有設定就走自動 */ }

    if (cfg && cfg.mode === 'manual' && cfg.activeSetId) {
      for (var j = 0; j < sets.length; j++) {
        if (sets[j]._id === cfg.activeSetId) {
          return { name: sets[j].name + '（手動指定）', classDays: effectiveClassDays_(sets[j], classes) };
        }
      }
    }

    var dated = sets.filter(function (x) {
      if (!x.startDate && !x.endDate) return false;
      return (!x.startDate || x.startDate <= iso) && (!x.endDate || iso <= x.endDate);
    }).sort(function (a, b) {
      return String(b.startDate || '').localeCompare(String(a.startDate || ''));
    });
    if (dated.length) return { name: dated[0].name, classDays: effectiveClassDays_(dated[0], classes) };

    for (var k = 0; k < sets.length; k++) {
      if (!sets[k].startDate && !sets[k].endDate) {
        return { name: sets[k].name, classDays: effectiveClassDays_(sets[k], classes) };
      }
    }
  }

  var legacy = {};
  try {
    fsList_('schedule').forEach(function (d) { legacy[d._id] = d.days || []; });
  } catch (e) { Logger.log('讀取 schedule 失敗：' + e.message); }
  return { name: '常態課表', classDays: effectiveClassDays_({ days: legacy }, classes) };
}

/** 檢查已逾期且仍有人未繳的抽查任務 */
function taskOverdueSummary_(iso, teachers) {
  var tasks = fsList_('tasks').filter(function (t) {
    return t.status !== 'closed' && t.dueDate && t.dueDate < iso;
  });
  if (!tasks.length) return '';

  var subs = fsList_('taskSubs');
  var nameOf = {};
  teachers.forEach(function (t) { nameOf[t.userId] = t.name; });

  var out = ['📸 抽查任務逾期未繳'];
  tasks.forEach(function (task) {
    var target = (task.targets && task.targets.length)
      ? task.targets
      : ((task.assignees && task.assignees.length)
          ? task.assignees
          : teachers.map(function (t) { return t.userId; })
        ).map(function (id) {
          return { classId: '', className: '', teacherId: id, teacherName: nameOf[id] || id };
        });

    var done = {};
    subs.forEach(function (s) {
      if (s.taskId !== task._id) return;
      done[s.classId ? s.classId : 'T:' + s.teacherId] = true;
    });

    var miss = target.filter(function (x) {
      return !done[x.classId ? x.classId : 'T:' + x.teacherId];
    });
    if (miss.length) {
      out.push('　「' + task.title + '」（截止 ' + task.dueDate + '）未繳 ' + miss.length + ' 個班級：');
      out.push('　　' + miss.map(function (x) {
        var n = x.teacherName || nameOf[x.teacherId] || x.teacherId;
        return x.className ? (n + '·' + x.className) : n;
      }).join('、'));
    }
  });
  return out.length > 1 ? out.join('\n') : '';
}

// ── 一鍵安裝／移除觸發器 ─────────────────────────────────────
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('dailyCheck')
    .timeBased()
    .atHour(22)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
  Logger.log('✅ 已安裝每日 22:00 觸發器（Asia/Taipei）');
}
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t);
  });
}

/** 只測 Firestore 連線（不推 LINE）：第一次執行會跳授權視窗 */
function testFirestore() {
  var t = fsList_('teachers');
  Logger.log('✅ 讀到 ' + t.length + ' 位老師：' + t.map(function (x) { return x.name; }).join('、'));
  var s = fsList_('ctStudents');
  Logger.log('✅ 電訪名冊 ' + s.length + ' 位學生');
}

/** 手動測試：不用等到十點，直接跑一次（會推 LINE） */
function testRun() { dailyCheck(); }

// ── Webhook：用來取得 LINE_TARGET（userId / groupId）─────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (ev) {
      if (ev.type !== 'message' || !ev.replyToken) return;
      var src = ev.source || {};
      var id  = src.groupId || src.roomId || src.userId || '(取不到 ID)';
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') },
        payload: JSON.stringify({
          replyToken: ev.replyToken,
          messages: [{ type: 'text', text: '請把這串填入 LINE_TARGET：\n' + id }]
        }),
        muteHttpExceptions: true
      });
    });
  } catch (err) {
    Logger.log(err);
  }
  return ContentService.createTextOutput('OK');
}
