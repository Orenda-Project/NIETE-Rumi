'use strict';
/**
 * bd-oak77.13 — Meta Conversational Components: the ONE config.
 *
 * These are the chips a teacher sees the moment she opens a brand-new chat
 * with the NIETE number, before she has typed anything. Meta calls them
 * `prompts` (everyone else says "ice breakers"); the same manifest carries the
 * `/`-command list and the `enable_welcome_message` switch.
 *
 * Set on the WABA with `bot/scripts/set-conversational-components.js`, which
 * reads THIS file. Nothing else may hold a second copy — the bug this file
 * exists to prevent is the one the fork already shipped: the prompt strings
 * lived in `scripts/deployment/register-commands-meta.js` and the matcher that
 * answers a tap lived inline in `text-message.handler.js`, so editing one
 * silently broke the other (a tapped chip fell through to the LLM router).
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROMPTS ARE BILINGUAL IN ONE STRING
 *
 * Meta does NOT localise prompts. There is exactly one prompt list per phone
 * number and every teacher sees it, whatever her `preferred_language` — and at
 * a first open we have no language for her anyway (no row, no Flow, no message).
 * So each chip carries both languages, English first because that is what the
 * Latin-script chip renders left-to-right, Urdu after a middle dot. The cap is
 * 80 characters per prompt and at most 4 prompts; both are asserted below at
 * require() time rather than discovered by a 400 from Graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LEGACY STRINGS ARE STILL HERE
 *
 * The four English-only chips below under LEGACY_PROMPTS are what is set on the
 * staging number today. WhatsApp caches the chip list on the handset, so a
 * teacher who opened the chat before the manifest changed can still tap an old
 * one. They keep resolving to the same actions until they are provably gone.
 */

/** Prompt strings, in the order Meta renders them. Max 4, max 80 chars each. */
const PROMPTS = [
  'Lesson plan · سبق کا منصوبہ',
  'AI coaching · اے آئی کوچنگ',
  'Teacher training · اساتذہ کی تربیت',
  'Show menu · سب کچھ دیکھیں',
];

/** Superseded English-only chips — still answered, never re-published. */
const LEGACY_PROMPTS = [
  'Show Menu - See all features I can help with',
  'Plan Lesson - Create PDF lesson plans instantly',
  'Create Video - Make animated educational videos',
  'Get Coaching - Classroom audio feedback & tips',
];

/**
 * Slash commands. Unchanged from what the staging number already carries plus
 * the two doors this deployment has had live for months (`/portal`, `/language`).
 */
const COMMANDS = [
  { command_name: 'menu', command_description: 'See everything I can help you with' },
  { command_name: 'register', command_description: 'Set up your account in 30 seconds' },
  { command_name: 'training', command_description: 'Start or continue your teacher training' },
  { command_name: 'portal', command_description: 'View all your lesson plans & reports online' },
  { command_name: 'language', command_description: 'Change your preferred language' },
];

/** Meta posts a `type:"request_welcome"` webhook on a first open when this is true. */
const ENABLE_WELCOME_MESSAGE = true;

/**
 * A tapped chip arrives as an ordinary inbound TEXT whose body is the prompt
 * verbatim. Keys here are the normalized form (see `normalizePrompt`).
 */
const PROMPT_ACTIONS = {
  [normalizePrompt(PROMPTS[0])]: 'lesson_plan',
  [normalizePrompt(PROMPTS[1])]: 'ai_coaching',
  [normalizePrompt(PROMPTS[2])]: 'training',
  [normalizePrompt(PROMPTS[3])]: 'menu',
  [normalizePrompt(LEGACY_PROMPTS[0])]: 'menu',
  [normalizePrompt(LEGACY_PROMPTS[1])]: 'lesson_plan',
  [normalizePrompt(LEGACY_PROMPTS[2])]: 'video',
  [normalizePrompt(LEGACY_PROMPTS[3])]: 'ai_coaching',
};

/**
 * Trim + lowercase, which is what the fork's inline matcher already did.
 * Urdu is caseless so `toLowerCase()` is a no-op on it; the English half is
 * what actually needs the fold (WhatsApp sends the chip verbatim, but a teacher
 * re-typing it will not match the capitalisation).
 * @param {string} s
 * @returns {string}
 */
function normalizePrompt(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * @param {string} messageBody
 * @returns {string|null} action key, or null when this text is not a chip
 */
function promptAction(messageBody) {
  return PROMPT_ACTIONS[normalizePrompt(messageBody)] || null;
}

// ── contract assertions, at require() time ───────────────────────────────────
// Rule 24(c): a limit the API enforces is asserted in code before the call, not
// learned from a 400 during a production rollout.
const MAX_PROMPTS = 4;
const MAX_PROMPT_CHARS = 80;
if (PROMPTS.length > MAX_PROMPTS) {
  throw new Error(`conversational-components: ${PROMPTS.length} prompts, Meta allows ${MAX_PROMPTS}`);
}
for (const p of PROMPTS) {
  // Code points, not UTF-16 units and not bytes — the same measure the language
  // protocol uses for every other WhatsApp field cap in this repo.
  const cp = [...p].length;
  if (cp > MAX_PROMPT_CHARS) {
    throw new Error(`conversational-components: prompt "${p}" is ${cp} chars, cap ${MAX_PROMPT_CHARS}`);
  }
  if (!PROMPT_ACTIONS[normalizePrompt(p)]) {
    throw new Error(`conversational-components: prompt "${p}" has no action`);
  }
}

module.exports = {
  PROMPTS,
  LEGACY_PROMPTS,
  COMMANDS,
  ENABLE_WELCOME_MESSAGE,
  PROMPT_ACTIONS,
  MAX_PROMPTS,
  MAX_PROMPT_CHARS,
  normalizePrompt,
  promptAction,
};
