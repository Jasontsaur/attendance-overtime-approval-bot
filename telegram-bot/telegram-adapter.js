// Minimal Telegram Bot API client — long-polling only (no public URL/webhook
// needed), built on the global fetch already available in Node 18+. No
// external dependency on purpose, to keep this bot's install footprint at
// zero (`npm install` not required).
class TelegramAdapter {
  constructor({ token, allowedChatId }) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
    this.base = `https://api.telegram.org/bot${token}`;
    this.allowedChatId = String(allowedChatId || '');
    this.offset = 0;
  }

  async sendMessage(chatId, text, replyMarkup) {
    const body = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`${this.base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('sendMessage failed:', res.status, await res.text().catch(() => ''));
    }
  }

  // Sends to the one authorized chat — used for proactive/scheduled pushes.
  async notify(text, replyMarkup) {
    if (!this.allowedChatId) return;
    await this.sendMessage(this.allowedChatId, text, replyMarkup);
  }

  // Long-polls for updates and invokes onMessage(text, chatId) for each
  // message from the authorized chat. Messages from any other chat are
  // acknowledged (so they don't get redelivered) but otherwise ignored and
  // logged — this bot performs real HR/payroll actions and must not take
  // commands from anyone else.
  async poll(onMessage, { timeoutSec = 30 } = {}) {
    const url = `${this.base}/getUpdates?timeout=${timeoutSec}&offset=${this.offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('getUpdates failed:', res.status);
      return;
    }
    const data = await res.json();
    for (const update of data.result || []) {
      this.offset = update.update_id + 1;
      const msg = update.message;
      if (!msg || !msg.text) continue;
      const chatId = String(msg.chat.id);
      if (this.allowedChatId && chatId !== this.allowedChatId) {
        console.log(`ignored message from unauthorized chat ${chatId}`);
        continue;
      }
      try {
        await onMessage(msg.text, chatId);
      } catch (e) {
        console.error('onMessage handler error:', e);
      }
    }
  }
}

module.exports = { TelegramAdapter };
