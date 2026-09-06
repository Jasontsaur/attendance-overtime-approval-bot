// Thin wrappers around the existing playwright/ scripts. All standing-policy
// logic (whitelist auto-approve, leave/abnormal check-only, CSV audit log)
// lives in check-queues.js already — these wrappers don't reimplement any of
// it, they just invoke it and parse its RESULT_JSON line.
const { execFile } = require('child_process');
const path = require('path');

const PLAYWRIGHT_DIR = path.join(__dirname, '..', 'playwright');

function runNode(scriptName, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptName],
      { cwd: PLAYWRIGHT_DIR, env: { ...process.env, ...extraEnv }, timeout: 120000 },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

function parseResultJson(stdout) {
  const marker = 'RESULT_JSON:';
  const line = stdout.split('\n').find((l) => l.includes(marker));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  } catch {
    return null;
  }
}

// Runs check-queues.js, and on SESSION_EXPIRED/FATAL, auto-logs-in and
// retries once — same recovery pattern as scheduled-check.sh.
async function checkQueues(extraEnv = {}) {
  let { stdout } = await runNode('check-queues.js', extraEnv);
  let result = parseResultJson(stdout);

  const needsRelogin = !result || (result.error && /SESSION_EXPIRED|FATAL/.test(result.error));
  if (needsRelogin) {
    const login = await runNode('auto-login.js');
    if (login.code !== 0) {
      return { error: 'LOGIN_FAILED', message: login.stdout + login.stderr };
    }
    ({ stdout } = await runNode('check-queues.js', extraEnv));
    result = parseResultJson(stdout);
  }

  return result || { error: 'PARSE_FAILED', message: stdout.slice(-2000) };
}

// Approves every pending row in 加班單/假單簽核 for this run, regardless of
// whitelist (see check-queues.js's APPROVE_ALL). 異常簽核 is never touched —
// it has no approval path at all, by design.
async function approveAll() {
  return checkQueues({ APPROVE_ALL: '1' });
}

async function keepAlive() {
  const { stdout } = await runNode('keep-alive.js');
  return stdout.includes('ALIVE') ? 'ALIVE' : stdout.includes('EXPIRED') ? 'EXPIRED' : 'UNKNOWN';
}

module.exports = { checkQueues, approveAll, keepAlive };
