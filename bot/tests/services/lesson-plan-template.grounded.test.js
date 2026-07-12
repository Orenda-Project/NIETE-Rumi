/**
 * Tests for buildGroundedLessonPlanPrompt — locks the shape + verbatim-content
 * guarantees the Gamma-grounded path relies on.
 *
 * Framework: the grounded prompt lays out source content into the 5-step GRR
 * (Gradual Release of Responsibility) framework — OPENING / I DO / WE DO /
 * YOU DO / CONCLUSION — which mirrors the source JSON's own step arrays 1:1.
 * Each source array (opening_steps, explain_steps, practice_steps,
 * independent_practice_steps, conclusion_steps) maps to exactly ONE GRR
 * section — no more splitting content across sections like the imported 5E
 * wrapper did.
 */

const {
  buildLessonPlanPrompt,
  buildGroundedLessonPlanPrompt,
  SECTION_COUNT,
  GRR_SECTION_COUNT,
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
  it('returns the expected shape with GRR section count (5)', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.numCards).toBe(NUM_CARDS);
    expect(g.sectionCount).toBe(GRR_SECTION_COUNT);
    expect(GRR_SECTION_COUNT).toBe(5);
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

  it('instructions tell Gamma to preserve verbatim + not invent + no splitting', () => {
    const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
    expect(g.additionalInstructions).toMatch(/preserved verbatim/i);
    expect(g.additionalInstructions).toMatch(/do NOT invent/i);
    // Explicit 1:1 mapping guardrail — each source array = one section
    expect(g.additionalInstructions).toMatch(/maps 1:1 to exactly ONE framework section/i);
    expect(g.additionalInstructions).toMatch(/do NOT split content across sections/i);
    expect(g.inputText).toMatch(/Do NOT invent/i);
  });

  // ─── GRR framework labels (NOT the old 5E labels) ────────────────────
  describe('framework sections use GRR labels, not 5E', () => {
    it('renders the 5 GRR section headings with per-section timings', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
      // OPENING with opening_time
      expect(g.inputText).toMatch(/## 1\. OPENING \[5 minutes\]/);
      // I DO — Direct Instruction with explain_time
      expect(g.inputText).toMatch(/## 2\. I DO — Direct Instruction \[15 minutes\]/);
      // WE DO — Guided Practice with practice_time
      expect(g.inputText).toMatch(/## 3\. WE DO — Guided Practice \[5 minutes\]/);
      // YOU DO — Independent Practice with independent_practice_time
      expect(g.inputText).toMatch(/## 4\. YOU DO — Independent Practice \[5 minutes\]/);
      // CONCLUSION with conclusion_time
      expect(g.inputText).toMatch(/## 5\. CONCLUSION — Wrap-up.+\[3 minutes\]/);
    });

    it('does NOT use the old 5E labels (ENGAGE / EXPLORATION / etc.)', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
      expect(g.inputText).not.toMatch(/INTRODUCTION \(ENGAGE\)/);
      expect(g.inputText).not.toMatch(/EXPLORATION\/INVESTIGATION/);
      expect(g.inputText).not.toMatch(/ELABORATION\/GUIDED PRACTICE/);
      expect(g.inputText).not.toMatch(/EVALUATION\/FORMATIVE ASSESSMENT/);
    });

    it('maps source arrays 1:1 to GRR sections (each array is exactly one section)', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
      // Each source array is called out with its target section
      expect(g.inputText).toMatch(/OPENING STEPS — for Section 1 OPENING/);
      expect(g.inputText).toMatch(/EXPLAIN STEPS — for Section 2 I DO/);
      expect(g.inputText).toMatch(/PRACTICE STEPS — for Section 3 WE DO/);
      expect(g.inputText).toMatch(/INDEPENDENT PRACTICE STEPS — for Section 4 YOU DO/);
      expect(g.inputText).toMatch(/CONCLUSION STEPS — for Section 5 CONCLUSION/);
    });
  });

  it('freeform path is unchanged (still 9-section 5E — backward-compat sanity)', () => {
    const f = buildLessonPlanPrompt();
    expect(f.numCards).toBe(NUM_CARDS);
    expect(f.sectionCount).toBe(SECTION_COUNT);
    expect(SECTION_COUNT).toBe(9);
    // The freeform prompt does NOT reference source LP content
    expect(f.inputText).not.toContain('Assalam-o-Alaikum');
    expect(f.inputText).not.toContain('LESSON PLAN SOURCE');
    // Freeform still uses the old 5E labels (out of scope for the GRR swap)
    expect(f.inputText).toMatch(/INTRODUCTION \(ENGAGE\)/);
  });

  it('throws if lp is missing', () => {
    expect(() => buildGroundedLessonPlanPrompt(null)).toThrow(/lp is required/);
    expect(() => buildGroundedLessonPlanPrompt(undefined)).toThrow(/lp is required/);
  });

  // ─── Language routing ────────────────────────────────────────────────
  describe('language routing (Urdu framework, preserved source)', () => {
    it('English (default) — framework directive says "in English" and does NOT mention Urdu', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP);
      expect(g.inputText).toMatch(/section headings and framework prose in English/i);
      expect(g.inputText).not.toContain('اردو');
    });

    it('Urdu — framework directive REQUIRES Urdu section headings + explicit "do not translate teacher scripts"', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP, { language: 'ur' });
      // Urdu framework prose
      expect(g.inputText).toContain('اردو');
      expect(g.inputText).toMatch(/section HEADINGS.+in Urdu/i);
      // Source content preservation
      expect(g.inputText).toMatch(/DO NOT translate or paraphrase teacher scripts/i);
      // Markers stay English so teachers can visually distinguish
      expect(g.inputText).toMatch(/KEEP the marker tags themselves in English/i);
      // Source teacher scripts still preserved verbatim (regardless of language)
      expect(g.inputText).toContain('Assalam-o-Alaikum class!');
      expect(g.inputText).toContain('[SAY]');
    });

    it('Urdu — bilingual/code-switched source scripts flagged as preserve-as-is', () => {
      const g = buildGroundedLessonPlanPrompt(SAMPLE_LP, { language: 'ur' });
      expect(g.inputText).toMatch(/may itself be Urdu, English, or mixed/i);
    });
  });
});
