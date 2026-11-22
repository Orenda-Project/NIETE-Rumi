'use strict';
/**
 * bd-s0ccn5.2.2 — the offline FLN PDF run: which plans get a PDF, where each one goes, and how a run behaves when
 * pictures or single plans fail. Every boundary (the PDF engine, the bucket, the network) is injected; nothing here
 * launches a browser or touches R2.
 */
const { VERSION, build } = require('./fixtures/fln-corpus.fixture');
const { planJobs, pdfKey } = require('../../scripts/fln-pdf/jobs');
const { renderAll, inlineImages } = require('../../scripts/fln-pdf/render');
const { renderFlnPlanHtml } = require('../../scripts/fln-pdf/template');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function withPicture(bundle) {
  bundle.plans[900003].sections[0].groups[0].items[0].media.push({
    kind: 'image', src: 'https://media.example.test/fln/image/aaaaaaaa/zebra.png', orig: 'https://orig.example.test/zebra.png', caption_en: 'A zebra',
  });
  return bundle;
}

const okRes = (body = PNG, type = 'image/png') => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => body });
const res = (status) => ({ ok: false, status, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) });

describe('pdfKey', () => {
  test('is fln/pdf/<version>/<id>.pdf', () => {
    expect(pdfKey(VERSION, 900003)).toBe(`fln/pdf/${VERSION}/900003.pdf`);
  });
  test('refuses a malformed version or id', () => {
    expect(() => pdfKey('../x', 1)).toThrow();
    expect(() => pdfKey(VERSION, '1/../2')).toThrow();
  });
});

describe('planJobs', () => {
  const jobs = planJobs(build());
  const ids = jobs.map((j) => j.id);

  test('every served plan once, the hidden one never', () => {
    expect(ids).toContain('900006'); // additional shelf is served
    expect(ids).not.toContain('900007'); // hidden
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['900001', '900002', '900003', '900004', '900005', '900006', '900008', '900009', '900010', '900011', '900012']);
  });

  test('carries level, position and the counted lessons of its strand', () => {
    const j = jobs.find((x) => x.id === '900003');
    expect(j.plan.title).toBe('Sounds of q, x, z');
    expect(j.placement).toEqual({ level: 1, pos: 2, count: 5 }); // pos>0 served rows in rh-en G1 daily: 900002..900006
  });

  test('an explicit count wins; a guide at pos 0 has no lesson position', () => {
    expect(jobs.find((x) => x.id === '900008').placement).toEqual({ level: 2, pos: 1, count: 40 });
    expect(jobs.find((x) => x.id === '900001').placement.pos).toBe(0);
  });

  test('an empty or broken bundle gives no jobs', () => {
    expect(planJobs({})).toEqual([]);
    expect(planJobs(null)).toEqual([]);
  });
});

describe('inlineImages', () => {
  test('a picture becomes a data:image URI; sound is not fetched', async () => {
    const fetch = jest.fn(async () => okRes());
    const plan = withPicture(build()).plans[900003];
    const map = await inlineImages(plan, { fetch, sleep: async () => {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(map.get('https://media.example.test/fln/image/aaaaaaaa/zebra.png')).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  test('a 429 is retried, then the S3 original is tried', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(okRes());
    const map = await inlineImages(withPicture(build()).plans[900003], { fetch, sleep: async () => {}, retries: 2 });
    expect(fetch.mock.calls.at(-1)[0]).toBe('https://orig.example.test/zebra.png');
    expect(map.size).toBe(1);
  });

  test('a picture that never loads is left out, not fatal; a non-image body is refused', async () => {
    const dead = await inlineImages(withPicture(build()).plans[900003], { fetch: async () => res(404), sleep: async () => {} });
    expect(dead.size).toBe(0);
    const html = await inlineImages(withPicture(build()).plans[900003], { fetch: async () => okRes(Buffer.from('<x>'), 'text/html'), sleep: async () => {} });
    expect(html.size).toBe(0);
  });
});

// bd-s0ccn5.3 — pictures in setup and homework moves are fetched too (corpus v2: 678 setup pictures).
test('inlineImages fetches the pictures in setup and homework moves', async () => {
  const fetch = jest.fn(async () => okRes());
  const plan = { ...build().plans[900003], sections: [],
    setup: [{ kind: 'instruction', text: 'x', media: [{ kind: 'image', src: 'https://media.example.test/fln/image/s.png' }] }],
    homework: [{ kind: 'instruction', text: 'y', media: [{ kind: 'image', src: 'https://media.example.test/fln/image/h.png' }] }] };
  const map = await inlineImages(plan, { fetch, sleep: async () => {} });
  expect([...map.keys()].sort()).toEqual(['https://media.example.test/fln/image/h.png', 'https://media.example.test/fln/image/s.png']);
});

describe('renderAll', () => {
  function deps(over = {}) {
    const stored = new Map();
    return {
      stored,
      toPdf: jest.fn(async (html) => Buffer.from(`%PDF ${html.length}`)),
      store: { exists: jest.fn(async (k) => stored.has(k)), put: jest.fn(async (k, body, type) => { stored.set(k, { body, type }); }) },
      fetch: jest.fn(async () => okRes()),
      sleep: async () => {},
      log: () => {},
      ...over,
    };
  }

  test('renders every job to its key as application/pdf and reports the counts', async () => {
    const d = deps();
    const bundle = withPicture(build());
    const out = await renderAll({ version: VERSION, jobs: planJobs(bundle), ...d });
    expect(out).toEqual({ total: 11, rendered: 11, skipped: 0, failed: [] });
    const one = d.stored.get(`fln/pdf/${VERSION}/900003.pdf`);
    expect(one.type).toBe('application/pdf');
    const html = d.toPdf.mock.calls.map((c) => c[0]).find((h) => h.includes('Sounds of q, x, z'));
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(/\.mp3|<audio|<video/);
    expect(html).toContain('Level 1 · Lesson 2/5');
  });

  test('a key already in the bucket is skipped unless forced', async () => {
    const d = deps();
    d.stored.set(`fln/pdf/${VERSION}/900003.pdf`, {});
    const jobs = planJobs(build()).filter((j) => j.id === '900003' || j.id === '900004');
    expect(await renderAll({ version: VERSION, jobs, ...d })).toMatchObject({ rendered: 1, skipped: 1 });
    expect(await renderAll({ version: VERSION, jobs, force: true, ...d })).toMatchObject({ rendered: 2, skipped: 0 });
  });

  test('one plan failing never stops the rest', async () => {
    const d = deps({ toPdf: jest.fn(async (html) => { if (html.includes('Sounds of v, w, y')) throw new Error('boom'); return Buffer.from('%PDF'); }) });
    const out = await renderAll({ version: VERSION, jobs: planJobs(build()), ...d });
    expect(out.rendered).toBe(10);
    expect(out.failed).toEqual([{ id: '900004', error: 'boom' }]);
  });

  test('an empty PDF is a failure, never uploaded', async () => {
    const d = deps({ toPdf: async () => Buffer.alloc(0) });
    const jobs = planJobs(build()).slice(0, 1);
    const out = await renderAll({ version: VERSION, jobs, ...d });
    expect(out.failed).toHaveLength(1);
    expect(d.store.put).not.toHaveBeenCalled();
  });
});

describe('template — inlined pictures', () => {
  const plan = (src) => ({ id: 1, subject: 'num', lang: 'en', title: 'T', sections: [{ kind: 'opening', groups: [{ items: [{ kind: 'say', text: 'x', media: [{ kind: 'image', src }] }] }] }] });

  test('a data:image source is drawn', () => {
    expect(renderFlnPlanHtml(plan('data:image/png;base64,iVBORw0KGgo='))).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
  });
  test('any other data: source is dropped', () => {
    expect(renderFlnPlanHtml(plan('data:text/html;base64,PHNjcmlwdD4='))).not.toContain('<img');
    expect(renderFlnPlanHtml(plan('data:image/svg+xml;base64,PHN2Zz4='))).not.toContain('<img');
  });
});
