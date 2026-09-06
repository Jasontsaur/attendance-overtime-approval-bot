// Internal scheduler — replaces the Windows Task Scheduler job. This process
// stays running (see README for how it's kept alive), so a simple 60s tick
// comparing wall-clock time is enough; no cron library needed.
const tools = require('./tools');
const memory = require('./memory');
const agentCore = require('./agent-core');

const LOCAL_TZ = 'Asia/Taipei';
const CHECK_TIMES = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
const KEEPALIVE_TIMES = ['22:30', '00:30', '02:30', '04:30'];

function nowHM() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit' });
}

function start(adapter) {
  let lastFiredMinute = null;

  setInterval(async () => {
    const hm = nowHM();
    if (hm === lastFiredMinute) return; // already handled this minute
    lastFiredMinute = hm;

    if (CHECK_TIMES.includes(hm)) {
      console.log(`[scheduler] running scheduled check @ ${hm}`);
      const state = memory.load();
      const result = await tools.checkQueues();
      state.lastCheck = result;
      const lines = agentCore.buildNotifyLines(result, state);
      memory.save(state);
      if (lines.length) {
        await adapter.notify(lines.join('\n'));
      }
    } else if (KEEPALIVE_TIMES.includes(hm)) {
      console.log(`[scheduler] running overnight keep-alive @ ${hm}`);
      const status = await tools.keepAlive();
      // Don't push to Telegram overnight even on EXPIRED — matches the
      // original keep-alive.js policy of not disturbing the user at night.
      // The next scheduled check (06:00) will attempt real session recovery
      // and report normally if something's wrong.
      console.log(`[scheduler] keep-alive result: ${status}`);
    }
  }, 60 * 1000);
}

module.exports = { start };
