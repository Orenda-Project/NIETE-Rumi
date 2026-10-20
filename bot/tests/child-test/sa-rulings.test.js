'use strict';

/**
 * lead-egra-2's RULINGs #13, #16 and #17 in the SA bank: Design A's blocks hold the 18 v3 tasks only; tap first-row
 * stops at chance; missing number typed at Grade 5; sums spoken only on replay; the spelling task; the engine's new
 * lines (oral practice, mic check, mercy, voice not ready, keypad warm-up) in both languages.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const { TASKS_V3 } = require('../../shared/services/child-test/tasks');
const core = require('../../../dashboard/sa/sa-core.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const bank = read('item-bank.sa.v1.json');
const runtime = (f) => read(`sa/${f}`);
const task = (b, id) => b.tasks.find((t) => t.id === id);

describe('SA bank: RULINGs #13, #16, #17', () => {
  test('#16: the coach blocks hold the 18 v3 tasks only (plus their story questions)', () => {
    for (const id of ['coach.G3.A', 'coach.G5.A']) {
      const blocks = Object.values(bank.forms[id].blocks).flat();
      expect(blocks.filter((t) => !TASKS_V3.includes(t)).sort()).toEqual(['en.story_comp', 'ur.story_comp']);
      expect(TASKS_V3.every((t) => blocks.includes(t))).toBe(true);
    }
  });

  test('#17 ⚠4: tap first-row stops at chance (letters ≤ 2 of 10, words and made-up words ≤ 1 of 5); the record side keeps EGRA\'s', () => {
    const b = runtime('sa.coach.G3.A.ur.json');
    for (const id of ['ur.letters', 'en.letters', 'en.letter_sounds']) expect(task(b, id).stop).toEqual({ first_line_n: 10, first_line_min_correct: 3, max_correct: 2 });
    for (const id of ['ur.words', 'ur.nonwords', 'en.words', 'en.nonwords']) expect(task(b, id).stop).toEqual({ first_line_n: 5, first_line_min_correct: 2, max_correct: 1 });
    expect(task(b, 'ma.number_id').stop).toEqual({});
    expect(bank.tasks['coach.G3.A/ur.letters'].record.stop).toEqual({ type: 'first_row', n: 10 });
    expect(bank.tasks['coach.G3.A/ur.letters'].deviation).toMatch(/chance/);
  });

  test('#17 M3: missing number is a tap at Grades 1-3 and typed at Grades 4-5, with its two practice items', () => {
    for (const f of ['sa.coach.G3.A.ur.json', 'sa.game.G1.en.json', 'sa.game.G23.ur.json']) expect([f, task(runtime(f), 'ma.missing').response]).toEqual([f, 'tap']);
    for (const f of ['sa.coach.G5.A.ur.json', 'sa.game.G45.en.json']) {
      const t = task(runtime(f), 'ma.missing');
      expect([f, t.response]).toEqual([f, 'keypad']);
      expect(t.practice).toHaveLength(2);
      expect(core.validate(runtime(f))).toBe(true);
    }
  });

  test('#17 ⚠5: sums are shown, and spoken only on the replay tile', () => {
    const b = runtime('sa.coach.G5.A.en.json');
    for (const id of ['ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.fluency_l34']) expect([id, task(b, id).say_on]).toEqual([id, 'replay']);
    expect(task(b, 'ma.word_problems').say_on).toBeUndefined();
  });

  test('lead 181537: patterns stop after 4 consecutive errors; the SA time rules are data on every phone-scored task', () => {
    for (const f of ['sa.coach.G3.A.ur.json', 'sa.coach.G5.A.en.json', 'sa.game.G1.ur.json', 'sa.game.G45.en.json']) {
      const b = runtime(f);
      for (const id of ['ma.patterns', 'ma.patterns_hi']) expect([f, id, task(b, id).stop]).toEqual([f, id, { consecutive_errors: 4 }]);
      for (const t of b.tasks.filter((x) => ['tap', 'keypad', 'keyboard'].includes(x.response))) {
        if (t.time_limit_s) {
          expect([f, t.id, t.replay_at_s, t.item_timeout_s]).toEqual([f, t.id, 5, 10]);
        } else {
          expect([f, t.id, t.next_at_s]).toEqual([f, t.id, 15]);
          const cap = /^ma\.word_problems/.test(t.id) ? 60 : null;
          expect([f, t.id, t.item_timeout_s]).toEqual([f, t.id, cap]);
        }
      }
    }
  });

  test('E15: the spelling task is en.spelling (keyboard), letter-level partial credit, the TK2009 rubric kept', () => {
    const t = bank.tasks['game.G23/en.spelling'];
    expect(t.subtask).toBe('spelling');
    expect(t.tap.input).toBe('keyboard');
    expect(t.scoring).toMatch(/letters \+ 2/);
    expect(t.rubric.rows.length).toBeGreaterThan(0);
    expect(bank.forms['game.G23'].islands.english).toContain('en.spelling');
    expect(Object.keys(bank.tasks).some((k) => k.endsWith('/en.dictation'))).toBe(false);
  });

  test('#13/#10/#14/#17: the engine\'s new lines exist in both languages; game copy has no test word', () => {
    for (const k of ['oral_practice', 'oral_heard', 'mic_check', 'mic_check_ask', 'mercy', 'voice_not_ready', 'keypad_warmup', 'done']) {
      for (const f of ['sa.coach.G3.A.ur.json', 'sa.game.G1.en.json']) {
        const l = runtime(f).lines[k];
        expect([f, k, typeof l.text, /^sa\/v1\/(ur|en)\//.test(l.audio)]).toEqual([f, k, 'string', true]);
      }
    }
    expect(runtime('sa.coach.G3.A.ur.json').lines.oral_heard.text).toBe('مجھے سنائی دیا!');
  });

  test('native review (URDU_REVIEW.md): "not quite" is not "not now"; ٹیچر not استاد; orientation prompts without گے aimed at the child', () => {
    // Jugnu's lines only: an official story may say استاد and stays verbatim.
    const all = JSON.stringify([bank.lines, Object.values(bank.tasks).map((t) => t.script)]);
    expect(all.includes('ابھی نہیں۔ دوبارہ سنیں')).toBe(false);
    expect(all.includes('استاد')).toBe(false);
    for (const it of bank.tasks['coach.G3.A/ur.print_orientation'].tap.items.slice(0, 3)) expect(/گے[؟۔]?/.test(it.say.text)).toBe(false);
  });
});
