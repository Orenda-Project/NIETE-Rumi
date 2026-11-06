const m = require('../../../bot/shared/services/assessment/board-checks/tag-complete');
const valid = require('./fixtures/tag-valid.json');
const invalid = require('./fixtures/tag-invalid.json');

const wrap = (...items) => ({ unseen: { objective: { M: items } } });
const FREE = { mode: 'free' };
const TAG = { chapter: 2, section: null, code: 'g9.physics.ch2.lo3', page: 39, official_slo: 'P-09-B-02', blooms: 'U', difficulty: 'easy' };
const mcq = (over = {}, tag = {}) => ({ id: 'q1', type: 'mcq', kind: null, tag: { ...TAG, ...tag }, ...over });
const cell = (extra = {}) => ({ mode: 'board', subjectConfig: { grade: 9, code: 'physics', tos_default: { levels: { R: 30, U: 30, A: 20, AE: 10, C: 10 }, tolerance_pp: 5, status: 'set' } }, ...extra });
const codes = (r) => r.issues.map((i) => i.code);
const hardCodes = (r) => r.issues.filter((i) => i.hard).map((i) => i.code);

describe('tag-complete: contract examples', () => {
  test('member interface', () => {
    expect(m.id).toBe('tag-complete');
    expect(m.hard).toBe('shape');
    expect(m.modes).toEqual(['free', 'board']);
  });
  test('every valid example passes', () => {
    valid.items.forEach((it) => {
      const r = m.run(wrap(it), FREE);
      expect({ id: it.id, hard: hardCodes(r) }).toEqual({ id: it.id, hard: [] });
      expect(r.ok).toBe(true);
    });
  });
  const expected = ['SLO_FORM', 'SLO_FORM', 'CODE_FORM', 'TAG_SHAPE', 'CODE_FORM', 'BLOOMS_SCALE', 'TAG_SHAPE', 'TAG_SHAPE', 'TYPE_OFF_CATALOGUE', 'KIND_RULE', 'TAG_SHAPE', 'TAG_SHAPE', 'TAG_SHAPE', 'TAG_MISSING', 'TAG_SHAPE'];
  invalid.cases.forEach((c, i) => {
    test(`invalid ${i}: ${c.reason.slice(0, 50)}`, () => {
      const r = m.run(wrap(c.item), FREE);
      expect(r.ok).toBe(false);
      expect(hardCodes(r)).toContain(expected[i]);
    });
  });
});

describe('tag-complete: rules', () => {
  test('string "null" and bracketed SLO fail; JSON null passes', () => {
    expect(hardCodes(m.run(wrap(mcq({}, { official_slo: 'null' })), FREE))).toEqual(['SLO_FORM']);
    expect(hardCodes(m.run(wrap(mcq({}, { official_slo: 'U-12-E-[17]' })), FREE))).toEqual(['SLO_FORM']);
    expect(m.run(wrap(mcq({}, { official_slo: null })), FREE).ok).toBe(true);
  });
  test('blooms scale comes from the variant (board) then the registry row', () => {
    const kua = { mode: 'board', variant: { cognitive_split: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5, status: 'set' } }, subjectConfig: { grade: 9, code: 'physics' } };
    expect(hardCodes(m.run(wrap(mcq({}, { blooms: 'C' })), kua))).toEqual(['BLOOMS_SCALE']);
    expect(hardCodes(m.run(wrap(mcq({}, { blooms: 'R' })), kua))).toEqual(['BLOOMS_SCALE']);
    expect(m.run(wrap(mcq({}, { blooms: 'K' })), kua).ok).toBe(true);
    const ruaae = { mode: 'free', subjectConfig: { grade: 9, code: 'physics', tos_default: { levels: { R: 30, U: 30, A: 20, AE: 20 }, tolerance_pp: 5, status: 'set' } } };
    expect(m.run(wrap(mcq({}, { blooms: 'AE' })), ruaae).ok).toBe(true);
    expect(hardCodes(m.run(wrap(mcq({}, { blooms: 'C' })), ruaae))).toEqual(['BLOOMS_SCALE']);
  });
  test('type outside the catalogue; ctx.typesFor narrows it', () => {
    expect(hardCodes(m.run(wrap(mcq({ type: 'sequence_text' })), FREE))).toEqual(['TYPE_OFF_CATALOGUE']);
    expect(hardCodes(m.run(wrap(mcq({ type: 'board_paper' })), FREE))).toEqual(['TYPE_OFF_CATALOGUE']);
    const narrow = { mode: 'free', subjectConfig: { grade: 9, code: 'physics' }, typesFor: () => [{ id: 'mcq' }, { id: 'srq' }] };
    expect(hardCodes(m.run(wrap(mcq({ type: 'match' })), narrow))).toEqual(['TYPE_OFF_CATALOGUE']);
    expect(m.run(wrap(mcq()), narrow).ok).toBe(true);
  });
  test('board: item type must equal the slot type', () => {
    const p = { _layout: { sections: [{ id: 'A', slots: [{ slot: 's.A.Q1', type: 'srq' }] }] }, unseen: { objective: { M: [mcq({ slot: 's.A.Q1' })] } } };
    expect(hardCodes(m.run(p, cell()))).toEqual(['TYPE_SLOT']);
  });
  test('a container with a tag; a leaf without; or/parts nodes pass without', () => {
    const container = { id: 'p', type: 'erq', tag: TAG, parts: [mcq({ id: 'p1' })] };
    expect(hardCodes(m.run(wrap(container), FREE))).toEqual(['TAG_MISSING']);
    const ok = { id: 'p', type: 'erq', parts: [mcq({ id: 'p1' })] };
    expect(m.run(wrap(ok), FREE).ok).toBe(true);
  });
  test('kind on an MCQ fails; kind on srq must be in the enum', () => {
    expect(hardCodes(m.run(wrap(mcq({ kind: 'define' })), FREE))).toEqual(['KIND_RULE']);
    expect(m.run(wrap(mcq({ type: 'srq', kind: 'define' })), FREE).ok).toBe(true);
    expect(hardCodes(m.run(wrap(mcq({ type: 'srq', kind: 'rant' })), FREE))).toContain('KIND_RULE');
  });
  test('code of another grade/subject or a wrong ch<n> fails (D-check)', () => {
    expect(hardCodes(m.run(wrap(mcq({}, { code: 'g8.physics.ch2.lo3' })), cell()))).toEqual(['CODE_FORM']);
    expect(hardCodes(m.run(wrap(mcq({}, { code: 'g9.chemistry.ch2.lo3' })), cell()))).toEqual(['CODE_FORM']);
    expect(hardCodes(m.run(wrap(mcq({}, { code: 'g9.physics.ch3.lo3' })), cell()))).toEqual(['CODE_FORM']);
    expect(m.run(wrap(mcq()), cell()).ok).toBe(true);
  });
  test('official and skill codes pass the form check', () => {
    expect(m.run(wrap(mcq({}, { code: 'P-09-B-02' })), cell()).ok).toBe(true);
    expect(m.run(wrap(mcq({ type: 'letter' }, { code: 'english.skill.letter', page: null })), cell()).ok).toBe(true);
  });
  test('codes_extra: more than 4 or a bad form fails', () => {
    const x = (list) => m.run(wrap(mcq({}, { codes_extra: list })), cell());
    expect(x(['g9.physics.ch2.lo4']).ok).toBe(true);
    expect(hardCodes(x(['nonsense']))).toContain('CODE_FORM');
    expect(hardCodes(x(['g9.physics.ch2.lo1', 'g9.physics.ch2.lo2', 'g9.physics.ch2.lo4', 'g9.physics.ch2.lo5', 'g9.physics.ch2.lo6']))).toContain('TAG_SHAPE');
  });
  test('never coerces: a string chapter fails, input is not mutated', () => {
    const p = wrap(mcq({}, { chapter: '2' }));
    const copy = JSON.stringify(p);
    expect(hardCodes(m.run(p, FREE))).toEqual(['TAG_SHAPE']);
    expect(JSON.stringify(p)).toBe(copy);
  });
  test('item_ref is on every issue', () => {
    const r = m.run(wrap(mcq({}, { difficulty: 'x' })), FREE);
    expect(r.issues[0].item_ref).toBe('mcq#1');
    expect(r.issues[0].check).toBe('tag-complete');
  });
  test('LO-exists and page-in-range are skipped, listed', () => {
    const r = m.run(wrap(mcq()), cell());
    expect(r.skipped.map((s) => s.id)).toEqual(expect.arrayContaining(['tag-complete:lo-exists', 'tag-complete:page-range']));
  });
});
