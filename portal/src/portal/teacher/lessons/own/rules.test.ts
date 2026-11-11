import { describe, expect, it } from 'vitest';
import { GUARDRAIL_WAYS, WAYS, bandOf, isComplete, purposesFor, suggestWay, waysFor, type OwnAnswers } from './rules';

/**
 * bd-snkn32 — the teaching way "Make my own" suggests from her answers (design: first match wins, the
 * others stay as choices, filtered to the subject). Pure: no I/O, no React.
 */

const base: OwnAnswers = {
  grade: 4, subject: 'Science', segment: 's1', size: 'up30', resources: ['textbook'], level: 'on_track', way: null,
};
const at = (over: Partial<OwnAnswers>): OwnAnswers => ({ ...base, ...over });

describe('suggestWay — first match wins', () => {
  it('Behind → teach at the right level', () => {
    expect(suggestWay(at({ level: 'behind' })).way).toBe('tarl');
  });
  it('Mixed → teach at the right level, even for Math with local objects', () => {
    expect(suggestWay(at({ level: 'mixed', subject: 'Mathematics', resources: ['textbook', 'objects'] })).way).toBe('tarl');
  });
  it('Math + things from around → things, pictures, numbers', () => {
    expect(suggestWay(at({ subject: 'Mathematics', resources: ['textbook', 'objects'] })).way).toBe('cpa');
  });
  it('Math without local objects is not CPA', () => {
    expect(suggestWay(at({ subject: 'Mathematics', size: '51_70' })).way).toBe('story');
  });
  it('Urdu or English in grades 1–3 → sounds first', () => {
    expect(suggestWay(at({ grade: 2, subject: 'Urdu', size: '51_70' })).way).toBe('phonics');
    expect(suggestWay(at({ grade: 3, subject: 'English', size: '51_70' })).way).toBe('phonics');
  });
  it('grade 4 English is not phonics', () => {
    expect(suggestWay(at({ grade: 4, subject: 'English', size: '51_70' })).way).toBe('story');
  });
  it('up to 50 children, on track or ahead → games and movement', () => {
    expect(suggestWay(at({ size: 'up30' })).way).toBe('games');
    expect(suggestWay(at({ size: '31_50', level: 'ahead' })).way).toBe('games');
  });
  it('51 or more on track → story and talk', () => {
    expect(suggestWay(at({ size: '51_70' })).way).toBe('story');
    expect(suggestWay(at({ size: 'over70', level: 'ahead' })).way).toBe('story');
  });
  it('carries the reasons it matched on', () => {
    expect(suggestWay(at({ level: 'mixed', size: '51_70' })).why).toEqual(['mixed', '51_70']);
    expect(suggestWay(at({ subject: 'Mathematics', resources: ['textbook', 'objects'] })).why).toEqual(['math', 'objects']);
    expect(suggestWay(at({ grade: 1, subject: 'Urdu', size: '51_70' })).why).toEqual(['language', 'early']);
    expect(suggestWay(at({ size: '31_50' })).why).toEqual(['31_50', 'on_track']);
    expect(suggestWay(at({ size: '51_70' })).why).toEqual([]);
  });
  it('an unanswered level or size falls through to story', () => {
    expect(suggestWay(at({ level: null, size: null })).way).toBe('story');
  });
});

describe('waysFor — the choices offered, filtered to the subject', () => {
  it('Math gets CPA, not phonics', () => {
    const w = waysFor({ grade: 2, subject: 'Mathematics' });
    expect(w).toContain('cpa');
    expect(w).not.toContain('phonics');
  });
  it('early Urdu gets phonics, not CPA', () => {
    const w = waysFor({ grade: 2, subject: 'Urdu' });
    expect(w).toContain('phonics');
    expect(w).not.toContain('cpa');
  });
  it('grade 4 Science gets neither', () => {
    expect(waysFor({ grade: 4, subject: 'Science' })).toEqual(['tarl', 'games', 'story']);
  });
  it('every offered way is a known way, in WAYS order', () => {
    const w = waysFor({ grade: 1, subject: 'English' });
    expect(w).toEqual(WAYS.filter((x) => w.includes(x)));
  });
});

describe('isComplete — Make my plan is only offered with every answer in', () => {
  it('needs a segment, a size, a level and a way', () => {
    expect(isComplete(at({ way: 'story' }))).toBe(true);
    expect(isComplete(at({ way: null }))).toBe(false);
    expect(isComplete(at({ way: 'story', segment: '' }))).toBe(false);
    expect(isComplete(at({ way: 'story', size: null }))).toBe(false);
    expect(isComplete(at({ way: 'story', level: null }))).toBe(false);
  });
  it('the textbook alone is enough to have', () => {
    expect(isComplete(at({ way: 'story', resources: [] }))).toBe(true);
  });
});

// bd-snkn32.4 — grades 1–5 subjects ride the address by their catalogue KEY (lp_catalog subject_key), not a name.
describe('grades 1–5 subject keys (the product reviewer\'s check)', () => {
  it('maths offers Things → pictures → numbers; Urdu and English in every grade 1–5 offer Sounds first', () => {
    expect(waysFor({ grade: 3, subject: 'math' })).toContain('cpa');
    expect(waysFor({ grade: 2, subject: 'urdu' })).toContain('phonics');
    expect(waysFor({ grade: 1, subject: 'english' })).toContain('phonics');
    expect(waysFor({ grade: 4, subject: 'urdu' })).toContain('phonics');
  });
  it('the other primary subjects are neither maths nor a language', () => {
    for (const subject of ['islamiat', 'general_knowledge', 'general_knowledge_ur', 'social_studies_ur', 'social_studies_en', 'general_science']) {
      const w = waysFor({ grade: 2, subject });
      expect(w).not.toContain('cpa');
      expect(w).not.toContain('phonics');
    }
  });
});

// bd-snkn32.19 — one flow for grades 1–12; only the option lists differ by band (the unified spec, "Every option, by band").
describe('bandOf — the band, from the grade once', () => {
  it('1–5 primary, 6–8 middle, 9–12 senior', () => {
    expect([1, 5].map(bandOf)).toEqual(['primary', 'primary']);
    expect([6, 8].map(bandOf)).toEqual(['middle', 'middle']);
    expect([9, 12].map(bandOf)).toEqual(['senior', 'senior']);
  });
});

describe('grades 1–5: the guardrails stay', () => {
  it('phonics and CPA are the guardrail ways', () => {
    expect([...GUARDRAIL_WAYS]).toEqual(['phonics', 'cpa']);
  });
  it('English and Urdu offer Sounds first in grades 4 and 5 too', () => {
    for (const grade of [4, 5]) for (const subject of ['English', 'Urdu']) expect(waysFor({ grade, subject })).toContain('phonics');
  });
  it('Maths offers CPA in every grade 1–5', () => {
    for (const grade of [1, 2, 3, 4, 5]) expect(waysFor({ grade, subject: 'Mathematics' })).toContain('cpa');
  });
  it('no rote way exists at any grade', () => {
    for (const w of WAYS) expect(w).not.toMatch(/rote|repeat|memor|drill/);
  });
});

describe('grades 6–12: a secondary set, filtered by subject, never the primary list', () => {
  const PRIMARY = ['tarl', 'cpa', 'phonics', 'games', 'story'];
  it('Grade 8 Science sees no primary way', () => {
    for (const w of waysFor({ grade: 8, subject: 'Science' })) expect(PRIMARY).not.toContain(w);
  });
  it('filtered by subject', () => {
    expect(waysFor({ grade: 7, subject: 'English' })).toEqual(['reading', 'writing', 'concept_map', 'discussion']);
    expect(waysFor({ grade: 7, subject: 'English' })).not.toContain('numericals');
    expect(waysFor({ grade: 10, subject: 'Mathematics' })).toEqual(['worked', 'inquiry', 'concept_map', 'discussion', 'past_paper']);
    expect(waysFor({ grade: 10, subject: 'Physics' })).toEqual(['numericals', 'practical', 'inquiry', 'concept_map', 'discussion', 'past_paper']);
    expect(waysFor({ grade: 7, subject: 'General Science' })).toEqual(['numericals', 'practical', 'inquiry', 'concept_map', 'discussion']);
    expect(waysFor({ grade: 10, subject: 'Biology' })).not.toContain('numericals');
    expect(waysFor({ grade: 9, subject: 'Computer Science' })).toEqual(['worked', 'practical', 'inquiry', 'concept_map', 'discussion', 'past_paper']);
    expect(waysFor({ grade: 9, subject: 'Pakistan Studies' })).toEqual(['inquiry', 'reading', 'concept_map', 'discussion', 'past_paper']);
  });
  it('Model, plan, write is for English and Urdu', () => {
    expect(waysFor({ grade: 10, subject: 'Urdu' })).toContain('writing');
    expect(waysFor({ grade: 10, subject: 'Chemistry' })).not.toContain('writing');
  });
  it('exam practice from Grade 8 (FDE), board practice 9–12; none in 6–7', () => {
    expect(waysFor({ grade: 7, subject: 'Science' })).not.toContain('past_paper');
    // Grade 8 sends the bot's FDE code (lp612-own-ways waysOfGrade(8)); FBISE past papers are 9–12 only.
    expect(waysFor({ grade: 8, subject: 'Science' })).toContain('exam_fde');
    expect(waysFor({ grade: 8, subject: 'Science' })).not.toContain('past_paper');
    expect(waysFor({ grade: 9, subject: 'Science' })).not.toContain('exam_fde');
    expect(waysFor({ grade: 7, subject: 'Science' })).not.toContain('exam_fde');
    expect(purposesFor(4)).toEqual([]);
    expect(purposesFor(7)).toEqual(['new', 'revise', 'reteach']);
    expect(purposesFor(8)).toEqual(['new', 'revise', 'reteach', 'board']);
    expect(purposesFor(11)).toEqual(['new', 'revise', 'reteach', 'board']);
  });
  it('the suggestion fits the subject, the purpose and the level, and is always on the list', () => {
    const g = (over: Partial<OwnAnswers>) => suggestWay(at({ grade: 10, level: 'on_track', ...over }));
    expect(g({ subject: 'Chemistry', purpose: 'board' }).way).toBe('past_paper');
    expect(g({ grade: 8, subject: 'Science', purpose: 'board' })).toEqual({ way: 'exam_fde', why: ['board'] });
    expect(g({ subject: 'Mathematics' }).way).toBe('worked');
    expect(g({ subject: 'Physics' }).way).toBe('numericals');
    expect(g({ subject: 'Biology' }).way).toBe('practical');
    expect(g({ subject: 'English' }).way).toBe('reading');
    expect(g({ subject: 'Pakistan Studies' }).way).toBe('reading');
    expect(g({ subject: 'Art' }).way).toBe('discussion');
    expect(g({ subject: 'Mathematics', level: 'behind' })).toEqual({ way: 'worked', why: ['behind', 'math'] });
    expect(g({ subject: 'Urdu', purpose: 'reteach' })).toEqual({ way: 'reading', why: ['reteach', 'language'] });
    for (const subject of ['English', 'Physics', 'Biology', 'History', 'Computer Science', 'Art']) {
      for (const grade of [6, 8, 10]) expect(waysFor({ grade, subject })).toContain(g({ grade, subject }).way);
    }
  });
  it('a 6–12 plan needs what the lesson is for; 1–5 does not', () => {
    expect(isComplete(at({ grade: 8, way: 'worked' }))).toBe(false);
    expect(isComplete(at({ grade: 8, way: 'worked', purpose: 'revise' }))).toBe(true);
    expect(isComplete(at({ grade: 4, way: 'story' }))).toBe(true);
  });
});
