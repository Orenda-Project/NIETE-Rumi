'use strict';
/**
 * English and Urdu stay apart (dashboard/sa/sa-ui.js on the forms the server serves, bot/shared/data/child-test/sa).
 * For every sa.*.json form, on both page languages, every English task's items are walked on screen: no tile, label,
 * sequence or passage shows an Arabic-script letter, and no item Jugnu says has one. Every Urdu task: no Latin letter.
 * Every option tile carries the task's own lang, and its row the task's direction.
 * Not checked here: the page-language lines around an item (instructions, practice feedback) — on the Urdu page those
 * are Urdu by design, and a line naming an English item is split into two clips in the content build.
 * Runs where jsdom resolves (a portal dev dependency, not a dashboard one); skipped otherwise.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;
const files = fs.existsSync(FORMS) ? fs.readdirSync(FORMS).filter((f) => /^sa\..+\.(en|ur)\.json$/.test(f)).sort() : [];
const familyOf = (id) => (/^en\./.test(id) ? 'en' : /^ur\./.test(id) ? 'ur' : null);

maybe('sa-ui: English tasks show and say English only; Urdu tasks Urdu only', () => {
  let dom;
  const keep = {};
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  /** What the child sees of the item: tiles, label or sequence, the passage, the keypad's typed box. */
  function shown(el) {
    return [...el.querySelectorAll('.sae-opts .sae-opt, .sae-label, .sae-sum, .sae-passage')]
      .filter((n) => !n.querySelector('img'))
      .map((n) => n.textContent.trim()).filter(Boolean);
  }

  test('the forms are there', () => { expect(files.length).toBeGreaterThanOrEqual(10); });

  /** Walks every language task of a battery on screen → { bad[], walked }. */
  function walk(battery) {
    const pageLang = battery.lang === 'ur' ? 'ur' : 'en';
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const bad = [];
    let walked = 0;
    for (const task of battery.tasks) {
      const fam = familyOf(task.id);
      if (!fam) continue;
      const wrong = fam === 'en' ? ARABIC : LATIN;
      const said = [];
      const runner = core.createRunner({ battery: { battery_id: battery.battery_id, tasks: [task] }, mic: () => 'ok', onEvent: () => {} });
      const el = document.createElement('main');
      document.body.appendChild(el);
      // Only what Jugnu says for the item itself: an item line goes out as { text, lang } or as the item's prompt.
      const view = ui.mount(el, {
        runner, battery: { tasks: [task] }, lang: pageLang, mode: 'game',
        speak: (x) => { if (x && x.lang) said.push(x.text); return Promise.resolve(); },
      });
      const look = (where) => {
        for (const s of shown(el)) if (wrong.test(s)) bad.push(`${task.id} ${where} shows "${s.slice(0, 40)}"`);
        for (const s of said.splice(0)) if (typeof s === 'string' && wrong.test(s)) bad.push(`${task.id} ${where} says "${s.slice(0, 40)}"`);
        for (const b of el.querySelectorAll('.sae-opts .sae-opt')) {
          if (b.getAttribute('lang') !== fam) bad.push(`${task.id} ${where} tile lang=${b.getAttribute('lang')}`);
        }
        for (const row of el.querySelectorAll('.sae-opts')) {
          const dir = task.direction && task.direction !== 'ltr' ? task.direction : (fam === 'ur' ? 'rtl' : 'ltr');
          if (row.getAttribute('dir') !== dir) bad.push(`${task.id} ${where} row dir=${row.getAttribute('dir')}`);
        }
      };
      runner.start(); runner.instructionDone();
      let guard = 20;
      while (runner.view().phase === 'practice' && guard--) {
        view.render(); look('practice ' + runner.view().practice.id);
        runner.practiceAnswer(runner.view().practice.target);
      }
      runner.begin();
      guard = 200;
      while (runner.view().phase === 'running' && guard--) {
        const v = runner.view();
        view.render();
        look(v.item ? v.item.id : 'passage');
        walked++;
        if (v.task.mode === 'record') break;
        if (v.task.mode === 'oral') { runner.skip(); continue; }
        runner.answer(typeof v.item.target_index === 'number' ? v.item.target_index : v.item.target);
      }
      view.destroy();
      el.remove();
    }
    return { bad, walked };
  }

  test.each(files)('%s', (file) => {
    const battery = JSON.parse(fs.readFileSync(path.join(FORMS, file), 'utf8'));
    const { bad, walked } = walk(battery);
    expect(walked).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  test('the walk catches an Urdu letter in an English task (option, spoken item) and a Latin one in an Urdu task', () => {
    const battery = JSON.parse(fs.readFileSync(path.join(FORMS, 'sa.coach.G5.A.ur.json'), 'utf8'));
    const en = battery.tasks.find((t) => t.id === 'en.words');
    en.items[0].options[en.items[0].options.indexOf(en.items[0].target) === 0 ? 1 : 0] = 'بلی';
    en.items[1].say = 'یہ لفظ cat ہے';
    const ur = battery.tasks.find((t) => t.id === 'ur.words');
    ur.items[0].options[ur.items[0].options.indexOf(ur.items[0].target) === 0 ? 1 : 0] = 'cat';
    const { bad } = walk(battery);
    expect(bad.some((b) => /^en\.words .* shows ".*بلی/.test(b))).toBe(true);
    expect(bad.some((b) => /^en\.words .* says "یہ لفظ/.test(b))).toBe(true);
    expect(bad.some((b) => /^ur\.words .* shows ".*cat/.test(b))).toBe(true);
  });
});
