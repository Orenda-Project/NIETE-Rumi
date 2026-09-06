'use strict';
/**
 * TQ-R5 lane G (bd-mg9c7.64) — the student tutor persona in the prompt
 * builder. A child who reaches the bot outside a quiz window (a forwarded
 * share link, an off-topic question) must be answered by a tutor persona,
 * never the teacher one — never called "teacher", never offered a teacher
 * feature (lesson plans, presentations, classroom-recording analysis,
 * reading assessment).
 *
 * Mocked at the network boundary (llm-client's getClient()), never at the
 * module under test: a mocked collaborator would hide the very seam this
 * suite exists to prove.
 */

const mockCreate = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } }),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getConversationHistory: jest.fn(async () => []),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const openaiService = require('../../bot/shared/services/openai.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { RELIGIOUS_REVERENCE_RULES } = require('../../bot/shared/config/religious-reverence-rules');

const ARABIC_RANGE = /[؀-ۿ]/;
const LATIN_LETTER = /[A-Za-z]/;

describe('1 — backwards compatibility: no 4th arg is untouched', () => {
  test('_getFormatAwareSystemPrompt(text, en, Ayesha) is still the teacher prompt', () => {
    const prompt = openaiService._getFormatAwareSystemPrompt('text', 'en', 'Ayesha');
    expect(prompt).toContain('NIETE Teaching Assistant');
    expect(prompt).toContain('CREATE lesson plans');
    expect(prompt).toContain('/reading test');
    expect(prompt).toContain(RELIGIOUS_REVERENCE_RULES);
  });
});

describe('2 — persona: student, en: no teacher markers', () => {
  // Scoped to the student-specific BASE prompt, not the fully assembled one:
  // the reverence block appended by _getFormatAwareSystemPrompt is fixed,
  // out-of-lane copy about Prophets and Companions that legitimately says
  // "a child, a teacher, or you" and "His decisions" (of the Prophet) — that
  // is a different "teacher"/"his" than the one this test guards against,
  // and root rule 3 requires that block to ride every conversational prompt
  // unchanged, student persona included (see describe block 4 below).
  const FORBIDDEN = [
    '/reading test',
    'lesson plan',
    'presentation',
    'classroom recording',
    'teacher',
    'Teaching Assistant',
  ];

  test('none of the forbidden substrings appear (case-insensitive)', () => {
    const body = openaiService._getStudentTutorPrompt('text', 'en', {});
    const lower = body.toLowerCase();
    for (const bad of FORBIDDEN) {
      expect(lower).not.toContain(bad.toLowerCase());
    }
  });

  test('carries a redirect line and a no-personal-data line', () => {
    const body = openaiService._getStudentTutorPrompt('text', 'en', {});
    expect(body).toMatch(/grown-up/i);
    expect(body).toMatch(/full name/i);
    expect(body).toMatch(/phone number/i);
  });

  test('never genders the student', () => {
    const body = openaiService._getStudentTutorPrompt('text', 'en', {});
    expect(body).not.toMatch(/\bhe\b/i);
    expect(body).not.toMatch(/\bshe\b/i);
    expect(body).not.toMatch(/\bhis\b/i);
    expect(body).not.toMatch(/\bher\b/i);
  });
});

describe('3 — persona: student, ur: Urdu body, no gendering, reverence still rides', () => {
  test('the student tutor body is majority Arabic-script', () => {
    const body = openaiService._getStudentTutorPrompt('text', 'ur', {});
    const chars = [...body];
    const arabicCount = chars.filter((c) => ARABIC_RANGE.test(c)).length;
    const latinCount = chars.filter((c) => LATIN_LETTER.test(c)).length;
    expect(arabicCount).toBeGreaterThan(20);
    expect(arabicCount).toBeGreaterThan(latinCount);
  });

  test('no gendered Urdu verb forms address the child', () => {
    const body = openaiService._getStudentTutorPrompt('text', 'ur', {});
    expect(body).not.toMatch(/(کرتی ہے|کرتا ہے|دیتی ہے|دیتا ہے|چاہتی ہے|چاہتا ہے|سکتی ہے|سکتا ہے)/);
  });

  test('the reverence block still rides the assembled ur student prompt', () => {
    const prompt = openaiService._getFormatAwareSystemPrompt('text', 'ur', null, { persona: 'student' });
    expect(prompt).toContain(RELIGIOUS_REVERENCE_RULES);
  });
});

describe('4 — the reverence block rides EVERY conversational prompt, student included', () => {
  test('en student prompt ends with the reverence block', () => {
    const prompt = openaiService._getFormatAwareSystemPrompt('voice', 'en', null, { persona: 'student' });
    expect(prompt.endsWith(RELIGIOUS_REVERENCE_RULES)).toBe(true);
  });
});

describe('5 — studentClass reaches the prompt; absence prints nothing broken', () => {
  test('studentClass is embedded when given', () => {
    const prompt = openaiService._getFormatAwareSystemPrompt('text', 'en', null, {
      persona: 'student',
      studentClass: 'Class 5',
    });
    expect(prompt).toContain('Class 5');
  });

  test('absent studentClass never prints "undefined" or "null"', () => {
    const prompt = openaiService._getFormatAwareSystemPrompt('text', 'en', null, { persona: 'student' });
    expect(prompt).not.toMatch(/undefined/);
    expect(prompt).not.toMatch(/\bnull\b/);
  });
});

describe('6 — getResponseWithFormat passes opts down to the network boundary', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
  });

  test('opts.persona === student sends the STUDENT prompt as messages[0]', async () => {
    await openaiService.getResponseWithFormat(
      'what is a fraction?', 'child-1', 'text', 'en', null, null, { persona: 'student' }
    );
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('the student');
    expect(call.messages[0].content).not.toContain('NIETE Teaching Assistant');
  });

  test('no opts sends the TEACHER prompt as messages[0]', async () => {
    await openaiService.getResponseWithFormat('hello', 'teacher-1', 'text', 'en');
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('NIETE Teaching Assistant');
  });
});

describe('7 — the error fallback is child-shaped for the student persona', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error('boom'));
  });

  test('student persona, en: returns resolveUx(studentChatError, en)', async () => {
    const reply = await openaiService.getResponseWithFormat(
      'hi', 'child-2', 'text', 'en', null, null, { persona: 'student' }
    );
    expect(reply).toBe(resolveUx('studentChatError', { language: 'en' }));
  });

  test('student persona, ur: returns resolveUx(studentChatError, ur)', async () => {
    const reply = await openaiService.getResponseWithFormat(
      'hi', 'child-3', 'text', 'ur', null, null, { persona: 'student' }
    );
    expect(reply).toBe(resolveUx('studentChatError', { language: 'ur' }));
  });

  test('no persona (teacher) keeps the existing hardcoded wording', async () => {
    const reply = await openaiService.getResponseWithFormat('hi', 'teacher-2', 'text', 'en');
    expect(reply).toBe('Sorry, I encountered an error processing your message. Please try again.');
  });
});

describe('8 — the two new ux-strings keys resolve in both offered languages', () => {
  test.each(['studentChatError', 'studentOffTopicHint'])('%s resolves non-empty in en and ur', (key) => {
    for (const lang of ['en', 'ur']) {
      const s = resolveUx(key, { language: lang });
      expect(typeof s).toBe('string');
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });
});
