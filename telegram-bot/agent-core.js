// Agent Core: wires Planner + Tools + Memory together and produces the reply
// text. No LLM in v1 — see planner.js for why. Kept deliberately dumb: every
// branch here maps directly to one of check-queues.js's already-implemented
// standing-policy behaviors: nothing about who-gets-approved is decided here.
const planner = require('./planner');
const tools = require('./tools');
const memory = require('./memory');
const records = require('./records');
const { localTime, describeGroupedRows } = require('./format');

const QUEUE_ORDER = ['pre_overtime', 'overtime', 'leave', 'abnormal'];
const QUEUE_LABEL = { pre_overtime: '預定加班單簽核', overtime: '加班單簽核', leave: '假單簽核', abnormal: '異常簽核' };

function buildFullReport(result) {
  if (result.error) {
    return `⚠ 檢查失敗：${result.error}${result.message ? '\n' + String(result.message).split('\n')[0] : ''}`;
  }
  const lines = [`檢查完成 ${localTime(result.timestamp)}`];
  for (const key of QUEUE_ORDER) {
    const q = result.queues[key] || {};
    const pending = q.pending || [];
    const approved = q.approved || [];
    const stillPending = q.stillPending !== undefined ? q.stillPending : (q.action === 'check_only' ? pending : []);
    if (pending.length === 0) {
      lines.push(`${QUEUE_LABEL[key]}：無待簽`);
      continue;
    }
    const parts = [];
    if (approved.length) parts.push(`已核准 ${approved.length} 筆：${describeGroupedRows(key, approved)}`);
    if (stillPending.length) parts.push(`待確認 ${stillPending.length} 筆：${describeGroupedRows(key, stillPending)}`);
    lines.push(`${QUEUE_LABEL[key]}：${parts.join('；')}`);
  }
  return lines.join('\n');
}

// For the scheduler: only worth pushing if something changed (approved rows,
// newly-seen pending rows, or a failure). Mutates `state.notified` in place.
function buildNotifyLines(result, state) {
  if (result.error) {
    return [`⚠ 排程檢查失敗：${result.error}${result.message ? ' — ' + String(result.message).split('\n')[0] : ''}`];
  }
  const out = [];
  for (const key of QUEUE_ORDER) {
    const q = result.queues[key] || {};
    const approved = q.approved || [];
    if (approved.length) {
      out.push(`已代簽 ${QUEUE_LABEL[key]} ${approved.length} 筆：${describeGroupedRows(key, approved)}`);
    }
    const stillPending = q.stillPending !== undefined ? q.stillPending : (q.action === 'check_only' ? (q.pending || []) : []);
    const fresh = stillPending.filter((r) => !state.notified.includes(memory.rowSignature(key, r)));
    if (fresh.length) {
      fresh.forEach((r) => state.notified.push(memory.rowSignature(key, r)));
      out.push(`待你確認 ${QUEUE_LABEL[key]} ${fresh.length} 筆：${describeGroupedRows(key, fresh)}`);
    }
  }
  return out;
}

async function handleMessage(text) {
  const intent = planner.parse(text);
  const state = memory.load();

  switch (intent.intent) {
    case 'help':
      return planner.HELP_TEXT;

    case 'status': {
      if (!state.lastCheck) return '目前還沒有任何檢查紀錄。傳「檢查」立即執行一次。';
      return buildFullReport(state.lastCheck);
    }

    case 'keepalive': {
      const status = await tools.keepAlive();
      return `Session 保活結果：${status}`;
    }

    case 'check': {
      const result = await tools.checkQueues();
      state.lastCheck = result;
      memory.save(state);
      return buildFullReport(result);
    }

    case 'approve_all': {
      const result = await tools.approveAll();
      state.lastCheck = result;
      memory.save(state);
      return buildFullReport(result);
    }

    case 'query':
      return records.query(intent.range);

    case 'approve': {
      if (intent.names.length === 0) return '請指定要核准的姓名，例如「核准 王小明」。';
      const extraEnv = {};
      if (intent.scope === 'overtime' || intent.scope === 'both') {
        extraEnv.EXTRA_APPROVE_NAMES = intent.names.join(',');
      }
      if (intent.scope === 'leave' || intent.scope === 'both') {
        extraEnv.EXTRA_APPROVE_LEAVE_NAMES = intent.names.join(',');
      }
      const result = await tools.checkQueues(extraEnv);
      state.lastCheck = result;
      memory.save(state);
      return buildFullReport(result);
    }

    default:
      return `看不懂這個指令。\n\n${planner.HELP_TEXT}`;
  }
}

module.exports = { handleMessage, buildFullReport, buildNotifyLines };
