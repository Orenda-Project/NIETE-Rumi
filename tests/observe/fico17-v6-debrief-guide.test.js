'use strict';
/**
 * bd-ra8xu.40 — the coach's debrief guide for a FICO17 v6 /observe visit names the same next step as the teacher's
 * report, praises the strongest final level, and works from the coach's evidence.
 *
 * The guide read focus_area / strengths, which a v6 analysis never has: the model chose its own "work on first" from a
 * data block that carried v6 codes, Rumi's own evidence (rumi_evidence, the levels map, combined_evidence) and every
 * level as a number, and the fallback guide's focus title was the generic "one area to improve". Now, for a v6 visit:
 *   - the ONE improvement is the report's target (target-resolver), the praise its strongest final level;
 *   - the data block shows each section by name, each levelled indicator by name with the evidence as the coach
 *     submitted it: no codes, no levels, nothing Rumi wrote that the coach did not submit;
 *   - the fallback guide's focus title is the target's name, "seen" its evidence, the next step what its next level asks;
 *   - plainCodeNames turns a v6 code the model still wrote into the indicator's name.
 * The V3 and Swahili prompts and fallbacks are unchanged (pinned in fico17-v6-report-pins.test.js and the bot suite).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const {
  buildGuidePrompt, buildFallbackGuide, validateGuide, renderGuideMessage, plainCodeNames,
} = require('../../bot/shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const { RUMI, RUMI_COMBINED_QUOTE, COACH, reviewedV6 } = require('../fixtures/fico17-v6-reviewed');
const { v3Lesson } = require('../fixtures/report-prompt-pins');

const CODE = /\b[CDF][1-8]\b/;
const dataBlock = (p) => p.slice(p.indexOf('OBSERVATION DATA'));

describe('the v6 guide prompt (ur/en)', () => {
  for (const language of ['en', 'ur']) {
    describe(language, () => {
      const p = buildGuidePrompt(reviewedV6(), { language });

      test('fixes the ONE improvement to the report\'s target, with the coach\'s evidence and the next level', () => {
        const line = p.split('\n').find((l) => l.includes('"work_on_first" is'));
        expect(line).toContain(`"${V6.indicator('C4').name}"`);
        expect(line).toContain(COACH.EV_C4);
        expect(line).toContain(V6.levelText('C4', 2));
      });

      test('grounds the praise in the strongest final level', () => {
        const line = p.split('\n').find((l) => l.startsWith('- The first "went_well" item'));
        expect(line).toContain(`"${V6.indicator('C6').name}"`);
        expect(line).toContain(RUMI.C6[3]);
      });

      test('the data block names sections and indicators in words: no codes, no levels', () => {
        const d = dataBlock(p);
        expect(d).toContain('what the teacher does');
        expect(d).toContain(V6.indicator('D3').name);
        expect(d).toContain(COACH.D3);
        expect(d).not.toMatch(CODE);
        expect(d).not.toMatch(/"result"|"level"|"levels"|"rung"|v6 teacher|fico17/);
      });

      test('nothing Rumi wrote that the coach did not submit, and no source labels', () => {
        expect(p).not.toContain(RUMI.C4[1]);
        expect(p).not.toContain(RUMI_COMBINED_QUOTE);
        expect(p).not.toMatch(/set_by|set by|rumi_evidence|rumi evidence|combined evidence|prompt version/);
      });

      test('NA and couldn\'t-tell rows are left out of the data block', () => {
        const d = dataBlock(p);
        expect(d).not.toContain(COACH.C7);
        expect(d).not.toContain(RUMI.C8[1]);
      });

      test('the prompt itself carries no level number', () => {
        expect(p).not.toMatch(/level \d|\d of 4|\d\/4/);
      });
    });
  }
});

describe('the v6 fallback guide (no model)', () => {
  for (const language of ['en', 'ur']) {
    test(`${language}: a real focus title, the coach's evidence, the next level, and the strongest level as praise`, () => {
      const g = buildFallbackGuide(reviewedV6(), { language });
      expect(g.work_on_first.title).toBe(V6.indicator('C4').name);
      expect(g.work_on_first.seen).toBe(COACH.EV_C4);
      expect(g.work_on_first.next_step).toBe(V6.levelText('C4', 2));
      expect(g.went_well[0]).toContain(V6.indicator('C6').name);
      expect(g.went_well[0]).toContain(RUMI.C6[3]);
      expect(g.conversation[3]).toContain(V6.indicator('C4').name);
      expect(() => validateGuide(g, observeStrings(language), language)).not.toThrow();
      expect(renderGuideMessage(g, observeStrings(language))).not.toMatch(CODE);
    });
  }
  test('a next level that starts "Beyond level 3," loses its number', () => {
    const a = reviewedV6({ r_C1: '4', r_C4: '3', r_D3: '3', why_D3: COACH.D3, r_D5: '3', r_C3: '3', r_F3: '3', r_F4: '3' });
    const g = buildFallbackGuide(a, { language: 'en' });
    expect(g.work_on_first.title).toBe(V6.indicator('C3').name);
    expect(V6.levelText('C3', 4)).toMatch(/^Beyond level 3, /);
    expect(g.work_on_first.next_step).toBe('The teacher calls at least two different names to answer, and each is followed by an answer.');
  });
});

describe('plainCodeNames on a v6 visit', () => {
  const guide = () => ({
    intro: 'Notes.', went_well: ['C6: you thanked Bilal.'], work_on_first: { title: 'C4', next_step: 'Take up one idea (C4).' },
    moment: null, conversation: ['1', '2', '3', 'Work on C4.', '5', '6'], outro: 'End.',
  });
  test('a v6 code the model wrote becomes the indicator\'s name', () => {
    const g = plainCodeNames(guide(), reviewedV6());
    expect(g.went_well[0]).toBe(`${V6.indicator('C6').name}: you thanked Bilal.`);
    expect(g.work_on_first.title).toBe(V6.indicator('C4').name);
    expect(g.conversation[3]).toBe(`Work on ${V6.indicator('C4').name}.`);
  });
  test('without a v6 analysis the notes are as before (V3 codes are not v6 names)', () => {
    expect(plainCodeNames(guide(), v3Lesson()).work_on_first.title).toBe('C4');
    expect(plainCodeNames(guide()).work_on_first.title).toBe('C4');
  });
});

describe('buildDebriefGuide passes the visit to plainCodeNames', () => {
  test('a v6 code in the model\'s notes reaches the coach as the indicator\'s name', async () => {
    jest.resetModules();
    const notes = {
      intro: 'Notes for your talk.', went_well: ['Safe to be wrong: you thanked Bilal.'],
      work_on_first: { title: 'C4', seen: 'You decided every step.', next_step: 'Take up one idea from a child.' },
      moment: null,
      conversation: ['I liked how you thanked Bilal.', 'Remember when Sana offered her way?', 'What went through your mind?', 'One thing: C4.', 'What will you do next time?', 'Say it to me now.'],
      outro: 'No number to hand over.',
    };
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: async () => ({ result: notes }) }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    const { buildDebriefGuide } = require('../../bot/shared/services/observe/observe-debrief.service');
    const g = await buildDebriefGuide({ id: 'cs-v6', user_id: 't', analysis_data: reviewedV6() }, 'en');
    expect(g.work_on_first.title).toBe(V6.indicator('C4').name);
    expect(g.conversation[3]).toBe(`One thing: ${V6.indicator('C4').name}.`);
  });
});
