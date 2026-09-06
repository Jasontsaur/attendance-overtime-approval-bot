// Tiny JSON-file-backed state store. No LLM/vector memory here — just enough
// to (a) remember the last check result so a bare "狀態" query or a "核准 X"
// command can act on it without re-running the browser, and (b) avoid
// re-notifying the user about the same still-pending row on every scheduled
// check.
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'state.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastCheck: null, notified: [] };
  }
}

function save(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Stable signature for a pending row — used to dedupe notifications and to
// let "approve by name" find the right row later.
function rowSignature(queueKey, row) {
  return `${queueKey}|${row.id}|${(row.detail || []).join('')}`;
}

module.exports = { load, save, rowSignature };
