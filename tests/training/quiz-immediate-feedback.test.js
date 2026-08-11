/**
 * bd-2523 — a training quiz must tell the teacher, per question, whether the
 * answer was right or wrong.
 *
 * Reported by a NIETE teacher reviewer (Primary TT, P1): "it doesn't show
 * whether the option we selected is correct or incorrect. When I complete 4/4
 * questions then at the end it shows 2/4 options are incorrect making it
 * difficult to track progress."
 *
 * The maddening part was that the answer was ALREADY graded at the moment of
 * the tap — `handleQuizButton` computes `isCorrect`, writes it to
 * training_assessment_answers, advances the cursor, and then calls
 * sendQuestion for the next one. The verdict existed and was thrown away
 * without ever being shown. This is the one-line-per-answer acknowledgement
 * that closes that gap.
 *
 * Scope note: WHY an option was wrong is a separate, larger piece of work
 * (bd-2524 — the source question bank has per-option explanations for ~43% of
 * questions that were never migrated). This test pins the tick/cross only, and
 * is deliberately written so that adding the explanation later extends the
 * message rather than restructuring it.
 *
 * These are source-level assertions, matching the house pattern in
 * tests/portal/portal-ui-contracts.test.js. The delivery service reaches
 * Supabase and the WhatsApp API on every path through handleQuizButton, and
 * the existing behavioural tests for it stand up a full chain mock; for "is a
 * verdict sent before the next question", the ordering in the source IS the
 * contract, and it is exactly what a later edit would silently undo.
 *
 * What this canNOT tell you: how the two messages look arriving back-to-back
 * on a real handset. That wants a human on the PR.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SERVICE = 'bot/shared/services/training/quiz-delivery.service.js';

const raw = fs.readFileSync(path.join(ROOT, SERVICE), 'utf8');

// Assert on real code, never on the prose that explains it — the comments in
// this service discuss ticks and crosses at length.
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The single-answer grading tail: from the isCorrect computation to the end. */
function singleAnswerTail() {
  const start = code.indexOf('const isCorrect = String(q.correct_option)');
  expect(start).toBeGreaterThan(-1);
  const after = code.slice(start);
  const end = after.indexOf('\n}');
  return end === -1 ? after : after.slice(0, end);
}

describe('bd-2523 — the teacher is told, per question, if the answer was right', () => {
  it('a verdict is sent on the single-answer path', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/WhatsAppService\.sendMessage\(/);
  });

  it('the verdict is sent BEFORE the next question, not after', () => {
    const tail = singleAnswerTail();
    const verdictAt = tail.indexOf('WhatsAppService.sendMessage(');
    const nextQAt = tail.indexOf('sendQuestion(');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(nextQAt).toBeGreaterThan(-1);
    // Arriving after the next question would attach the feedback to the wrong
    // one — the teacher reads it as a verdict on the question now on screen.
    expect(verdictAt).toBeLessThan(nextQAt);
  });

  it('it branches on the grade that was already computed', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/isCorrect\s*\?/);
  });

  it('both outcomes carry a mark the eye can catch', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/✅|✓/);
    expect(tail).toMatch(/❌|✗/);
  });

  // bd-2525 — copy review. "❌ Not quite" was doing two contradictory things:
  // ❌ is the loudest mark in the set (reads as failure) while "not quite"
  // hedges (implies a near miss, which is often untrue). A teacher needs to
  // know plainly that the answer was wrong. The thin ✗ says so without the
  // red-block shout, and matches the ✓ family typographically.
  it('the wrong-answer copy is plain, not a hedge', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/Not correct/);
    expect(tail).not.toMatch(/Not quite/);
  });

  it('the heavy ❌ stays out of the prose', () => {
    const tail = singleAnswerTail();
    // ❌ still fires as the REACTION (a single glyph on the teacher's own
    // bubble, where an unambiguous mark is exactly right) — just not in the
    // sentence, four times a quiz. So scope this to the sendMessage argument
    // specifically; the sendReaction ternary above it SHOULD contain ❌.
    const sent = tail.match(/sendMessage\(\s*[\s\S]*?\)/);
    expect(sent).not.toBeNull();
    expect(sent[0]).toMatch(/Not correct/);
    expect(sent[0]).not.toMatch(/❌/);
  });
});

describe('bd-2525 — the answer tap itself is marked ✅/❌', () => {
  it('a reaction is sent from the single-answer path', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/sendReaction\(/);
  });

  it('it reacts to the teacher\'s own message, not to ours', () => {
    // The inbound wamid is the only id we hold: sendInteractiveMessage
    // returns a bare boolean, so the question we sent has no id to react to.
    // Reacting to their tap is also better placed — it lands at the bottom of
    // the thread where their eye already is.
    expect(code).toMatch(/handleQuizButton\(userId,\s*replyId,\s*phoneNumber,\s*messageId/);
    const tail = singleAnswerTail();
    expect(tail).toMatch(/sendReaction\(\s*phoneNumber,\s*messageId/);
  });

  it('the reaction is optional — no messageId, no crash', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/if\s*\(\s*messageId\s*\)/);
  });

  it('a failed reaction cannot strand the quiz', () => {
    const tail = singleAnswerTail();
    const reactAt = tail.indexOf('sendReaction(');
    const tryAt = tail.lastIndexOf('try {', reactAt);
    expect(tryAt).toBeGreaterThan(-1);
    expect(tryAt).toBeLessThan(reactAt);
  });

  it('BOTH bot call sites pass the inbound message id through', () => {
    const bot = fs.readFileSync(path.join(ROOT, 'bot/whatsapp-bot.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const calls = bot.match(/handleQuizButton\([^)]*\)/g) || [];
    // Quiz options ship as an interactive LIST, so the list path is the one
    // teachers actually take — wiring only the button path would have left
    // the reaction dead in practice while looking done in review.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call).toMatch(/message\.id/);
    }
  });

  it('the answer is still recorded before anything is sent', () => {
    const tail = singleAnswerTail();
    const recordAt = tail.indexOf('recordAnswer(');
    const sendAt = tail.indexOf('WhatsAppService.sendMessage(');
    expect(recordAt).toBeGreaterThan(-1);
    // A send that beat the write would lose the answer if delivery threw.
    expect(recordAt).toBeLessThan(sendAt);
  });

  it('a delivery failure cannot strand the quiz mid-attempt', () => {
    const tail = singleAnswerTail();
    // The verdict is a courtesy; the quiz must advance regardless of whether
    // that one message got through.
    expect(tail).toMatch(/try\s*\{[\s\S]*sendMessage\([\s\S]*\}\s*catch/);
  });
});
