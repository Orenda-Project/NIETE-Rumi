/**
 * Conformance test for the extracted lesson-plan template service.
 *
 * Guards the foothold built for bd-1841:
 *   - buildLessonPlanPrompt is the SINGLE source for the framework section list,
 *     the numCards Gamma hint, and the reinforcement instruction.
 *   - The section count and the count quoted in additionalInstructions agree
 *     (the old 7-vs-9 contradiction is resolved: numCards is a distinct,
 *     documented Gamma layout knob, NOT the section count).
 *   - content.service.js no longer inlines the section-list literal — it sources
 *     the framework from this service.
 */

const fs = require('fs');
const path = require('path');
const {
  buildLessonPlanPrompt,
  SECTION_COUNT,
  NUM_CARDS,
} = require('../../bot/shared/services/lesson-plan-template.service');

describe('lesson-plan-template.service — buildLessonPlanPrompt', () => {
  it('returns a single coherent { inputText, numCards, additionalInstructions, sectionCount }', () => {
    const t = buildLessonPlanPrompt({ language: 'en' });
    expect(typeof t.inputText).toBe('string');
    expect(t.inputText.length).toBeGreaterThan(0);
    expect(typeof t.additionalInstructions).toBe('string');
    expect(typeof t.numCards).toBe('number');
    expect(typeof t.sectionCount).toBe('number');
  });

  it('defines exactly ONE coherent section set (## N headings are 1..N, no gaps or dupes)', () => {
    const { inputText, sectionCount } = buildLessonPlanPrompt();
    const headings = [...inputText.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
    // Sequential 1..sectionCount, each exactly once.
    expect(headings).toEqual(
      Array.from({ length: sectionCount }, (_, i) => i + 1)
    );
    expect(sectionCount).toBe(SECTION_COUNT);
  });

  it('keeps numCards and the section count internally consistent (no 7-vs-9 contradiction)', () => {
    const { numCards, additionalInstructions, sectionCount } = buildLessonPlanPrompt();
    // additionalInstructions must quote the SAME number as the real section
    // count — never a stale, contradictory figure.
    const quoted = additionalInstructions.match(/all (\d+) sections/);
    expect(quoted).not.toBeNull();
    expect(Number(quoted[1])).toBe(sectionCount);

    // numCards is a separate Gamma layout knob. The bug we guard against is the
    // instruction text quoting numCards as if it were the section count.
    if (numCards !== sectionCount) {
      expect(additionalInstructions).not.toContain(`all ${numCards} sections`);
    }
    expect(numCards).toBe(NUM_CARDS);
  });

  it('embeds the 5E model inside the section set (Engage/Explore/Explain/Elaborate/Evaluate)', () => {
    const { inputText } = buildLessonPlanPrompt();
    expect(inputText).toMatch(/ENGAGE/);
    expect(inputText).toMatch(/EXPLORATION/);
    expect(inputText).toMatch(/EXPLANATION/);
    expect(inputText).toMatch(/ELABORATION/);
    expect(inputText).toMatch(/EVALUATION/);
  });
});

describe('content.service.js — sources the framework from the template service', () => {
  const contentSrc = fs.readFileSync(
    path.resolve(__dirname, '../../bot/shared/services/content.service.js'),
    'utf8'
  );

  it('imports buildLessonPlanPrompt from lesson-plan-template.service', () => {
    expect(contentSrc).toMatch(
      /require\(['"]\.\/lesson-plan-template\.service['"]\)/
    );
    expect(contentSrc).toMatch(/buildLessonPlanPrompt/);
  });

  it('no longer holds an inline section-list literal (the framework moved out)', () => {
    // The old inline literal had every section heading. A single one of these
    // headings appearing in content.service.js means the literal leaked back in.
    expect(contentSrc).not.toMatch(/## 1\. LEARNING OBJECTIVES/);
    expect(contentSrc).not.toMatch(/## 9\. DIFFERENTIATION STRATEGIES/);
    expect(contentSrc).not.toMatch(/## \d+\. (?:INTRODUCTION|EXPLORATION|EVALUATION)/);
  });

  it('no longer hardcodes the section count in additionalInstructions (single source)', () => {
    expect(contentSrc).not.toMatch(/Include all \d+ sections with clear headings/);
  });
});
