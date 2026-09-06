// Rule-based intent parser — no LLM in v1 (see project decision, 2026-09-06).
// Recognizes a small fixed set of Chinese command patterns. Anything else
// falls through to 'unknown' with the help text.
const HELP_TEXT = [
  '可用指令：',
  '• 檢查 — 立即檢查並依標準政策簽核三個佇列',
  '• 核准 姓名[,姓名2...] — 核准指定的人（假單/加班單皆會嘗試，只有真的待簽且比對到姓名才會生效）',
  '• 核准加班 姓名 — 只嘗試核准加班單',
  '• 核准假單 姓名 — 只嘗試核准假單',
  '• 全部核准 — 忽略白名單，核准加班單/假單/異常簽核目前所有待簽項目',
  '• 狀態 — 顯示最近一次檢查結果（不會重新連線）',
  '• 保活 — 手動觸發一次 session 保活 ping',
  '• 查詢本週 / 查詢本月 — 從本機紀錄查詢簽核紀錄',
].join('\n');

function splitNames(s) {
  return s.split(/[,，、\s]+/).map((n) => n.trim()).filter(Boolean);
}

function parse(text) {
  const t = (text || '').trim();

  if (/^\/(start|help)$/i.test(t) || /^(help|幫助|說明)$/.test(t)) {
    return { intent: 'help' };
  }
  if (/^(檢查|check)(差勤)?$/i.test(t)) {
    return { intent: 'check' };
  }
  if (/^(狀態|status|現狀)$/i.test(t)) {
    return { intent: 'status' };
  }
  if (/^(保活|keep ?alive|ping)$/i.test(t)) {
    return { intent: 'keepalive' };
  }
  if (/^(全部核准|核准全部|approve ?all)$/i.test(t)) {
    return { intent: 'approve_all' };
  }
  if (/^(查詢)?本週(紀錄|記錄)?$/.test(t)) {
    return { intent: 'query', range: 'week' };
  }
  if (/^(查詢)?本月(紀錄|記錄)?$/.test(t)) {
    return { intent: 'query', range: 'month' };
  }

  let m = t.match(/^核准加班\s*(.+)$/) || t.match(/^核加班\s*(.+)$/);
  if (m) return { intent: 'approve', scope: 'overtime', names: splitNames(m[1]) };

  m = t.match(/^核准假單\s*(.+)$/) || t.match(/^核假\s*(.+)$/) || t.match(/^核准請假\s*(.+)$/);
  if (m) return { intent: 'approve', scope: 'leave', names: splitNames(m[1]) };

  m = t.match(/^(?:核准|核)\s*(.+)$/);
  if (m) return { intent: 'approve', scope: 'both', names: splitNames(m[1]) };

  return { intent: 'unknown' };
}

module.exports = { parse, HELP_TEXT };
