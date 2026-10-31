// 極簡斷言：失敗就丟錯誤，讓測試檔以非 0 結束
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assert'}: expected ${e}, got ${a}`);
}
function ok(v, msg) { if (!v) throw new Error(`${msg || 'assert'}: expected truthy, got ${JSON.stringify(v)}`); }
function includes(str, sub, msg) { if (!String(str).includes(sub)) throw new Error(`${msg || 'assert'}: "${sub}" not in "${String(str).slice(0, 120)}"`); }
module.exports = { eq, ok, includes };
