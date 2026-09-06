/**
 * Where an edited lesson is stored — and why it cannot go where the original does.
 *
 * The shared render is keyed `(segment_id, lang, template_version)` and has NO user dimension:
 * every teacher in the country who taps that subtopic is served the same bytes. So writing an
 * edit back over it would silently rewrite the national lesson to suit one teacher's homework
 * preference. The fork exists to make that impossible.
 *
 * THE KEY IS CONTENT-ADDRESSED, NOT USER-ADDRESSED. `user_id` is deliberately NOT in it. Two
 * teachers who ask the same thing of the same lesson get the same key and therefore one render
 * instead of two — the same economics the main cache has, at a finer grain — and a retry after a
 * dropped connection lands on the work already done rather than paying twice. (The design note
 * originally said "content-addressed" while listing user_id among the inputs; those are
 * contradictory and this is the resolution. Which teachers hold which edit is a database
 * question, answered by the edits table, not by the storage path.)
 *
 * HER WORDS NEVER APPEAR IN THE PATH. The instruction is hashed, never embedded: a teacher's
 * sentence in an object key is both a path-safety problem and a privacy one, and R2 keys are not
 * a place to store prose.
 *
 * `template_version` still leads the path, so bumping it expires a version's forks alongside the
 * parents they were derived from rather than orphaning them under a stale prefix.
 */

const {
  r2KeyFor, editKeyFor, editHash, assertKeyInPrefix, R2_KEY_PREFIX,
} = require('../../bot/shared/services/lp612-serving.service');

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SEG = 'grade_8_mathematics.c05.p071-073';
const TV = 'v9.1';
const DOC = { lesson_id: SEG, one_screen: 'a lesson' };
const INSTRUCTION = 'make the homework shorter';

const key = (over = {}) => editKeyFor({
  segmentId: SEG, lang: 'en', tv: TV, hash: editHash({ instruction: INSTRUCTION, doc: DOC }), ...over,
});

describe('the fork key stays inside the only isolation this lane has', () => {
  it('is under the lp612/ prefix, so the shared-bucket guard covers it unchanged', () => {
    expect(key().startsWith(R2_KEY_PREFIX)).toBe(true);
    expect(() => assertKeyInPrefix(key())).not.toThrow();
  });

  it('leads with the template version, like the parent, so a bump expires both together', () => {
    expect(key()).toMatch(new RegExp(`^${R2_KEY_PREFIX}${TV}/`));
  });

  it('never collides with the shared render it was derived from', () => {
    expect(key()).not.toBe(r2KeyFor(SEG, 'en', TV));
  });

  it('is a sibling pair — the PDF and the document that made it', () => {
    expect(key()).toMatch(/\.pdf$/);
    expect(key({ ext: 'lp.json' })).toBe(key().replace(/\.pdf$/, '.lp.json'));
    expect(() => assertKeyInPrefix(key({ ext: 'lp.json' }))).not.toThrow();
  });

  it('carries no path traversal even if a segment id ever contains one', () => {
    const k = editKeyFor({
      segmentId: '../../pre_gen_lps/x', lang: 'en', tv: TV, hash: 'abcd1234',
    });
    expect(() => assertKeyInPrefix(k)).not.toThrow();
    expect(k).not.toContain('..');
  });
});

describe('the hash is content-addressed', () => {
  it('is stable for the same instruction and the same source document', () => {
    expect(editHash({ instruction: INSTRUCTION, doc: DOC }))
      .toBe(editHash({ instruction: INSTRUCTION, doc: DOC }));
  });

  it('changes when the instruction changes', () => {
    expect(editHash({ instruction: INSTRUCTION, doc: DOC }))
      .not.toBe(editHash({ instruction: 'add another activity', doc: DOC }));
  });

  it('changes when the SOURCE document changes — an edit of an edit must not collide', () => {
    expect(editHash({ instruction: INSTRUCTION, doc: DOC }))
      .not.toBe(editHash({ instruction: INSTRUCTION, doc: { ...DOC, one_screen: 'edited once' } }));
  });

  it('ignores casing and surrounding whitespace, so trivial variants share one render', () => {
    expect(editHash({ instruction: '  Make The Homework Shorter \n', doc: DOC }))
      .toBe(editHash({ instruction: INSTRUCTION, doc: DOC }));
  });

  it('does NOT depend on who asked — two teachers asking the same thing share the render', () => {
    const a = editHash({ instruction: INSTRUCTION, doc: DOC, userId: 'teacher-a' });
    const b = editHash({ instruction: INSTRUCTION, doc: DOC, userId: 'teacher-b' });
    expect(a).toBe(b);
  });

  it('is short, hex, and safe to put in a path', () => {
    const h = editHash({ instruction: INSTRUCTION, doc: DOC });
    expect(h).toMatch(/^[0-9a-f]{8,32}$/);
  });

  it('never leaks her words into the key', () => {
    const k = editKeyFor({
      segmentId: SEG, lang: 'en', tv: TV,
      hash: editHash({ instruction: 'please remove the bit about my school', doc: DOC }),
    });
    expect(k).not.toMatch(/school|please|remove/i);
  });
});
