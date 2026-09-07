// Entry point. Wires Telegram Adapter + Agent Core + Scheduler and runs
// forever (long-polling Telegram, ticking the scheduler in the background).
require('../playwright/env.js'); // sets LD_LIBRARY_PATH for the playwright tools this bot shells out to
const fs = require('fs');
const path = require('path');
const { TelegramAdapter } = require('./telegram-adapter');
const agentCore = require('./agent-core');
const scheduler = require('./scheduler');

function loadEnvFile(filePath) {
  const env = {};
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // no .env yet — fall through, the missing-token check below will explain
  }
  return env;
}

const env = { ...loadEnvFile(path.join(__dirname, '.env')), ...process.env };

if (!env.TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN missing — copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!env.TELEGRAM_CHAT_ID) {
  console.error('TELEGRAM_CHAT_ID missing — this bot only responds to one authorized chat. Fill it in .env.');
  process.exit(1);
}

const adapter = new TelegramAdapter({ token: env.TELEGRAM_BOT_TOKEN, allowedChatId: env.TELEGRAM_CHAT_ID });

async function main() {
  console.log('Telegram attendance agent starting. Authorized chat:', env.TELEGRAM_CHAT_ID);
  scheduler.start(adapter);

  for (;;) {
    try {
      await adapter.poll(async (text, chatId) => {
        console.log(`[recv] ${text}`);
        const reply = await agentCore.handleMessage(text);
        await adapter.sendMessage(chatId, reply, agentCore.KEYBOARD_MARKUP);
      });
    } catch (e) {
      console.error('poll loop error:', e);
      await new Promise((r) => setTimeout(r, 5000)); // brief backoff before retrying
    }
  }
}

main();
