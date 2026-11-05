'use strict';
/**
 * G6-12 question types (contract 5, question-types.md §4) and the three grade >= 6 guard lines in
 * question-types.js. Grades 1-5 must answer exactly as before (snapshot taken before the guards).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const QT = require('../../bot/shared/services/assessment/question-types');
const Q6 = require('../../bot/shared/services/assessment/question-types-6-12');
const CONTRACT = require('./fixtures/g612/question-types-6-12.contract.json');
const REGISTRY = require('./fixtures/g612/subject-config.contract.json');
const G15 = require('./fixtures/g612/question-types-g1-5.snapshot.json');

const byId = Object.fromEntries(CONTRACT.types.map((t) => [t.id, t]));
const core = REGISTRY.rows.filter((r) => r.status === 'core');
const ids = (list) => list.map((t) => t.id);

describe('catalogue data', () => {
  it('is the contract file', () => {
    expect(Q6.DATA).toEqual(CONTRACT);
  });

  it('every type_sets id exists, is flow_selectable and allowed in that band', () => {
    for (const [set, bands] of Object.entries(CONTRACT.type_sets)) {
      for (const [band, list] of Object.entries(bands)) {
        for (const id of list) {
          expect([set, band, id, Boolean(byId[id])]).toEqual([set, band, id, true]);
          expect(byId[id].flow_selectable).toBe(true);
          expect(byId[id].bands).toContain(band);
        }
      }
    }
  });

  it('every core registry row has a type set for its band', () => {
    for (const r of core) expect(CONTRACT.type_sets[r.type_set][r.band]).toBeDefined();
  });

  it('dialogue, programme, map_free_geo and practical are never offered', () => {
    const all = Object.values(CONTRACT.type_sets).flatMap((b) => Object.values(b).flat());
    for (const id of ['dialogue', 'programme', 'map_free_geo', 'practical']) expect(all).not.toContain(id);
    for (const r of core) {
      const offered = ids(Q6.forSubject(r.code, r.grade));
      for (const id of ['dialogue', 'programme', 'map_free_geo', 'practical']) expect(offered).not.toContain(id);
    }
  });

  it('a non-null marks_default cites a source; a null one says why', () => {
    for (const t of CONTRACT.types) {
      if (t.marks_default !== null) expect(String(t.source || '').length).toBeGreaterThan(0);
      else expect(Boolean(t.design_pending || t.marks_range || t.id === 'board_paper')).toBe(true);
    }
  });

  it('every Urdu title is non-empty and the file flags them for review', () => {
    expect(CONTRACT.urdu_review).toMatch(/needs fluent-Urdu review/);
    for (const t of [...CONTRACT.types, ...CONTRACT.kinds]) expect(String(t.title_ur || '').trim()).not.toBe('');
  });
});

describe('forSubject(subject, grade) for grade >= 6', () => {
  it('puts board_paper first for a board cell', () => {
    const list = Q6.forSubject('physics', 10);
    expect(list[0]).toEqual({ id: 'board_paper', category: 'board' });
    expect(ids(list).slice(1)).toEqual(CONTRACT.type_sets.science['9_10']);
  });

  it('a term cell (G10 islamiat) also opens with board_paper', () => {
    expect(ids(Q6.forSubject('islamiat', 10))[0]).toBe('board_paper');
  });

  it('a free_only cell has no board_paper', () => {
    expect(ids(Q6.forSubject('urdu', 7))).toEqual(CONTRACT.type_sets.urdu['6_8']);
    expect(ids(Q6.forSubject('computer_science', 9))).not.toContain('board_paper');
  });

  it('every core cell: board_paper iff board/term, then its type set with categories', () => {
    for (const r of core) {
      const list = Q6.forSubject(r.code, r.grade);
      const board = ['board', 'term'].includes(r.board_mode);
      const want = [...(board ? ['board_paper'] : []), ...CONTRACT.type_sets[r.type_set][r.band]];
      expect(ids(list)).toEqual(want);
      for (const t of list) expect(t.category).toBe(byId[t.id].category);
    }
  });

  it('an unknown or pending cell offers nothing (never the English default)', () => {
    expect(Q6.forSubject('science', 7)).toEqual([]);
    expect(Q6.forSubject('physics', 12)).toEqual([]);
    expect(Q6.forSubject('tarjuma_quran', 6)).toEqual([]);
  });

  it('QuestionTypes.forSubject routes grade >= 6 here', () => {
    expect(QT.forSubject('physics', 10)).toEqual(Q6.forSubject('physics', 10));
    expect(QT.forSubject('english', '6')).toEqual(Q6.forSubject('english', 6));
  });

  it('kindsFor lists the flow-selectable kinds for the cell type set', () => {
    expect(Q6.kindsFor('physics', 10)).toEqual(['numerical', 'define', 'differentiate', 'reason', 'derivation']
      .filter((k) => CONTRACT.kinds.find((x) => x.id === k && x.flow_selectable
        && (x.type_sets === 'all' || x.type_sets.includes('science')))));
    expect(Q6.kindsFor('english', 9)).not.toContain('numerical');
    expect(Q6.kindsFor('science', 7)).toEqual([]);
  });
});

describe('categoryOf / withCounts / defaultMix for grade >= 6', () => {
  it('mcq is objective, srq subjective, board_paper board (via QuestionTypes too)', () => {
    expect(QT.categoryOf('mcq', 'physics', 10)).toBe('objective');
    expect(QT.categoryOf('srq', 'physics', 10)).toBe('subjective');
    expect(Q6.categoryOf('board_paper', 'physics', 10)).toBe('board');
    expect(Q6.categoryOf('scenario', 'maths', 11)).toBe('objective');
    expect(Q6.categoryOf('nope', 'maths', 11)).toBe('subjective');
  });

  it('withCounts spreads the remainder to the earlier types', () => {
    expect(QT.withCounts(['mcq', 'srq', 'erq'], 10, 'physics', 10)).toEqual([
      { id: 'mcq', count: 4, category: 'objective' },
      { id: 'srq', count: 3, category: 'subjective' },
      { id: 'erq', count: 3, category: 'subjective' },
    ]);
    expect(Q6.withCounts(['mcq'], 0, 'physics', 10)).toEqual([{ id: 'mcq', count: 1, category: 'objective' }]);
    expect(Q6.withCounts(['mcq', 'srq'], 1, 'physics', 10).map((t) => t.count)).toEqual([1, 1]);
    expect(Q6.withCounts([null, 'mcq', ''], 'x', 'physics', 10)).toEqual([{ id: 'mcq', count: 1, category: 'objective' }]);
  });

  it('defaultMix is one objective and one subjective type, all enum ids', () => {
    expect(QT.defaultMix('physics', 10, 15)).toEqual([
      { id: 'mcq', count: 8, category: 'objective' },
      { id: 'srq', count: 7, category: 'subjective' },
    ]);
    expect(ids(Q6.defaultMix('english', 9, 10))).toEqual(['mcq', 'comprehension']);
    expect(Q6.withCounts([], 10, 'english', 9)).toEqual(Q6.defaultMix('english', 9, 10));
    for (const r of core) {
      const mix = Q6.defaultMix(r.code, r.grade, 12);
      expect(mix.length).toBeGreaterThan(0);
      for (const t of mix) {
        expect(byId[t.id]).toBeDefined();
        expect(t.id).not.toBe('board_paper');
      }
    }
    expect(Q6.defaultMix('science', 7, 10)).toEqual([]);
  });

  it('parsePerTypeCounts classifies a G10 mcq as objective', () => {
    const r = QT.parsePerTypeCounts(['mcq', 'srq'], { count_1: '5', count_2: '3' }, 'physics', 10);
    expect(r.ok).toBe(true);
    expect(r.types.map((t) => t.category)).toEqual(['objective', 'subjective']);
  });
});

describe('titleOf / isSecondary', () => {
  it('titles come from the catalogue, in English or Urdu', () => {
    expect(Q6.titleOf('board_paper')).toBe(byId.board_paper.title_en);
    expect(Q6.titleOf('mcq', 'ur')).toBe(byId.mcq.title_ur);
    expect(Q6.titleOf('numerical', 'en')).toBe(CONTRACT.kinds.find((k) => k.id === 'numerical').title_en);
    expect(Q6.titleOf('nope')).toBe('nope');
  });

  it('isSecondary is grade >= 6', () => {
    expect([5, 6, '12', 'x', undefined].map(Q6.isSecondary)).toEqual([false, true, true, false, false]);
  });
});

describe('alias map (question-types.md §3)', () => {
  const same = ['mcq', 'srq', 'erq', 'essay', 'letter', 'grammar', 'comprehension', 'fill_blank', 'translation',
    'practical', 'quran_passage', 'sequence', 'explanation_prose', 'explanation_poem', 'explanation_ghazal'];
  it.each(same)('%s stays itself', (s) => expect(Q6.normaliseType(s, 'science')).toEqual({ ok: true, id: s }));
  it.each([
    ['mcq_stimulus', 'scenario'], ['correct_sentence', 'true_false_correct'], ['sequence_text', 'sequence'],
    ['timeline_text', 'sequence'], ['tashreeh_prose', 'explanation_prose'], ['tashreeh_poem', 'explanation_poem'],
    ['tashreeh_ghazal', 'explanation_ghazal'],
  ])('%s -> %s', (s, id) => expect(Q6.normaliseType(s, 'urdu')).toEqual({ ok: true, id }));

  it('timeline depends on the type set', () => {
    expect(Q6.normaliseType('timeline', 'islamiat')).toEqual({ ok: true, id: 'erq' });
    expect(Q6.normaliseType('timeline', 'social')).toEqual({ ok: true, id: 'sequence' });
    expect(Q6.normaliseType('timeline', 'maths').ok).toBe(false);
  });

  it('other, unknown, board_paper and empty strings are rejected', () => {
    for (const s of ['other', 'picture_story', 'board_paper', '', null]) {
      const r = Q6.normaliseType(s, 'english');
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/TYPE_/);
    }
    expect(Q6.normaliseType(' MCQ ', 'english')).toEqual({ ok: true, id: 'mcq' });
  });

  it('kinds: only on srq/erq, only from the enum, null always allowed', () => {
    expect(Q6.kindAllowed(null, 'mcq')).toBe(true);
    expect(Q6.kindAllowed('numerical', 'srq')).toBe(true);
    expect(Q6.kindAllowed('derivation', 'erq')).toBe(true);
    expect(Q6.kindAllowed('numerical', 'mcq')).toBe(false);
    expect(Q6.kindAllowed('poetry', 'srq')).toBe(false);
  });
});

describe('grades 1-5 are untouched', () => {
  it('QuestionTypes answers every G1-5 call exactly as before the guards', () => {
    for (const s of G15) {
      const g = s.grade === '__undefined' ? undefined : s.grade;
      expect(QT.forSubject(s.subject, g)).toEqual(s.forSubject);
      for (const [id, cat] of Object.entries(s.categoryOf)) expect(QT.categoryOf(id, s.subject, g)).toBe(cat);
      expect(QT.defaultMix(s.subject, g, 15)).toEqual(s.defaultMix);
      expect(QT.withCounts(s.forSubject.slice(0, 3).map((t) => t.id), 10, s.subject, g)).toEqual(s.withCounts);
    }
  });

  it('question-types.js gains only the three guard lines (base sha256 with them removed)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/assessment/question-types.js'), 'utf8');
    const guard = /^ {2}if \(Number\(grade\) >= 6\) return require\('\.\/question-types-6-12'\)\.(forSubject|categoryOf|defaultMix)\(.*\);\n/gm;
    expect((src.match(guard) || []).length).toBe(3);
    const base = crypto.createHash('sha256').update(src.replace(guard, '')).digest('hex');
    expect(base).toBe('a981d07d71013d390c1d1b2b345cefdf297d861812b8d1de1c9c3c0aa713179a');
  });

  it('the 6-12 module answers nothing for grade <= 5', () => {
    expect(Q6.forSubject('english', 5)).toEqual([]);
    expect(Q6.kindsFor('maths', 3)).toEqual([]);
  });
});
