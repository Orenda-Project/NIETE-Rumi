/**
 * THE ENGLISH LEFT ON AN URDU LESSON PLAN — bd-oak77.40.
 *
 * A Grade 8 teacher asked for her lesson objectives in Urdu. The production Urdu plan behind the
 * complaint (grade_8_mathematics.c06.p091-093, an English-medium book overlaid into Urdu) still
 * printed English in three places, each with its own cause:
 *
 *   1. THE SUBJECT NAME. `lib/template.js` prints `provenance.subject` raw at five sites — the
 *      document <title>, the hero kicker, the footer on every page, the page-2 head and the
 *      "…continued" strip. `subject` is kept out of the overlay on purpose (the Urdu name is a
 *      deterministic map, `subjectNameFor()`, which the WhatsApp caption already uses), but nothing
 *      ever handed that map's answer to the renderer, so every page said «Mathematics».
 *   2. THE OBJECTIVES. `overlayDefects` passes at 50% coverage and asks nothing about WHICH strings
 *      are covered. The objectives are the one box a teacher reads aloud word for word, and an
 *      overlay that skipped them passed the gate.
 *   3. SHORT PROSE. `isInstructionProse` wants two runs of two-plus Latin letters, so a materials
 *      line such as «textbook p.91-93» (one word, then `p`) was never offered for translation.
 *
 * The re-render lane's half of (2) is pinned in urdu-objectives-reuse-gate.test.js. English plans
 * must not move at all, and the things that MUST stay English stay English.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const RAW = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(RAW);

// The renderer is real apart from Chromium: the fake below does exactly what `renderDoc` does up
// to the browser — read the document file the service wrote, apply the overlay, build the HTML —
// and keeps the HTML so the printed sites can be read.
const mockHtml = { last: null };
jest.mock('../../bot/vendor/lp-v9/render_lp.js', () => {
  const real = jest.requireActual('../../bot/vendor/lp-v9/render_lp.js');
  const { applyOverlay } = jest.requireActual('../../bot/vendor/lp-v9/lib/overlay.js');
  const { buildHtml } = jest.requireActual('../../bot/vendor/lp-v9/lib/template.js');
  const nodeFs = jest.requireActual('fs');
  const nodePath = jest.requireActual('path');
  return {
    ...real,
    renderDoc: jest.fn(async (a) => {
      const raw = JSON.parse(nodeFs.readFileSync(a.doc, 'utf8'));
      const lang = a.lang || raw.provenance.medium || 'en';
      const { doc, errors } = applyOverlay(raw, lang);
      if (errors.length) throw new Error(`OVERLAY_INVALID ${errors.join('; ')}`);
      const fixtureDir = nodePath.join(__dirname, '__fixtures__');
      mockHtml.last = buildHtml(doc, { docDir: fixtureDir, lang, probeCont: true }).html;
      return {
        problems: [], warnings: [], pagesByPart: { teach: 1, support: 1 },
        pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pdfPages: 2, report: {},
      };
    }),
  };
});
// The overlay pass's model call — the network boundary, never the service under test.
jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
const { subjectNameFor } = require('../../bot/shared/config/lp612-subject-order');

const targets = (d) => overlayDefects.targets(d);
const UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے لکھی گئی ہے۔';
const fullOverlay = (d) => Object.fromEntries(targets(d).map((p) => [p, UR]));

// ── 1 · the subject name, at every site the template prints it ──────────────

describe('an Urdu plan of an English-medium book prints the Urdu subject name', () => {
  const OUT = path.join(os.tmpdir(), 'lp612-urdu-residue-test');
  const UR_SUBJECT = subjectNameFor('Mathematics', 'ur');

  /** The five sites `lib/template.js` draws `provenance.subject` at. */
  // `[^>]*` because the measure pass tags its furniture copy with a `data-probe` attribute.
  const div = (cls) => new RegExp(`<div[^>]*class="${cls}"[^>]*>[\\s\\S]*?</div>`);
  const sites = (html) => ({
    title: html.match(/<title>[\s\S]*?<\/title>/)?.[0],
    kicker: html.match(div('kicker'))?.[0],
    footer: html.match(div('fl'))?.[0],
    page2Head: html.match(/<div class="r"><span class="pill">[\s\S]*?<\/div>/)?.[0],
    contStrip: html.match(div('contstrip'))?.[0],
  });

  const render = async (lpDoc, lang) => {
    mockHtml.last = null;
    await renderLessonPlan({ lpDoc, lang, stem: `residue_${lang}`, outDir: OUT });
    expect(mockHtml.last).toBeTruthy();
    return mockHtml.last;
  };

  test('the map knows the subject — so an English name on the page is not a gap in the map', () => {
    expect(UR_SUBJECT).toBe('ریاضی');
  });

  test('header, title, page strip and footer all carry the Urdu name, none the English', async () => {
    const d = load();
    d.ur_overlay = fullOverlay(d);
    const found = sites(await render(d, 'ur'));
    // One assertion over all five, so a failure names every site that is still English.
    const verdict = Object.fromEntries(Object.entries(found).map(([site, html]) => [site,
      !html ? 'missing' : `${html.includes(UR_SUBJECT) ? 'urdu' : 'no-urdu'}/${html.includes('Mathematics') ? 'english' : 'no-english'}`]));
    expect(verdict).toEqual({
      title: 'urdu/no-english', kicker: 'urdu/no-english', footer: 'urdu/no-english',
      page2Head: 'urdu/no-english', contStrip: 'urdu/no-english',
    });
  });

  test('ENGLISH plan unchanged: every site keeps «Mathematics», none prints the Urdu name', async () => {
    const found = sites(await render(load(), 'en'));
    const verdict = Object.fromEntries(Object.entries(found).map(([site, html]) => [site,
      !html ? 'missing' : `${html.includes(UR_SUBJECT) ? 'urdu' : 'no-urdu'}/${html.includes('Mathematics') ? 'english' : 'no-english'}`]));
    expect(verdict).toEqual({
      title: 'no-urdu/english', kicker: 'no-urdu/english', footer: 'no-urdu/english',
      page2Head: 'no-urdu/english', contStrip: 'no-urdu/english',
    });
  });

  test('the caller\'s document is not rewritten — the stored lesson keeps its English subject', async () => {
    const d = load();
    d.ur_overlay = fullOverlay(d);
    await render(d, 'ur');
    expect(d.provenance.subject).toBe('Mathematics');
  });
});

// ── 2 · the overlay gate asks for the objectives by name ────────────────────

describe('the overlay gate refuses an Urdu overlay that leaves any objective in English', () => {
  // The real pointers, from schema/lp_doc.schema.json §objectives and the production plan.
  const OBJECTIVE_PTRS = [
    '/objectives/outcome',
    '/objectives/by_the_end',
    '/objectives/items/0/text',
    '/objectives/items/1/text',
  ];

  test('every objectives field is an overlay target in the first place', () => {
    const t = targets(load());
    for (const p of OBJECTIVE_PTRS) expect(t).toContain(p);
  });

  test.each(OBJECTIVE_PTRS)('coverage ~97%%, but %s is English: refused', (ptr) => {
    const d = load();
    d.ur_overlay = fullOverlay(d);
    delete d.ur_overlay[ptr];
    const covered = Object.keys(d.ur_overlay).length / targets(d).length;
    expect(covered).toBeGreaterThan(0.9);   // coverage is NOT what this test is about

    const defects = overlayDefects(d, 'ur', { expected: true });
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.map((x) => x.msg).join(' ')).toContain(ptr);
  });

  test('the overlay PASS refuses the same overlay — so the English document is what is delivered', async () => {
    // `overlayLessonPlan` throws on a gate defect and the worker then delivers the English PDF
    // with the honest caption (overlay-pass.test.js pins that half). Red today: it resolves.
    const create = require('../../bot/shared/services/llm-client').__create;
    const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');
    const d = load();
    const answer = fullOverlay(d);
    delete answer['/objectives/outcome'];
    create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 8000, completion_tokens: 7000, total_tokens: 15000 },
    });

    await expect(overlayLessonPlan({
      lpDoc: d, segment: { segment_id: 'grade_9_mathematics.c01.p024-025', subject: 'Mathematics', grade: 9 },
    })).rejects.toMatchObject({ code: 'OVERLAY_TOO_THIN' });

    // Control: the same call with the objectives translated is accepted, so the refusal above is
    // about the objectives and nothing else in this harness.
    create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(fullOverlay(d)) } }],
      usage: { prompt_tokens: 8000, completion_tokens: 7000, total_tokens: 15000 },
    });
    await expect(overlayLessonPlan({
      lpDoc: d, segment: { segment_id: 'grade_9_mathematics.c01.p024-025', subject: 'Mathematics', grade: 9 },
    })).resolves.toBeTruthy();
  });

  test('a blank string is not a translation of an objective', () => {
    const d = load();
    d.ur_overlay = fullOverlay(d);
    d.ur_overlay['/objectives/outcome'] = '   ';
    expect(overlayDefects(d, 'ur', { expected: true }).length).toBeGreaterThan(0);
  });

  test('a fully translated overlay still passes', () => {
    const d = load();
    d.ur_overlay = fullOverlay(d);
    expect(overlayDefects(d, 'ur', { expected: true })).toEqual([]);
  });

  test('an English plan, and an Urdu-medium book, are not held to it', () => {
    const d = load();
    expect(overlayDefects(d, 'en', { expected: true })).toEqual([]);
    d.provenance.medium = 'ur';
    expect(overlayDefects(d, 'ur', { expected: true })).toEqual([]);
  });
});

// ── 3 · short prose lines are collected; what must stay English stays out ───

describe('short prose lines are offered for translation', () => {
  test('the production materials line «textbook p.91-93» is a target', () => {
    const d = load();
    d.materials = ['textbook p.91-93', 'Squared paper'];
    expect(targets(d)).toContain('/materials/0');
  });

  test('so is the fixture\'s own «Textbook p.24-25»', () => {
    expect(targets(load())).toContain('/materials/0');
  });

  test('things that must stay English are still not targets', () => {
    const d = load();
    const kw = d.sections[0].blocks[1];
    kw.items[0].word = 'photosynthesis';               // a term of record, single word
    d.sections[0].blocks[3].text = 'textbook p.24';    // board text: the exam's language
    d.page2.exam_bank.mcq[0].q = 'Evaluate p.91 sum';  // the exam is sat in the book's language
    d.video = { title: 'Khan Academy p.4', url: 'https://example.org/v', channel: 'Khan Academy' };
    d.sections[1].blocks[0].text = 'sin 30° = 0.5';    // notation, not prose

    const t = targets(d);
    expect(t).not.toContain('/sections/0/blocks/1/items/0/word');
    expect(t).not.toContain('/sections/0/blocks/3/text');
    expect(t).not.toContain('/page2/exam_bank/mcq/0/q');
    expect(t).not.toContain('/video/title');
    expect(t).not.toContain('/slo/code');
    expect(t).not.toContain('/slo/text_verbatim');
    expect(t).not.toContain('/sections/1/blocks/0/text');
    expect(t.some((p) => /slo_code$/.test(p))).toBe(false);
  });
});
