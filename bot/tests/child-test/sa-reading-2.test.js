'use strict';

/**
 * SA reading extras, part 2: the official second passages and listening stories run on the game's islands in place
 * of the coach's Set A ones (the coach measure is not practised at home), English phoneme segmentation is recorded
 * per word, and the game's lines carry no test words and no teacher.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const bank = read('item-bank.sa.v1.json');
const ends = (lines) => lines.map((l) => l.to + 1);

describe('SA second passages and stories', () => {
  test('game islands read the second passage and story; the coach and the tower keep Set A', () => {
    for (const id of ['game.G1', 'game.G23', 'game.G45']) {
      const g = bank.forms[id];
      expect(g.islands.english).toEqual(expect.arrayContaining(['en.listening2', 'en.story2', 'en.story2_comp']));
      expect(g.islands.urdu).toEqual(expect.arrayContaining(['ur.listening2', 'ur.story2', 'ur.story2_comp']));
      for (const set of ['en.story', 'en.story_comp', 'en.listening', 'ur.story', 'ur.story_comp', 'ur.listening']) {
        expect([id, Object.values(g.islands).flat().includes(set)]).toEqual([id, false]);
      }
      expect(g.tower).toEqual(expect.arrayContaining(['ur.story', 'en.story', 'ur.listening', 'en.listening']));
    }
    for (const id of ['coach.G3.A', 'coach.G5.A']) {
      expect(bank.forms[id].full.filter((t) => /2(_comp)?$/.test(t) && /story|listening/.test(t))).toEqual([]);
    }
  });

  test('ur.story2 (SELECT 2024): 60 words, lines ending at the printed markers, questions up to their marker', () => {
    const t = bank.tasks['game.G23/ur.story2'];
    expect(t.record.passage.words).toHaveLength(60);
    expect(ends(t.record.passage.lines)).toEqual(extra.reading.ur.story2.segments.map((x) => x.cum_marker));
    expect(t.record.stop).toEqual({ type: 'first_line', n: 9 });
    expect(t.legacy_block).toBe('ur.story');
    const c = bank.tasks['game.G23/ur.story2_comp'];
    expect(c.record.questions.map((q) => q.prompt.text)).toEqual(extra.reading.ur.story2.questions.map((q) => q.q));
    expect(c.record.questions.map((q) => q.needs_line)).toEqual([1, 2, 3, 4, 5]);
    expect(c.depends_on.task).toBe('ur.story2');
  });

  test('en.story2 (TK2009): 60 words, lines ending at 16/31/45/60, questions on their printed line', () => {
    const t = bank.tasks['game.G45/en.story2'];
    expect(t.record.passage.words).toHaveLength(60);
    expect(ends(t.record.passage.lines)).toEqual([16, 31, 45, 60]);
    const c = bank.tasks['game.G45/en.story2_comp'];
    expect(c.record.questions.map((q) => q.needs_line)).toEqual(extra.reading.en.story2.questions.map((q) => q.needs_line));
  });

  test('listening 2: the official story, read once, its questions verbatim', () => {
    for (const lang of ['en', 'ur']) {
      const t = bank.tasks[`game.G1/${lang}.listening2`];
      expect(t.record.passage.text).toBe(extra.reading[lang].listening2.story);
      expect(t.record.passage.read_times).toBe(1);
      expect(t.record.questions.map((q) => q.prompt.text)).toEqual(extra.reading[lang].listening2.questions.map((q) => q.q));
    }
  });
});

describe('SA segmentation and game lines', () => {
  test('en.segmentation: 10 TK2009 words, each said twice, the printed phonemes as the key, practice modelled', () => {
    const t = bank.tasks['coach.G3.A/en.segmentation'];
    expect(t.record.questions.map((q) => q.word)).toEqual(extra.reading.en.segmentation.items.map((w) => w.word));
    for (const q of t.record.questions) expect(q.prompt.text.split(`"${q.word}"`)).toHaveLength(3);
    expect(t.record.questions[8].phonemes).toEqual(['/f/', '/i/', '/sh/']);
    expect(t.script.practice_models).toHaveLength(2);
    expect(bank.forms['coach.G3.A'].full).toContain('en.segmentation');
  });

  test('game batteries: no test word, no teacher; coach batteries keep the coach lines', () => {
    for (const f of ['sa.game.G1.ur.json', 'sa.game.G23.en.json', 'sa.game.G45.ur.json']) {
      const b = read(`sa/${f}`);
      const text = [b.lines.welcome.text, b.lines.end.text, ...b.tasks.map((t) => t.script.hand_back.text)].join(' ');
      expect([f, /امتحان|\btest\b|استاد|teacher/i.test(text)]).toEqual([f, false]);
    }
    expect(read('sa/sa.coach.G3.A.ur.json').lines.end.text).toMatch(/استاد/);
  });
});
