/**
 * Tests for buildGroundedLessonPlanPrompt — locks the shape + verbatim-content
 * guarantees the Gamma-grounded path relies on.
 */

const {
  buildLessonPlanPrompt,
  buildGroundedLessonPlanPrompt,
  SECTION_COUNT,
  NUM_CARDS,
} = require('../../shared/services/lesson-plan-template.service');

const SAMPLE_LP = {
  publisher: 'Taleemabad',
  grade_label: 'Grade One',
  subject_label: 'Math',
  chapter_number: 1,
  chapter_title: 'Number Buddies 0-9',
  topic: 'Numbers upto 9 (Concrete)',
  curriculum_key: 'taleemabad',
  grade: 1,
  subject: 'maths',
  lp_index: 2,
  lp_slo: ['count_0_9'],
  contains_video: false,
  videos: [],
  opening_time: 5,
  explain_time: 15,
  practice_time: 5,
  independent_practice_time: 5,
  conclusion_time: 3,
  opening_steps: [
    { type: 'Say', index: 1, statement: 'Assalam-o-Alaikum class!' },
    { type: 'Instruction', index: 2, statement: 'Divide class into groups of 4.' },
  ],
  explain_steps: [
    { type: 'Do', index: 1, statement: 'Show 5 stones and count them aloud.' },
  ],
  practice_steps: [],
  independent_practice_steps: [],
  conclusion_steps: [
    { type: 'Ask', index: 1, statement: 'How many stones did we count together?' },
  ],
  classroom_setup_instructions: [
    { type: 'Instruction', index: 1, statement: 'Prepare 9 stones per group.' },
  ],
  homework_instructions: [],
};

describe('buildGroundedLessonPlanPrompt', () => {
  it('returns the same shape as freeform for drop-in compat', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.numCards).toBe(NUM_CARDS);
    expect(g.sectionCount).toBe(SECTION_COUNT);
    expect(typeof g.inputText).toBe('string');
    expect(typeof g.additionalInstructions).toBe('string');
  });

  it('embeds verbatim teacher scripts', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.inputText).toContain('Assalam-o-Alaikum class!');
    expect(g.inputText).toContain('Divide class into groups of 4.');
    expect(g.inputText).toContain('Show 5 stones and count them aloud.');
    expect(g.inputText).toContain('How many stones did we count together?');
    expect(g.inputText).toContain('Prepare 9 stones per group.');
  });

  it('embeds chapter/topic/grade/subject metadata', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.inputText).toContain('Number Buddies 0-9');
    expect(g.inputText).toContain('Numbers upto 9 (Concrete)');
    expect(g.inputText).toContain('Grade One');
    expect(g.inputText).toContain('Math');
    expect(g.inputText).toContain('Taleemabad');
  });

  it('embeds total duration derived from step timings', () => {
    // 5 + 15 + 5 + 5 + 3 = 33 minutes
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.inputText).toContain('33 minutes total');
  });

  it('emits step type markers ([SAY]/[INSTRUCTION]/[DO]/[ASK]) verbatim', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.inputText).toContain('[SAY]');
    expect(g.inputText).toContain('[INSTRUCTION]');
    expect(g.inputText).toContain('[DO]');
    expect(g.inputText).toContain('[ASK]');
  });

  it('marks empty step arrays with (none) — not "invent something"', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    // practice_steps + independent_practice_steps + homework_instructions were empty
    const noneCount = (g.inputText.match(/\(none\)/g) || []).length;
    expect(noneCount).toBeGreaterThanOrEqual(3);
  });

  it('instructions tell Gamma to preserve verbatim + not invent', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.additionalInstructions).toMatch(/preserved verbatim/i);
    expect(g.additionalInstructions).toMatch(/do NOT invent/i);
    expect(g.inputText).toMatch(/Do NOT invent/i);
  });

  it('freeform path is unchanged (backward-compat sanity)', () => {
    const f = buildLessonPlanPrompt();
    expect(f.numCards).toBe(NUM_CARDS);
    expect(f.sectionCount).toBe(SECTION_COUNT);
    // The freeform prompt does NOT reference source LP content
    expect(f.inputText).not.toContain('Assalam-o-Alaikum');
    expect(f.inputText).not.toContain('LESSON PLAN SOURCE');
  });

  it('throws if lp is missing', () => {
    expect(() => buildGroundedLessonPlanPrompt(null)).toThrow(/lp is required/);
    expect(() => buildGroundedLessonPlanPrompt(undefined)).toThrow(/lp is required/);
  });
});
