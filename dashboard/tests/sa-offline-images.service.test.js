'use strict';
/**
 * The offline copy keeps the battery's pictures too (sa-offline.js images(), prepare()): a child who loses the network
 * before a picture task still sees the pictures, and "ready" is said only when they are on the phone.
 */
const path = require('path');

const BATTERY = {
  tasks: [
    {
      id: 'ur.vocabulary',
      instruction: { audio: { ur: 'sa/v1/ur/aaa.mp3', en: 'sa/v1/en/bbb.mp3' } },
      script: { demo_image: { ur: 'sa/img/vocab/demo.ur.webp', en: 'sa/img/vocab/demo.en.webp' } },
      option_images: { a: 'sa/img/vocab/ur.vocabulary.01.webp', b: '/sa/img/vocab/ur.vocabulary.02.webp', c: '../etc/passwd', d: 'sa/img/vocab/ur.vocabulary.01.webp' },
      items: [{ prompt_audio: 'sa/v1/ur/ccc.mp3' }],
    },
    { id: 'ur.letters', script: { demo_image: 'sa/img/letters/demo.webp' }, option_images: null, items: [] },
  ],
};

function load(nav) {
  const prev = global.self;
  global.self = { navigator: nav, MessageChannel: FakeChannel };
  let mod;
  jest.isolateModules(() => { mod = require('../sa/sa-offline'); });
  global.self = prev;
  return mod;
}

function FakeChannel() {
  const port1 = {};
  this.port1 = port1;
  this.port2 = { postMessage(d) { port1.onmessage({ data: d }); } };
}

/** A worker that caches every URL except those in `fail`, and records each list it was asked for. */
function worker(fail = []) {
  const asked = [];
  const sw = {
    postMessage(msg, [port]) {
      asked.push(msg.urls);
      const missing = msg.urls.filter((u) => fail.includes(u));
      port.postMessage({ ok: missing.length === 0, cached: msg.urls.length - missing.length, missing });
    },
  };
  const nav = { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ active: sw }), controller: sw } };
  return { nav, asked };
}

test('images(): every picture of this session, once each, from the site root; the other language and unsafe paths left out', () => {
  const { images, urls } = load(undefined);
  expect(images(BATTERY, 'ur')).toEqual([
    '/sa/img/letters/demo.webp', '/sa/img/vocab/demo.ur.webp', '/sa/img/vocab/ur.vocabulary.01.webp', '/sa/img/vocab/ur.vocabulary.02.webp',
  ]);
  expect(images(BATTERY, 'en')).toContain('/sa/img/vocab/demo.en.webp');
  expect(images(BATTERY, 'en')).not.toContain('/sa/img/vocab/demo.ur.webp');
  // the clips list stays clips only (the voice gate counts it)
  expect(urls(BATTERY, 'ur', '/').every((u) => u.endsWith('.mp3'))).toBe(true);
});

test('images(): the Urdu game battery\'s vocabulary task gives all 13 pictures', () => {
  const { images } = load(undefined);
  const g = require(path.join(__dirname, '../../bot/shared/data/child-test/sa/sa.game.G23.ur.json'));
  const vocab = images(g, 'ur').filter((u) => u.startsWith('/sa/img/vocab/ur.vocabulary.'));
  expect(vocab).toHaveLength(13);
});

test('prepare(): the worker is asked to keep the pictures; all on the phone → ready, with the count', async () => {
  const { nav, asked } = worker();
  const { prepare, images } = load(nav);
  const r = await prepare({ battery_url: '/sa/batteries/x.json', battery: BATTERY, lang: 'ur', base: '/' });
  expect(asked).toContainEqual(images(BATTERY, 'ur'));
  expect(r).toMatchObject({ ready: true, battery: true, images: 4, images_missing: 0 });
});

test('prepare(): a picture not on the phone → not ready offline (a child would see a blank tile), and it says why', async () => {
  const { nav } = worker(['/sa/img/vocab/ur.vocabulary.02.webp']);
  const { prepare } = load(nav);
  const r = await prepare({ battery_url: '/sa/batteries/x.json', battery: BATTERY, lang: 'ur', base: '/' });
  expect(r).toMatchObject({ ready: false, battery: true, images: 3, images_missing: 1, why: 'images_not_cached' });
});
