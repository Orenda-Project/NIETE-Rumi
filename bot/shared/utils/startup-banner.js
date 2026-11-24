'use strict';
/**
 * Boot banner for the bot server (bd-04od7).
 *
 * Console output is shipped to Axiom on every tier, so this banner must never
 * carry a secret: secrets are reported only as set / NOT SET, never the value,
 * a prefix or a masked form.
 */

const RULE = '='.repeat(70);

function buildStartupMessage({ version, port, logsDir, env = process.env, date = new Date() }) {
  const verifyState = env.WEBHOOK_VERIFY_TOKEN
    ? 'set (WEBHOOK_VERIFY_TOKEN in your .env)'
    : 'NOT SET (add WEBHOOK_VERIFY_TOKEN to your .env)';
  const ngrokHint = env.NGROK_AUTHTOKEN
    ? '(NGROK_AUTHTOKEN is set; run `npx ngrok config add-authtoken` once if ngrok asks)'
    : '(first time? add your own token from https://dashboard.ngrok.com → set NGROK_AUTHTOKEN in .env)';

  return `\n${RULE}
🤖 Rumi v${version}
${RULE}

✅ Server running on port ${port}
📍 Local URL: http://localhost:${port}
🔗 Health Check: http://localhost:${port}/health

📝 LOGGING ENABLED
   All webhook activity is logged to: ${logsDir}
   Log file: bot-${date.toISOString().split('T')[0]}.log

${RULE}
📋 NEXT STEP: Start ngrok in a NEW terminal window
${RULE}

   Run this command in a new terminal:

   npx ngrok http ${port}
   ${ngrokHint}

${RULE}

Then copy the ngrok URL and configure it in Meta:
   1. Go to: https://developers.facebook.com/apps/
   2. Navigate to: WhatsApp → Configuration → Webhook
   3. Paste ngrok URL with /webhook (e.g., https://abc.ngrok-free.app/webhook)
   4. Verify Token: ${verifyState}
   5. Subscribe to: messages
   6. Send a test message to your WhatsApp bot number

${RULE}
\n`;
}

module.exports = { buildStartupMessage };
