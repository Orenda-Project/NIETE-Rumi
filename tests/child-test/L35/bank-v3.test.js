/**
 * Item bank v3 (CONTRACT §21.3, bd-s1oo0.50.1): the full EGRA/EGMA battery, every item cited to the
 * May 2026 RWP instrument or an official RTI/USAID source. Nothing is authored; a slot with no source
 * is `{ gap: true, reason }`. This validator is the guard on that promise.
 */
const T = require('../../../bot/shared/services/child-test/tasks');
const IB = require('../../../bot/shared/services/child-test/item-bank');

const bank = IB.bankV3();
const READING_KINDS = ['listening', 'letters', 'nonwords', 'words', 'story'];
const MATHS_KINDS = ['number_id', 'discrimination', 'missing', 'add1', 'sub1', 'add2', 'sub2', 'word_problems'];
const QUALITY = ['ai', 'ai_review', 'provisional'];
const STOP_TYPES = ['first_row', 'first_line', 'consecutive_errors', 'none'];

// The §2 table of design/COACH_JOURNEY_V3.md: item count, timing, stop rule, items per printed row.
const TABLE = {
  listening: { n: 6, timed_s: null, stop: { type: 'none' } },
  letters: { n: 100, timed_s: 60, stop: { type: 'first_row', n: 10 }, per_row: 10 },
  nonwords: { n: 50, timed_s: 60, stop: { type: 'first_row', n: 5 }, per_row: 5 },
  words: { n: 50, timed_s: 60, stop: { type: 'first_row', n: 5 }, per_row: 5 },
  story: { n: 60, timed_s: 60, stop: { type: 'first_line' } },
  number_id: { n: 20, timed_s: 60, stop: { type: 'none' } },
  discrimination: { n: 10, timed_s: null, stop: { type: 'consecutive_errors', n: 4 }, practice: 2 },
  missing: { n: 10, timed_s: null, stop: { type: 'consecutive_errors', n: 4 }, practice: 2 },
  add1: { n: 20, timed_s: 60, stop: { type: 'none' } },
  sub1: { n: 20, timed_s: 60, stop: { type: 'none' } },
  add2: { n: 5, timed_s: null, stop: { type: 'consecutive_errors', n: 4 } },
  sub2: { n: 5, timed_s: null, stop: { type: 'consecutive_errors', n: 4 } },
  word_problems: { n: 6, timed_s: null, stop: { type: 'consecutive_errors', n: 4 } },
};

const sourceKey = (ref) => String(ref || '').split(':')[0];

/** Every string anywhere under x, with its path, so "no empty strings" is checked everywhere. */
function strings(x, path = '$', out = []) {
  if (typeof x === 'string') out.push([path, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => strings(v, `${path}.${k}`, out));
  return out;
}

/** [grade, taskId, spec] for every task slot the bank serves (reading is shared, so asked per grade). */
function allSlots() {
  const out = [];
  for (const grade of ['3', '5']) for (const task of T.TASKS_V3) out.push([grade, task, IB.getTaskSpec({ grade, set: 'A', task })]);
  return out;
}

describe('item bank v3: shape (§21.3)', () => {
  it('is versioned and lists its sources with a title and url', () => {
    expect(bank.version).toBe('child-test-items-v3');
    expect(Object.keys(bank.sources).length).toBeGreaterThan(0);
    for (const [key, s] of Object.entries(bank.sources)) {
      expect({ key, title: typeof s.title, url: typeof s.url }).toEqual({ key, title: 'string', url: 'string' });
    }
  });

  it('has set A with a term label, one reading form per language and maths per grade', () => {
    const A = bank.sets.A;
    expect(A.term.en && A.term.ur).toBeTruthy();
    expect(Object.keys(A.reading).sort()).toEqual(['en', 'ur']);
    expect(Object.keys(A.maths).sort()).toEqual(['3', '5']);
    for (const lang of ['ur', 'en']) expect(Object.keys(A.reading[lang]).sort()).toEqual([...READING_KINDS].sort());
    for (const g of ['3', '5']) {
      for (const k of MATHS_KINDS) expect(A.maths[g][k]).toBeTruthy();
      expect(A.maths[g].skip_level2_if_level1_zero).toBe(true);
    }
  });

  it('contains no empty strings anywhere', () => {
    const empty = strings(bank).filter(([, s]) => s.trim() === '');
    expect(empty).toEqual([]);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(bank)).toBe(true);
    expect(Object.isFrozen(bank.sets.A.reading.ur.letters.items)).toBe(true);
  });
});

describe('item bank v3: accessor', () => {
  it('tasksFor returns the 18 ids in visit order for either grade', () => {
    expect(IB.tasksFor({ grade: 3 })).toEqual([...T.TASKS_V3]);
    expect(IB.tasksFor({ grade: '5' })).toEqual([...T.TASKS_V3]);
    expect(() => IB.tasksFor({ grade: 4 })).toThrow(/grade/);
  });

  it('getTaskSpec serves reading from the shared form and maths from the grade form', () => {
    const ur3 = IB.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' });
    const ur5 = IB.getTaskSpec({ grade: 5, set: 'A', task: 'ur.story' });
    expect(ur3).toBe(ur5);
    expect(ur3).toBe(bank.sets.A.reading.ur.story);
    expect(IB.getTaskSpec({ grade: 5, task: 'ma.add1' })).toBe(bank.sets.A.maths['5'].add1);
  });

  it('getTaskSpec defaults to set A and rejects unknown tasks, grades and sets', () => {
    expect(IB.getTaskSpec({ grade: 3, task: 'en.letters' })).toBe(bank.sets.A.reading.en.letters);
    expect(() => IB.getTaskSpec({ grade: 3, task: 'urdu' })).toThrow(/task/);
    expect(() => IB.getTaskSpec({ grade: 6, task: 'ur.story' })).toThrow(/grade/);
    expect(() => IB.getTaskSpec({ grade: 3, set: 'Z', task: 'ur.story' })).toThrow(/set/);
  });

  it('leaves the v1/v2 accessors alone', () => {
    expect(IB.version).toBe('child-test-items-v2');
    expect(IB.getItem('u3A-q1')).toBeTruthy();
  });
});

describe('item bank v3: every slot is sourced or an honest gap', () => {
  it('gap slots carry a reason and nothing else pretending to be content', () => {
    for (const [grade, task, spec] of allSlots()) {
      if (!spec.gap) continue;
      expect({ grade, task, reason: typeof spec.reason, items: spec.items }).toEqual({ grade, task, reason: 'string', items: undefined });
      expect(spec.reason.length).toBeGreaterThan(20);
    }
  });

  it('every task cites a source key that resolves, for items, practice and script', () => {
    for (const [grade, task, spec] of allSlots()) {
      if (spec.gap) continue;
      for (const part of ['items', 'script']) {
        const ref = spec.source && spec.source[part];
        expect({ grade, task, part, resolves: Boolean(ref && bank.sources[sourceKey(ref)]) }).toEqual({ grade, task, part, resolves: true });
      }
      if (spec.practice.length) {
        const ref = spec.source.practice;
        expect({ grade, task, practice: Boolean(ref && bank.sources[sourceKey(ref)]) }).toEqual({ grade, task, practice: true });
      }
    }
  });

  it('every object item and every question cites a source that resolves', () => {
    for (const [grade, task, spec] of allSlots()) {
      if (spec.gap) continue;
      const objs = [...spec.items.filter((i) => i && typeof i === 'object'), ...(spec.questions || [])];
      for (const it of objs) {
        if (it.source == null && !(spec.questions || []).includes(it)) continue; // object items may inherit the task source
        expect({ grade, task, id: it.id || it.i, resolves: Boolean(bank.sources[sourceKey(it.source)]) }).toEqual({ grade, task, id: it.id || it.i, resolves: true });
      }
    }
  });
});

describe('item bank v3: counts, timing and stop rules match the §2 table', () => {
  it('every non-gap task has the right count, timing, stop rule, quality and title', () => {
    for (const [grade, task, spec] of allSlots()) {
      if (spec.gap) continue;
      const kind = T.kindOf(task);
      const want = TABLE[kind];
      expect(spec.task).toBe(task);
      expect(spec.title.en && spec.title.ur).toBeTruthy();
      expect(QUALITY).toContain(spec.quality);
      expect(STOP_TYPES).toContain(spec.stop.type);
      expect({ task, grade, timed_s: spec.timed_s, stop: spec.stop }).toEqual({ task, grade, timed_s: want.timed_s, stop: want.stop });
      const n = kind === 'listening' ? spec.questions.length : kind === 'story' ? spec.story.tokens.length : spec.items.length;
      expect({ task, grade, n }).toEqual({ task, grade, n: want.n });
      if (want.per_row) expect({ task, per_row: spec.per_row }).toEqual({ task, per_row: want.per_row });
      if (want.practice) expect({ task, grade, practice: spec.practice.length }).toEqual({ task, grade, practice: want.practice });
      expect(Array.isArray(spec.practice)).toBe(true);
    }
  });

  it('timed tasks have a begin line in both languages for the clock cue', () => {
    for (const [, task, spec] of allSlots()) {
      if (spec.gap || spec.timed_s !== 60) continue;
      expect({ task, en: Boolean(spec.script.begin && spec.script.begin.en), ur: Boolean(spec.script.begin && spec.script.begin.ur) })
        .toEqual({ task, en: true, ur: true });
    }
  });

  it('every script line has both coach languages', () => {
    for (const [, task, spec] of allSlots()) {
      if (spec.gap) continue;
      for (const [key, line] of Object.entries(spec.script)) {
        expect({ task, key, en: typeof line.en, ur: typeof line.ur }).toEqual({ task, key, en: 'string', ur: 'string' });
      }
    }
  });
});

describe('item bank v3: reading', () => {
  it('reading is one form for Grades 3 and 5', () => {
    for (const lang of ['ur', 'en']) {
      for (const kind of READING_KINDS) {
        expect(IB.getTaskSpec({ grade: 3, task: `${lang}.${kind}` })).toBe(IB.getTaskSpec({ grade: 5, task: `${lang}.${kind}` }));
      }
    }
  });

  it('story lines tile the tokens and every question carries needs_line within them', () => {
    for (const lang of ['ur', 'en']) {
      const s = bank.sets.A.reading[lang].story;
      const lines = s.story.lines;
      expect(lines[0].from).toBe(0);
      expect(lines[lines.length - 1].to).toBe(s.story.tokens.length - 1);
      lines.forEach((l, i) => { expect(l.n).toBe(i + 1); if (i) expect(l.from).toBe(lines[i - 1].to + 1); });
      expect(s.questions).toHaveLength(6);
      for (const q of s.questions) {
        expect(Number.isInteger(q.needs_line) && q.needs_line >= 1 && q.needs_line <= lines.length).toBe(true);
      }
    }
  });

  it('every question has a prompt, type, rubric and at least one accepted answer', () => {
    for (const lang of ['ur', 'en']) {
      for (const kind of ['listening', 'story']) {
        const ids = new Set();
        for (const q of bank.sets.A.reading[lang][kind].questions) {
          expect(['literal', 'inferential']).toContain(q.type);
          expect(q.prompt && q.rubric && q.id).toBeTruthy();
          expect(q.accept.length).toBeGreaterThan(0);
          expect(Array.isArray(q.reject)).toBe(true);
          expect(ids.has(q.id)).toBe(false);
          ids.add(q.id);
        }
      }
    }
  });

  it('listening keeps its story text and RWP read_times; letters are names', () => {
    for (const lang of ['ur', 'en']) {
      const L = bank.sets.A.reading[lang].listening;
      expect(L.story.text.length).toBeGreaterThan(100);
      expect(L.read_times).toBe(2);
      expect(bank.sets.A.reading[lang].letters.kind).toBe('names');
    }
  });
});

describe('item bank v3: maths', () => {
  const answerOf = (expr) => {
    const m = /^(\d+)\s*([+-])\s*(\d+)$/.exec(expr);
    return m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
  };

  it('number id items are numerals as printed', () => {
    for (const g of ['3', '5']) {
      for (const n of bank.sets.A.maths[g].number_id.items) expect(/^\d+$/.test(n)).toBe(true);
    }
  });

  it('discrimination answers are the bigger number; missing-number answers fill the one blank', () => {
    for (const g of ['3', '5']) {
      const D = bank.sets.A.maths[g].discrimination;
      if (!D.gap) for (const it of [...D.items, ...D.practice]) expect(it.answer).toBe(Math.max(it.a, it.b));
      const M = bank.sets.A.maths[g].missing;
      if (!M.gap) {
        for (const it of [...M.items, ...M.practice]) {
          expect(it.seq.filter((x) => x === null)).toHaveLength(1);
          const k = it.seq.indexOf(null);
          const full = it.seq.map((x, i) => (i === k ? it.answer : x));
          const step = full[1] - full[0];
          full.forEach((x, i) => { if (i) expect(x - full[i - 1]).toBe(step); });
        }
      }
    }
  });

  it('sums carry the right answer', () => {
    for (const g of ['3', '5']) {
      for (const k of ['add1', 'sub1', 'add2', 'sub2']) {
        const S = bank.sets.A.maths[g][k];
        for (const it of S.items) {
          expect(it.answer).toBe(answerOf(`${it.a}${k.startsWith('add') ? '+' : '-'}${it.b}`));
        }
      }
    }
  });

  it('word problems are read aloud in both languages, one per Core EGMA type', () => {
    for (const g of ['3', '5']) {
      const W = bank.sets.A.maths[g].word_problems;
      expect(new Set(W.items.map((w) => w.type)).size).toBe(6);
      for (const w of W.items) {
        expect(w.prompt_ur && w.prompt_en).toBeTruthy();
        expect(Number.isInteger(w.answer)).toBe(true);
      }
    }
  });

  it('every Grade 5 item that differs from Grade 3 cites its own source', () => {
    for (const k of ['discrimination', 'missing']) {
      const g3 = bank.sets.A.maths['3'][k].items;
      bank.sets.A.maths['5'][k].items.forEach((it, i) => {
        if (JSON.stringify({ ...it, source: undefined }) !== JSON.stringify({ ...g3[i], source: undefined })) {
          expect({ k, i, source: Boolean(it.source && bank.sources[sourceKey(it.source)]) }).toEqual({ k, i, source: true });
        }
      });
    }
  });

  it('Grade 3 maths is Core EGMA: shared timed runs are identical across grades', () => {
    for (const k of ['number_id', 'add1', 'sub1']) {
      expect(bank.sets.A.maths['5'][k].items).toEqual(bank.sets.A.maths['3'][k].items);
    }
    expect(bank.sets.A.maths['5'].discrimination.items.slice(0, 6)).toEqual(bank.sets.A.maths['3'].discrimination.items.slice(0, 6));
    expect(bank.sets.A.maths['5'].missing.items.slice(0, 6)).toEqual(bank.sets.A.maths['3'].missing.items.slice(0, 6));
  });
});
