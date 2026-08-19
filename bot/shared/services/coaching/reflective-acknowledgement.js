/**
 * FEAT-106 #4a (bd-2374) — reflective answer acknowledgement.
 *
 * After the teacher's single reflective answer, the flow jumped to a generic
 * "Thank you for your thoughtful reflections 🙏" with nothing that reflected
 * back what she said — it read as if the bot ignored her (Hareem, Irum; ICT).
 *
 * This builds a short warm line that names what she said. Generation is injected
 * (the caller passes a `generator(prompt) => text`), so this module is pure and
 * unit-testable; the caller falls back to the generic thanks whenever this
 * returns null (empty answer, LLM failure, blank output).
 */

const { voiceLanguageRules } = require('../../config/voice-language-rules');

/**
 * @param {string} answer    the teacher's reflective answer
 * @param {string} question  the question she was answering (for context)
 * @param {string} langName  target language name (English/Urdu/…)
 * @param {string} languageCode  ISO code ('ur','en',…) — selects voice-safe rules (bd-2651)
 * @returns {string} system prompt
 */
function buildAcknowledgementPrompt(answer, question, langName = 'English', languageCode = 'en') {
  // bd-2651: this line is spoken aloud (closing voice note), so it must obey the
  // same voice rules as every other TTS surface — Urdu in Nastaliq with pure
  // Urdu (not Hindi) vocabulary and English terms in Latin; English kept pure.
  const voiceRules = voiceLanguageRules(languageCode);
  return `The teacher just finished a short reflective coaching conversation.

The reflective question we asked her:
"${question}"

Her answer:
"${answer}"

Respond like a thoughtful coach who was genuinely listening — NOT an echo. Write ONE or TWO warm sentences in ${langName} that:
1. Name the specific thing SHE realised or decided (so she feels heard), then
2. Affirm WHY that matters for her students' learning — a genuine, specific coaching insight that adds a little to what she said.
So instead of just repeating "you said you'd pause more", say why that pause is what gives quieter students room to think.
Rules:
- Do NOT simply repeat / echo her words back with nothing added — the insight in point 2 is the whole point.
- Do NOT ask a new question. Do NOT give advice, a to-do, or a next step.
- Gender-neutral — never gendered second-person verb forms; we do not know her gender.
- Plain language; keep any pedagogical/technical terms in English (Latin letters) inline.
- Max ~35 words. Warm, specific, human. End on an affirming statement that leaves her with the value of what she noticed.
${voiceRules}
Return ONLY the sentence(s) — no quotes, no preamble.`;
}

/**
 * @param {string} answer
 * @param {string} question
 * @param {string} languageCode
 * @param {{generator: (prompt:string)=>Promise<string>, langName?: string}} deps
 * @returns {Promise<string|null>}  the line, or null to fall back to generic thanks
 */
async function generateAcknowledgement(answer, question, languageCode, deps = {}) {
  const { generator, langName } = deps;
  if (typeof generator !== 'function') return null;
  if (!answer || typeof answer !== 'string' || answer.trim().length < 2) return null;
  try {
    const prompt = buildAcknowledgementPrompt(answer, question || '', langName || 'English', languageCode);
    const raw = await generator(prompt);
    const line = String(raw || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
    return line.length ? line : null;
  } catch (_e) {
    return null;
  }
}

module.exports = { buildAcknowledgementPrompt, generateAcknowledgement };
