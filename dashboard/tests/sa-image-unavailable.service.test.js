'use strict';
/**
 * A picture that will not load (offline, not on the phone) makes its item unanswerable: the task ends as
 * assets_unavailable and blank-tile taps never become scores (sa-core imageUnavailable(), sa-ui's <img> error).
 */
const { createRunner, STOP } = require('../sa/sa-core');

const pics = { a: 'sa/img/vocab/a.webp', x: 'sa/img/vocab/x.webp' };
const vocab = {
  id: 'ur.vocabulary', mode: 'tap', option_images: pics,
  items: [{ id: 'v1', target: 'a', options: ['a', 'x'] }, { id: 'v2', target: 'x', options: ['a', 'x'] }, { id: 'v3', target: 'a', options: ['a', 'x'] }],
};
const after = { id: 'letters', mode: 'tap', items: [{ id: 'l1', target: 'b', options: ['b', 'y'] }] };
const battery = () => ({ battery_id: 'pic', tasks: [JSON.parse(JSON.stringify(vocab)), after] });

function running() {
  const calls = [];
  const r = createRunner({ battery: battery(), onEvent: (e) => calls.push(e) });
  r.start(); r.instructionDone(); r.begin();
  return { r, calls };
}

test('core: a picture that fails ends the task as assets_unavailable; what was answered before is kept; no later tap counts', () => {
  const { r, calls } = running();
  expect(r.answer('a')).toBe(true);
  r.imageUnavailable('ur.vocabulary', 'v2');
  const v = r.view();
  expect(v.phase).toBe('task_end');
  expect(STOP.ASSETS).toBe('assets_unavailable');
  expect(v.result).toMatchObject({ task_id: 'ur.vocabulary', stop_reason: 'assets_unavailable', attempted: 1, correct: 1 });
  expect(calls.find((e) => e.type === 'image_unavailable')).toMatchObject({ task_id: 'ur.vocabulary', item_id: 'v2' });
  expect(r.answer('x')).toBeUndefined();
  r.next();
  expect(r.view().task.id).toBe('letters');
});

test('core: a late error from another task\'s picture is ignored', () => {
  const { r } = running();
  r.imageUnavailable('some.other.task', 'v1');
  expect(r.view().phase).toBe('running');
});

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui on a DOM', () => {
  let dom;
  const keep = {};
  const views = [];
  const keepView = (v) => { views.push(v); return v; };
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  test('an <img> error on a picture tile: no tap registers, the task says why', () => {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const calls = [];
    const runner = core.createRunner({ battery: battery(), onEvent: (e) => calls.push(e) });
    const el = document.getElementById('m');
    const view = keepView(ui.mount(el, { runner, battery: battery(), lang: 'ur', mode: 'game', speak: () => Promise.resolve() }));
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    const img = el.querySelector('img.sae-opt-img');
    expect(img).not.toBeNull();
    const tile = img.closest('button');
    img.dispatchEvent(new dom.window.Event('error'));
    tile.click();
    expect(calls.filter((e) => e.type === 'tap')).toHaveLength(0);
    expect(runner.results()[0]).toMatchObject({ task_id: 'ur.vocabulary', stop_reason: 'assets_unavailable', attempted: 0 });
    // the task end is not a celebration: no "well done" for a task the child could not do
    expect(el.getAttribute('data-phase')).toBe('task_end');
    expect(el.querySelector('.sae-tend h1')).toBeNull();
    view.destroy();
  });
});
