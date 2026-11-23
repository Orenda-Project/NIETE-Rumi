'use strict';
/**
 * Does this message want a data answer? Asked only for people on the data_analyst_whatsapp switch,
 * because there is no data mode any more (21 Nov: people forget how to leave a mode, and the line
 * telling them to send Menu scrolls out of sight).
 *
 * Two steps. First the bot's own words, slash commands, greetings, yes/no, bare numbers and
 * anything under three words are NORMAL without a model call: they are how a teacher or coach drives
 * the ordinary bot. Then a small model reads the message (and the last data answer, when there is one
 * from the last few minutes, so "and by sector?" reads as the follow-up it is) and answers one word.
 * Anything it does not answer cleanly, and any failure, is NORMAL: the ordinary bot answers, as it
 * always did, and nobody is stuck in data.
 */

const VERDICTS = ['data', 'normal', 'unsure'];
const DEFAULT_MODEL = 'claude-haiku-4-5';

const BOT_WORDS = new Set([
  'menu', 'main menu', 'help', 'start', 'stop', 'back', 'cancel', 'settings', 'status', 'feedback', 'language',
  'english', 'urdu', 'lesson plan', 'lesson plans', 'lp', 'plan', 'observe', 'observation', 'training', 'quiz',
  'video', 'videos', 'coaching', 'reading', 'attendance', 'exam', 'homework', 'register', 'registration', 'portal',
  'app', 'hi', 'hello', 'hey', 'salam', 'salaam', 'aoa', 'assalam o alaikum', 'assalamualaikum', 'assalam alaikum',
  'yes', 'no', 'ok', 'okay', 'thanks', 'thank you', 'shukriya', 'jazakallah', 'done', 'next', 'skip', 'data',
]);

/** @param {{allowShort?: boolean}} [opts] allowShort: a data answer is recent, so "by sector?" may be its follow-up */
function isClearlyNormal(text, { allowShort = false } = {}) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.?،۔]+$/u, '').trim();
  if (!t) return true;
  if (t.startsWith('/')) return true;
  if (BOT_WORDS.has(t)) return true;
  if (/^\d+$/.test(t)) return true;
  return !allowShort && t.split(/\s+/).length < 3;
}

const SYSTEM = [
  'You route messages that an education administrator sends to a WhatsApp teaching assistant for ICT (Islamabad) schools.',
  'Answer with exactly one word.',
  'DATA: the message asks for figures, counts, shares, rates, trends, comparisons, rankings or lists about teachers,',
  'schools, sectors, coaches, coaching visits, observations, FICO scores, lesson plans, quizzes, training, attendance',
  'or use of the assistant — or it follows up on the data answer shown, e.g. "and by sector?".',
  'NORMAL: the message asks the assistant to do something (make a lesson plan, start an observation, a quiz, training),',
  'is a greeting, small talk, a teaching question, or anything else.',
  'UNSURE: it could reasonably be either.',
].join(' ');

/**
 * @param {string} text
 * @param {{client?: object, model?: string, recentAnswer?: string}} [opts]
 * @returns {Promise<'data'|'normal'|'unsure'>}
 */
async function classify(text, { client, model = DEFAULT_MODEL, recentAnswer = '' } = {}) {
  if (isClearlyNormal(text, { allowShort: Boolean(recentAnswer) })) return 'normal';
  try {
    const c = client || require('../llm-client').getAnthropicDirectClient();
    const shown = recentAnswer ? `The last data answer in this chat, a few minutes ago:\n${String(recentAnswer).slice(0, 600)}\n\n` : '';
    const resp = await c.messages.create({
      model,
      max_tokens: 5,
      system: SYSTEM,
      messages: [{ role: 'user', content: `${shown}The new message:\n${String(text).slice(0, 1000)}` }],
    });
    const word = ((resp.content || []).find((b) => b && b.type === 'text') || {}).text || '';
    const v = word.trim().toLowerCase().replace(/[^a-z]/g, '');
    return VERDICTS.includes(v) ? v : 'normal';
  } catch (_) {
    return 'normal';
  }
}

module.exports = { isClearlyNormal, classify, VERDICTS, DEFAULT_MODEL };
