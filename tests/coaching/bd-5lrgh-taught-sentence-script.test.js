/**
 * bd-5lrgh follow-up — the lesson-mismatch "what was taught" sentence stays in the
 * report's language.
 *
 * Sandbox re-analysis of the DC-row-142 session (d7196d60, 1 Oct): an ENGLISH report's
 * Section B line read "…comprehension about traffic and transport; آپ نے پڑھایا: فونکس سے لفظ
 * بدلنا…" — the model, reading an Urdu transcript, appended its own Urdu translation to the
 * English sentence it was asked for. The sibling domain_whys lines on the same report were
 * clean: they carry an explicit language-purity rule; the new field did not.
 *
 * Two halves, because a model told something complies most of the time: the prompt carries
 * the purity rule, and code keeps only the report's script for an LTR report. An RTL (Urdu)
 * report is left alone — English pedagogy terms inside Urdu prose are the house style.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { buildPrompt, generateReportNarrative, taughtSentenceInReportScript } =
  require('../../bot/shared/services/coaching/report-v2/narrative.service');

const SANDBOX_MIXED = 'You taught reading and grammar: phonics word changes, sentence-building activities, and comprehension about traffic and transport; آپ نے پڑھایا: فونکس سے لفظ بدلنا، جملے بنانے کی سرگرمیاں، اور ٹریفک/ٹرانسپورٹ پر سمجھ بوجھ۔';
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function mismatchAnalysis() {
  return {
    framework: 'fico',
    scores: { overall_percentage: 55 },
    domains: {
      lesson_plan_fidelity: { assessed: true, fidelity_derived: true, fidelity_pct: 0, domain_score: 0, domain_max: 14, indicators: [] },
      high_leverage_practices: { domain_score: 6, domain_max: 8, indicators: [] },
      student_engagement: { domain_score: 7, domain_max: 10, indicators: [] },
      teacher_subject_knowledge: { domain_score: 11, domain_max: 12, indicators: [] },
    },
    lp_fidelity: { status: 'ok', fidelity_pct: 0, moderators: { note: 'lesson_mismatch' }, moves: [] },
  };
}

describe('taughtSentenceInReportScript', () => {
  test('en: an appended Urdu translation is cut, the English sentence kept and closed', () => {
    const out = taughtSentenceInReportScript(SANDBOX_MIXED, 'en');
    expect(out).toBe('You taught reading and grammar: phonics word changes, sentence-building activities, and comprehension about traffic and transport.');
    expect(ARABIC_SCRIPT.test(out)).toBe(false);
  });

  test('en: a clean English sentence is unchanged', () => {
    const s = 'You taught a reading lesson on sentence order and syllables.';
    expect(taughtSentenceInReportScript(s, 'en')).toBe(s);
  });

  test('en: a sentence that is ALL Urdu leaves nothing to show → empty', () => {
    expect(taughtSentenceInReportScript('آپ نے پڑھایا: فونکس سے لفظ بدلنا۔', 'en')).toBe('');
  });

  test('ur: Urdu prose with English terms is left exactly as written', () => {
    const s = 'آپ نے phonics اور sentence-building پڑھایا۔';
    expect(taughtSentenceInReportScript(s, 'ur')).toBe(s);
  });

  test('non-strings pass through as empty', () => {
    expect(taughtSentenceInReportScript(null, 'en')).toBe('');
    expect(taughtSentenceInReportScript(undefined, 'ur')).toBe('');
  });
});

describe('the prompt carries the purity rule for this field', () => {
  test('a mismatch prompt forbids a translation or second-language version of the sentence', () => {
    const p = buildPrompt(mismatchAnalysis(), { transcript: '[00:05] x', language: 'en', teacherName: 'T' });
    expect(p).toMatch(/lesson_mismatch_taught:[^\n]*ONLY in English/);
    expect(p).toMatch(/lesson_mismatch_taught:[^\n]*never add a translation/i);
  });
});

describe('generateReportNarrative applies it to what the model returned', () => {
  beforeEach(() => mockOpenAI.chat.completions.create.mockReset());
  const reply = (taught) => ({ choices: [{ message: { content: JSON.stringify({
    topic: 'reading & grammar', affirmation: 'a', identity: 'b', moments: [],
    domain_whys: { high_leverage_practices: 'x' }, lesson_mismatch_taught: taught,
  }) } }] });

  test('en report: the stored sentence carries no Urdu script', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(SANDBOX_MIXED));
    const n = await generateReportNarrative(mismatchAnalysis(), { language: 'en', transcript: 'x' });
    expect(n.lesson_mismatch_taught).toMatch(/^You taught reading and grammar/);
    expect(ARABIC_SCRIPT.test(n.lesson_mismatch_taught)).toBe(false);
  });

  test('en report: an all-Urdu sentence is dropped rather than shown', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply('آپ نے پڑھایا۔'));
    const n = await generateReportNarrative(mismatchAnalysis(), { language: 'en', transcript: 'x' });
    expect(n.lesson_mismatch_taught).toBeUndefined();
  });
});
