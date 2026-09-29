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
// Read at call time, not load time: the E2E mock server sets PHONE_NUMBER_ID after this module
// is required, and the webhook's cross-WABA guard drops any payload whose id does not match.
const phoneNumberId = () => process.env.PHONE_NUMBER_ID || 'simulator-phone-id';

// The bot de-duplicates on message id in-process. Two messages built in the same millisecond
// (M04 sends /menu twice back to back) used to share `sim_<ms>` and the second was dropped.
let _seq = 0;
const nextId = () => `sim_${Date.now()}_${++_seq}`;

/** Wrap one message object in a full Cloud API webhook envelope. */
function wrapInWebhook(message, options = {}) {
  const from = options.from || SIMULATOR_PHONE;
  const name = options.name || SIMULATOR_NAME;
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
                phone_number_id: phoneNumberId(),
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
                  id: nextId(),
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  ...message,
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
 * Create a WhatsApp webhook payload from a text message.
 */
function simulateMessage(text, options = {}) {
  return wrapInWebhook({ type: 'text', text: { body: text } }, options);
}

/** A tap on a reply button — what Meta sends when the teacher presses one. */
function buttonReply(id, title, options = {}) {
  return wrapInWebhook({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } }, options);
}

/** A pick from an interactive list — the handler routes on the row ID. */
function listReply(id, title, options = {}) {
  return wrapInWebhook({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } }, options);
}

/**
 * The message Meta sends when a Flow COMPLETES: an interactive nfm_reply whose `name` is
 * `flow_<flowId>` (the handler strips the prefix) and whose `response_json` is a STRING —
 * the completion payload (navigate Flows: the complete action's payload; endpoint Flows: the
 * endpoint's extension_message_response.params).
 */
function flowReply(flowId, responseJson, options = {}) {
  const body = typeof responseJson === 'string' ? responseJson : JSON.stringify(responseJson || {});
  return wrapInWebhook({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: `flow_${flowId}`, body: 'Sent', response_json: body } } }, options);
}

/**
 * A media message the teacher sent — `kind` is document | image | audio | video, `mediaId` is the id
 * the (mock) Graph API will serve the bytes under. Carries exactly the fields the handlers read:
 * document → id, mime_type, filename, file_size · image → id, mime_type, caption · audio → id,
 * mime_type, voice (a WhatsApp voice note).
 */
function mediaMessage(kind, mediaId, meta = {}, options = {}) {
  const base = { id: mediaId, mime_type: meta.mime || 'application/octet-stream' };
  let media;
  switch (kind) {
    case 'document': media = { ...base, filename: meta.filename || 'file', file_size: meta.size || 0 }; break;
    case 'image': media = { ...base, ...(meta.caption ? { caption: meta.caption } : {}), sha256: meta.sha256 || 'mock' }; break;
    case 'audio': media = { ...base, voice: meta.voice !== false }; break;
    case 'video': media = { ...base, ...(meta.caption ? { caption: meta.caption } : {}) }; break;
    default: throw new Error('mediaMessage: unknown kind ' + kind);
  }
  return wrapInWebhook({ type: kind, [kind]: media }, options);
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
      console.log(`(routing to the bot at http://localhost:${port}/webhook — start it first with \`node bot/whatsapp-bot.js\`)`);
      // The webhook only accepts messages whose phone_number_id matches the bot's PHONE_NUMBER_ID.
      // Without it set, the bot's cross-account guard silently drops the simulated message — warn upfront.
      if (!process.env.PHONE_NUMBER_ID) {
        console.log(`⚠️  PHONE_NUMBER_ID is not set, so the bot will skip the simulated message`
          + ` (it can't match the account). Set PHONE_NUMBER_ID in .env to see a real round-trip.`);
      }
      console.log('');

      let closed = false;
      rl.on('close', () => { closed = true; });
      const promptIfOpen = () => { if (!closed) rl.prompt(); };

      rl.prompt();
      rl.on('line', async (line) => {
        const text = line.trim();
        if (!text) { promptIfOpen(); return; }
        if (isQuitCommand(text)) {
          console.log('\nGoodbye!');
          closed = true;
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
        promptIfOpen();
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
  buttonReply,
  listReply,
  mediaMessage,
  flowReply,
  wrapInWebhook,
  isQuitCommand,
  postToWebhook,
  createSimulator,
};
