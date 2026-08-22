/**
 * P0 (2026-08-22) — religious reverence rules ride EVERY conversational
 * prompt (TDD, red first).
 *
 * Live incident on the Covenant-of-Madina lesson: the assistant suggested
 * asking children "if YOU were the Prophet ﷺ, what would you have included
 * in the Misaq?" — impersonation of the Prophet AND an invitation to revise
 * a decision that is final for believers (Quran 33:36). The teacher: "we
 * cannot even think it; we are not worthy of it." Scholarly consensus
 * (Islamic Fiqh Council 2010; Al-Azhar 1999; Dar al-Iftaa Jordan for the
 * Mothers of the Believers) prohibits portraying these figures.
 *
 * The guard must be structural: one module, injected into every prompt
 * branch (all languages, all formats) and into the LP-Q&A activity framing —
 * the exact surface that produced the incident.
 */

/* eslint-disable global-require */

jest.mock('../../shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getConversationHistory: jest.fn(async () => []),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { RELIGIOUS_REVERENCE_RULES } = require('../../shared/config/religious-reverence-rules');
const OpenAIService = require('../../shared/services/openai.service');

describe('the rules themselves', () => {
  test('impersonation of the Prophet, prophets, Companions, wives is banned — including the exact incident shape', () => {
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/NEVER suggest .*role-play/is);
    expect(RELIGIOUS_REVERENCE_RULES).toContain('"if you were the Prophet…"');
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/Mothers of the Believers/);
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/first-person voice/);
  });

  test('the finality rule — never invite revision of what he ﷺ decided', () => {
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/NEVER invite anyone to change/i);
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/33:36/);
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/wisdom IN them/);
  });

  test('honorifics mapped per figure, gender-correct', () => {
    expect(RELIGIOUS_REVERENCE_RULES).toContain('ﷺ');
    expect(RELIGIOUS_REVERENCE_RULES).toContain('عليه السلام');
    expect(RELIGIOUS_REVERENCE_RULES).toContain('رضي الله عنه');
    expect(RELIGIOUS_REVERENCE_RULES).toContain('رضي الله عنها');
    expect(RELIGIOUS_REVERENCE_RULES).toContain('رضي الله عنهم');
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/never guess gender/i);
  });

  test('reverent alternatives are offered, not just prohibitions', () => {
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/narrators, never characters/i);
    expect(RELIGIOUS_REVERENCE_RULES).toMatch(/what does this teach/i);
  });
});

describe('every conversational prompt branch carries the rules', () => {
  test.each([
    ['voice', 'ur'],   // the incident surface
    ['text', 'ur'],
    ['voice', 'en'],
    ['text', 'en'],
  ])('%s / %s', (format, language) => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt(format, language, 'Syeda');
    expect(prompt).toContain('RELIGIOUS REVERENCE');
    expect(prompt).toContain('"if you were the Prophet…"');
  });
});

describe('the LP-Q&A activity framing carries the guard (the incident surface)', () => {
  const NO_MEASUREMENT_RX = /scor|fidelit|assess|measur|grade(d|s)? (on|against)/i;

  beforeAll(() => {
    jest.doMock('../../shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../shared/services/lp-shelf.service', () => ({
      getShelf: jest.fn(async () => [{
        lesson_id: 'grade_2_islamiyat_ch4_seg1', grade: 2, subject: 'islamiyat',
        subject_label: 'Islamiyat', chapter_number: 4, chapter_title: 'میثاقِ مدینہ',
        topic: 'میثاقِ مدینہ', pages_label: 'p. 20',
        r2_key: 'lp-cache/v8/grade_2_islamiyat_ch4_seg1/abcd1234.pdf',
        content_hash: 'abcd1234', version_stamp: 'v8', voicenote_sent: true,
        lesson_plan_id: 'lp-1', delivered_at: new Date().toISOString(),
      }]),
    }));
    jest.doMock('../../shared/services/lp-voicenote-script.service', () => ({
      getVoicenoteScript: jest.fn(async () => null),
    }));
    jest.doMock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({
      resolveMoveList: jest.fn(async () => null),
    }));
    jest.doMock('../../shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn(() => null) }));
    jest.resetModules();
  });

  test('fullBlock instructs reverent activity shapes, never impersonation — and still no measurement talk', async () => {
    const { buildLpContext } = require('../../shared/services/lp-context.service');
    const ctx = await buildLpContext('user-1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).toMatch(/never role-play or impersonation/i);
    expect(ctx.fullBlock).toMatch(/revising their decisions|their position/i);
    expect(ctx.fullBlock).not.toMatch(NO_MEASUREMENT_RX);
  });
});
