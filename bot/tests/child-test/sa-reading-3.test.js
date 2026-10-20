'use strict';

/**
 * SA reading extras, part 3: English dictation as typed spelling (TK2009 sentence), Urdu picture vocabulary (SELECT
 * 2024 cards), and orientation to print asked on the passage each Grade 1-3 form shows next.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../../..');
const DATA = path.join(__dirname, '../../shared/data/child-test');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');
const core = require('../../../dashboard/sa/sa-core.js');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const bank = read('item-bank.sa.v1.json');

describe('SA dictation, vocabulary, orientation to print', () => {
  test('en.dictation: the TK2009 sentence word by word on the keyboard, said word-sentence-word, rubric kept', () => {
    const t = bank.tasks['coach.G5.A/en.dictation'];
    const words = extra.reading.en.dictation.sentence.replace(/\.$/, '').split(' ');
    expect(t.tap.input).toBe('keyboard');
    expect(t.tap.items.map((i) => i.target)).toEqual(words.map((w) => w.toLowerCase()));
    expect(t.tap.items[3].say.text).toBe('shop. Go to the shop and buy some rice and sugar. shop.');
    expect(t.rubric.rows).toEqual(extra.reading.en.dictation.rubric);
    const b = read('sa/sa.coach.G5.A.ur.json');
    expect(b.tasks.find((x) => x.id === 'en.dictation').response).toBe('keyboard');
    expect(core.validate(b)).toBe(true);
  });

  test('ur.vocabulary: Jugnu says the SELECT keyed sentence, the child taps 1 of 4 SELECT pictures, every picture served', () => {
    const t = bank.tasks['game.G23/ur.vocabulary'];
    const src = extra.reading.ur.vocabulary.items;
    expect(t.tap.items.map((i) => i.say.text)).toEqual(src.map((x) => x.say));
    for (const it of [...t.tap.items, ...t.practice]) {
      expect(it.options).toHaveLength(4);
      expect(it.options).toContain(it.target);
      for (const o of it.options) expect(fs.existsSync(path.join(ROOT, 'dashboard', t.tap.option_images[o]))).toBe(true);
    }
    expect(t.tap.stop).toEqual({ type: 'first_row', n: 5 });
    expect(t.practice.map((p) => p.say.text)).toEqual(['سورج نکل رہا ہے', 'ریل گاڑی آ رہی ہے']);
    expect(bank.forms['coach.G3.A'].blocks.B3[0]).toBe('ur.vocabulary');
  });

  test('orientation to print: Grades 1-3 only, before the story, on the passage that follows; targets from that passage', () => {
    expect(bank.forms['coach.G5.A'].full.some((x) => /print_orientation/.test(x))).toBe(false);
    expect(bank.forms['game.G45'].islands.urdu.some((x) => /print_orientation/.test(x))).toBe(false);
    const c = bank.forms['coach.G3.A'];
    expect(c.blocks.B1.indexOf('ur.print_orientation')).toBe(c.blocks.B1.indexOf('ur.story') - 1);
    const g = bank.forms['game.G1'];
    expect(g.islands.english.indexOf('en.print_orientation')).toBe(g.islands.english.indexOf('en.story2') - 1);
    const coachUr = bank.tasks['coach.G3.A/ur.print_orientation'];
    const story = bank.tasks['coach.G3.A/ur.story'].record.passage.words;
    expect(coachUr.tap.items).toHaveLength(extra.reading.ur.print_orientation.prompts.length);
    expect(coachUr.tap.items[0].target).toBe(story[0].target);
    expect(coachUr.tap.items[1].target).toBe('←');
    expect(coachUr.tap.items[4].target_index).toBe(story.length - 1);
    const gameEn = bank.tasks['game.G1/en.print_orientation'];
    const s2 = bank.tasks['game.G1/en.story2'].record.passage;
    expect(gameEn.tap.items[2].target_index).toBe(s2.lines[1].from);
    expect(gameEn.tap.items[1].target).toBe('→');
    expect(read('sa/sa.game.G1.en.json').tasks.find((x) => x.id === 'en.print_orientation').tap_on).toBe('passage');
  });
});
