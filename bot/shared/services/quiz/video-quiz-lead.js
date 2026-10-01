'use strict';
/**
 * The text a quiz message carries, and the LEAD that can ride on it.
 *
 * Pure: no network, no DB. Split out of video-quiz-sender.service.js so the
 * decision "can this line ride on the next question?" is made by the same code
 * that decides what the sender will actually put in the body — the counter, the
 * card's "tap A, B or C" cue — and so the quiz service can make that decision
 * without reaching into the sender, which is the network boundary.
 *
 * THE LEAD. Every message is billed (Meta, from 1 Oct 2026), and two lines used
 * to be a bubble of their own right before the next question: the verdict on the
 * answer just given ("✅ Correct! The answer is …"), and the session opener
 * ("Here we go — 8 questions", with the greeting before it). When the next
 * question's FIRST bubble opens with TEXT, the line rides at the top of that
 * bubble's body — the same words, in the same order, one send fewer. Same
 * contract as the counter: data on the message (`m.lead`), folded into the body
 * by the sender.
 *
 * ONLY when the bubble opens with text. A picture header (a question card, a
 * figure) is drawn ABOVE the body, so a verdict folded under it would be read
 * after the next question's picture — that is a product decision, not a fold,
 * and foldLead() refuses it. So does any merge past Meta's body cap: the caller
 * then sends the line on its own, exactly as before.
 */

const render = require('./video-quiz-render.service');
const { resolveUx } = require('../../config/ux-strings');

// Meta caps, in CODE POINTS: an interactive body, and a plain text message.
const INTERACTIVE_BODY_MAX = 1024;
const TEXT_BODY_MAX = 4096;

/** Picker chrome in the quiz language ('en' when the context carries none). */
const chrome = (key, ctx, params) => resolveUx(key, { language: ctx && ctx.language, params });

/**
 * Fold "Question n of N" into a body or caption that was going out anyway.
 *
 * `m.counter` is `{ i, n }` and is set by render.build() on exactly ONE message
 * per question — the first thing the child reads. Everything else is unchanged,
 * so a message with no counter renders exactly as it did before.
 */
function withCounter(m, body, ctx) {
  if (!m || !m.counter) return body;
  const line = chrome('vqQuestionOf', ctx, { i: m.counter.i, n: m.counter.n });
  return body ? `${line}\n\n${body}` : line;
}

/**
 * The body under a QUESTION CARD, naming exactly the letters THIS send offers.
 *
 * It was hardcoded to "A, B or C" whatever the card held, so a two-option card
 * told the child to tap a C that was never sent (round 5). `count` is what
 * the picker will actually emit — three for a button row, up to ten for a list.
 */
function cardAskBody(m, ctx, count) {
  const letters = render.letterListLabel(count, {
    separator: chrome('vqLetterSep', ctx),
    conjunction: chrome('vqLetterOr', ctx),
  });
  return chrome('vqCardAsk', ctx, { letters });
}

/** The text body the sender puts on a text-carrying message, counter included. */
function textBody(m, ctx) {
  if (m.kind === 'text') return withCounter(m, m.body, ctx);
  if (m.kind === 'buttons') {
    const shown = (m.options || []).slice(0, 3);
    return withCounter(m, m.letterTitles ? cardAskBody(m, ctx, shown.length) : m.body, ctx);
  }
  return withCounter(m,
    m.letterTitles ? cardAskBody(m, ctx, (m.options || []).length) : m.body, ctx);
}

/** `m.lead` above `body`, as its own paragraph; unchanged when there is none. */
function withLead(m, body) {
  if (!m || !m.lead) return body;
  return body ? `${m.lead}\n\n${body}` : m.lead;
}

/** The first message the child sees for a question (question phase, else the picker). */
function firstBubble(msgs) {
  const list = Array.isArray(msgs) ? msgs : [];
  return list.find((m) => m.phase === 'question') || list.find((m) => m.phase === 'interaction') || null;
}

/**
 * Does this message OPEN with text — nothing drawn above its body?
 * A plain text (the listen line), buttons with no image header, and a list
 * (Meta gives a list no image header at all). Never media, never a Flow.
 */
function opensWithText(m) {
  if (!m) return false;
  if (m.kind === 'text') return true;
  if (m.kind === 'buttons') return !m.headerImage;
  if (m.kind === 'list') return true;
  return false;
}

/**
 * Put `lead` at the top of the question's first bubble, if that bubble opens
 * with text and the merged body fits Meta's cap. Returns true when folded (the
 * sender will carry it); false when the caller must send the lead itself.
 */
function foldLead(msgs, lead, ctx = {}) {
  const line = String(lead == null ? '' : lead).trim();
  if (!line) return false;
  const m = firstBubble(msgs);
  if (!opensWithText(m)) return false;
  const cap = m.kind === 'text' ? TEXT_BODY_MAX : INTERACTIVE_BODY_MAX;
  const body = textBody(m, ctx);
  const merged = body ? `${line}\n\n${body}` : line;
  if ([...merged].length > cap) return false;
  m.lead = line;
  return true;
}

/**
 * Is `m` sent in `phase` for this answer? The ANSWER phase carries the correct
 * branch plus one branch per wrong option; only the branch matching what the
 * child actually picked is sent.
 */
function inPhase(m, phase, ctx = {}) {
  if (!m || m.phase !== phase) return false;
  if (phase === 'answer') {
    if (m.role === 'feedback_correct' && !ctx.isCorrect) return false;
    if (m.role === 'feedback_incorrect') {
      if (ctx.isCorrect) return false;
      if (m.optionIndex !== undefined && m.optionIndex !== ctx.selectedIndex) return false;
    }
  }
  return true;
}

/** Exactly the messages the sender's answer phase would send, in order. */
function answerBranch(msgs, ctx = {}) {
  return (Array.isArray(msgs) ? msgs : []).filter((m) => inPhase(m, 'answer', ctx));
}

module.exports = {
  withCounter, cardAskBody, textBody, withLead, firstBubble, opensWithText, foldLead,
  inPhase, answerBranch, INTERACTIVE_BODY_MAX, TEXT_BODY_MAX,
};
