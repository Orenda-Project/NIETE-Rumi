import { describe, expect, it } from 'vitest';
import { WAYS, isComplete, purposesFor, suggestWay, waysFor, type OwnAnswers } from './rules';

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
  it('maths offers Things → pictures → numbers; Urdu and English in grades 1–3 offer Sounds first', () => {
    expect(waysFor({ grade: 3, subject: 'math' })).toContain('cpa');
    expect(waysFor({ grade: 2, subject: 'urdu' })).toContain('phonics');
    expect(waysFor({ grade: 1, subject: 'english' })).toContain('phonics');
    expect(waysFor({ grade: 4, subject: 'urdu' })).not.toContain('phonics');
  });
  it('the other primary subjects are neither maths nor a language', () => {
    for (const subject of ['islamiat', 'general_knowledge', 'general_knowledge_ur', 'social_studies_ur', 'social_studies_en', 'general_science']) {
      const w = waysFor({ grade: 2, subject });
      expect(w).not.toContain('cpa');
      expect(w).not.toContain('phonics');
    }
  });
});

// bd-snkn32.13 — phonics, counting with stones and TaRL do not fit a Grade 10 Chemistry lesson.
describe('grades 6–12: their own ways, what the lesson is for', () => {
  const PRIMARY = ['tarl', 'cpa', 'phonics', 'games', 'story'];
  it('6–8 and 9–12 offer none of the primary ways; past-paper practice is 9–12 only', () => {
    const middle = waysFor({ grade: 7, subject: 'Science' });
    const senior = waysFor({ grade: 10, subject: 'Chemistry' });
    for (const w of [...middle, ...senior]) expect(PRIMARY).not.toContain(w);
    expect(middle).toEqual(['worked', 'numericals', 'practical', 'inquiry', 'concept_map', 'discussion', 'reading']);
    expect(senior).toEqual([...middle, 'past_paper']);
  });
  it('more choice than primary: the whole band set whatever the subject', () => {
    expect(waysFor({ grade: 9, subject: 'Urdu' })).toEqual(waysFor({ grade: 9, subject: 'Physics' }));
  });
  it('purposes: board exam practice only from Grade 9; none for 1–5', () => {
    expect(purposesFor(4)).toEqual([]);
    expect(purposesFor(7)).toEqual(['new', 'revise', 'reteach']);
    expect(purposesFor(11)).toEqual(['new', 'revise', 'board', 'reteach']);
  });
  it('the suggestion fits the subject and the purpose', () => {
    const g = (over: Partial<OwnAnswers>) => suggestWay(at({ grade: 10, level: 'behind', ...over })).way;
    expect(g({ subject: 'Chemistry', purpose: 'board' })).toBe('past_paper');
    expect(g({ subject: 'Mathematics' })).toBe('worked');
    expect(g({ subject: 'Physics' })).toBe('numericals');
    expect(g({ subject: 'Biology' })).toBe('practical');
    expect(g({ subject: 'English' })).toBe('reading');
    expect(g({ subject: 'Pakistan Studies' })).toBe('discussion');
    expect(g({ grade: 7, subject: 'Science', purpose: 'board' })).toBe('practical');
  });
  it('a 6–12 plan needs what the lesson is for; 1–5 does not', () => {
    expect(isComplete(at({ grade: 8, way: 'worked' }))).toBe(false);
    expect(isComplete(at({ grade: 8, way: 'worked', purpose: 'revise' }))).toBe(true);
    expect(isComplete(at({ grade: 4, way: 'story' }))).toBe(true);
  });
  it('every way is a known way', () => {
    for (const g of [2, 7, 11]) for (const w of waysFor({ grade: g, subject: 'English' })) expect(WAYS).toContain(w);
  });
});
