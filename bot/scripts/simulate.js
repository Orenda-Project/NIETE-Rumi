/**
 * CLI Simulator for Local Testing
 *
 * Simulates WhatsApp message flow without needing an actual WhatsApp connection.
 * Creates properly-structured webhook payloads from text input.
 *
 * Interactive mode: node bot/scripts/simulate.js
 * Programmatic: const { simulateMessage } = require('./simulate');
 */

const readline = require('readline');

const SIMULATOR_PHONE = '15550001234';
const SIMULATOR_NAME = 'Simulator User';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'simulator-phone-id';

/**
 * Create a WhatsApp webhook payload from a text message.
 */
function simulateMessage(text, options = {}) {
  const from = options.from || SIMULATOR_PHONE;
  const name = options.name || SIMULATOR_NAME;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'simulator-entry',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: process.env.PHONE_NUMBER || '+1 555 0100',
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name },
                  wa_id: from,
                },
              ],
              messages: [
                {
                  from,
                  id: `sim_${Date.now()}`,
                  timestamp,
                  text: { body: text },
                  type: 'text',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/**
 * Check if a message is a quit command.
 */
function isQuitCommand(text) {
  const cmd = text.trim().toLowerCase();
  return cmd === '/quit' || cmd === '/exit';
}

/**
 * POST a simulated payload to the locally-running bot's /webhook, so the message
 * actually flows through the real handler (instead of being printed and discarded).
 * The bot must be running (`node bot/whatsapp-bot.js`); its reply is sent via the
 * configured WhatsApp/dev sink and shows in the bot's console logs.
 * @returns {Promise<{ok:boolean, status?:number, error?:string}>}
 */
async function postToWebhook(payload, options = {}) {
  const port = options.port || process.env.PORT || 3000;
  const baseUrl = options.baseUrl || `http://localhost:${port}`;
  const fetchFn = options.fetch || globalThis.fetch;
  try {
    const res = await fetchFn(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Create an interactive simulator (for CLI use).
 */
function createSimulator(options = {}) {
  const rl = readline.createInterface({
    input: options.input || process.stdin,
    output: options.output || process.stdout,
    prompt: 'You: ',
  });

  return {
    rl,
    start() {
      console.log(`
╭─────────────────────────────────────────────╮
│  Rumi Local Simulator                       │
│  Type messages as if you were on WhatsApp   │
│  Type /quit to exit                         │
╰─────────────────────────────────────────────╯
`);
      const port = options.port || process.env.PORT || 3000;
      console.log(`(routing to the bot at http://localhost:${port}/webhook — start it first with \`node bot/whatsapp-bot.js\`)\n`);
      rl.prompt();
      rl.on('line', async (line) => {
        const text = line.trim();
        if (!text) {
          rl.prompt();
          return;
        }
        if (isQuitCommand(text)) {
          console.log('\nGoodbye!');
          rl.close();
          return;
        }
        const payload = simulateMessage(text);
        const result = await postToWebhook(payload, { port });
        if (result.ok) {
          console.log(`→ delivered to /webhook (HTTP ${result.status}). The bot's reply is sent`
            + ` via your configured WhatsApp/dev sink and appears in the bot's console logs.\n`);
        } else if (result.error) {
          console.log(`✗ could not reach the bot (${result.error}).`
            + ` Start it in another terminal: \`node bot/whatsapp-bot.js\`\n`);
        } else {
          console.log(`✗ /webhook returned HTTP ${result.status}.\n`);
        }
        rl.prompt();
      });
    },
  };
}

// Interactive mode when run directly
if (require.main === module) {
  const sim = createSimulator();
  sim.start();
}

module.exports = {
  simulateMessage,
  isQuitCommand,
  postToWebhook,
  createSimulator,
};
