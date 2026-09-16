/**
 * bd-60106 (second defect) — the reflection COUNT told to the teacher must come
 * from NUM_REFLECTIVE_QUESTIONS.
 *
 * The debrief was cut from three reflective questions to one
 * (`bot/shared/config/coaching-debrief.config.js`: "One reflection question per
 * observation (was 3)"). That config file states it is "the single source of
 * the count — no other edit is needed". It was not: three consumers kept a
 * hardcoded 3, and all three are read by the teacher.
 *
 *   workers/stale-session.worker.js     "(0/3 reflections completed)" and
 *                                       "I just have 3 more questions for you!"
 *   whatsapp-bot.js                     `nextQuestionNumber > 3` gates the
 *                                       jump to the report
 *   coaching/report-generator.service.js
 *                                       "This report includes 1/3 reflective
 *                                       responses … Full insights require
 *                                       completing all reflection questions."
 *
 * So a teacher who answered the only question she was ever going to be asked
 * was told her report was a third of one, and a teacher nudged by the 2h
 * reminder was promised three more questions before a report that needed one.
 * This is what made the row-117 report read as a five-step flow stalling at
 * step 3 — the bot's own arithmetic said there were more steps to come.
 *
 * The fix is a single pure helper both the worker and the report copy read, so
 * the count cannot drift from the config again.
 */
const { NUM_REFLECTIVE_QUESTIONS } = require('../../bot/shared/config/coaching-debrief.config');
const {
  reflectionProgress,
} = require('../../bot/shared/services/coaching/reflection-progress');

const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('bd-60106 — reflectionProgress derives everything from the config', () => {
  it('reports the configured total, not 3', () => {
    expect(reflectionProgress(0).total).toBe(NUM_REFLECTIVE_QUESTIONS);
  });

  it('counts what is left against the configured total', () => {
    expect(reflectionProgress(0).remaining).toBe(NUM_REFLECTIVE_QUESTIONS);
    expect(reflectionProgress(NUM_REFLECTIVE_QUESTIONS).remaining).toBe(0);
  });

  it('a debrief with every question answered is NOT partial', () => {
    expect(reflectionProgress(NUM_REFLECTIVE_QUESTIONS).isPartial).toBe(false);
  });

  it('a debrief with nothing answered IS partial (when any question is asked at all)', () => {
    expect(reflectionProgress(0).isPartial).toBe(true);
  });

  it('never reports negative remaining, or partial, when answers exceed the total', () => {
    // The old `questionsAnswered < 3` let a session that had answered its one
    // question still be flagged partial. Over-answering must clamp, not wrap.
    const over = reflectionProgress(NUM_REFLECTIVE_QUESTIONS + 5);
    expect(over.remaining).toBe(0);
    expect(over.isPartial).toBe(false);
  });

  it('tolerates a missing/garbage count as zero answered', () => {
    for (const bad of [undefined, null, NaN, -3, 'two']) {
      expect(reflectionProgress(bad).answered).toBe(0);
    }
  });

  it('renders progress as answered/total for teacher-facing copy', () => {
    expect(reflectionProgress(0).label).toBe(`0/${NUM_REFLECTIVE_QUESTIONS}`);
  });
});

describe('bd-60106 — no consumer hardcodes the reflection total any more', () => {
  it('the stale-session worker reads the config instead of 3', () => {
    const src = read('bot/workers/stale-session.worker.js');
    expect(src).toMatch(/reflection-progress|NUM_REFLECTIVE_QUESTIONS/);
    expect(src).not.toMatch(/3 - questionsAnswered/);
    expect(src).not.toMatch(/questionsAnswered\}\/3/);
    expect(src).not.toMatch(/questionsAnswered < 3/);
  });

  it('the report generator does not tell her "N/3 reflective responses"', () => {
    const src = read('bot/shared/services/coaching/report-generator.service.js');
    expect(src).not.toMatch(/questionsCompleted\}\/3/);
  });

  it('the reminder-button paths do not gate the report on a hardcoded 3', () => {
    // Both taps on the 2h reminder have since been lifted out of whatsapp-bot
    // into their own services (continue-coaching / finish-early). Check the
    // router AND both services, so the literal cannot come back by being moved.
    for (const f of [
      'bot/whatsapp-bot.js',
      'bot/shared/services/coaching/finish-early.service.js',
      'bot/shared/services/coaching/continue-coaching.service.js',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/nextQuestionNumber > 3/);
      expect(src).not.toMatch(/questionsAnswered < 3/);
    }
  });
});
