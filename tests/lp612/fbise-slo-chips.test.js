/**
 * bd-f01ob — each FBISE SLO the lesson teaches carries its own Summative / Formative chip.
 *
 * Operator, 2026-09-24: *"(6) meant drop the Internal tag; show Summative/Formative"*, read from
 * PROD's segment catalogue (bd-izuws v4), never from the author model's `slo.assessment_status`
 * guess. The tags are attached at render time from a checked-in map, so a template bump re-renders
 * every stored lesson with them and no document in R2 has to be rewritten.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const { validateDoc } = require('../../bot/vendor/lp-v9/lib/validate');
const { applyOverlay } = require('../../bot/vendor/lp-v9/lib/overlay');
const { attachFbiseSlos } = require('../../bot/shared/services/lp612-fbise-tags');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const body = (out) => out.slice(out.lastIndexOf('</style>') + 8);
const html = (doc, lang) => body(buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html);
const box = (out) => {
  const i = out.indexOf('class="slo');
  return out.slice(i, out.indexOf('</div>\n<div data-atom', i));
};

const TAGS = [{ code: 'M-09-A-07', status: 'Summative' }, { code: 'M-09-A-08', status: 'Formative' },
  { code: 'M-09-A-09', status: null }];

describe('the outcome box prints the FBISE status of each SLO', () => {
  test('one chip per SLO, each with its own status', () => {
    const d = { ...baseDoc(), fbise_slos: TAGS };
    const b = box(html(d));
    expect(b).toMatch(/M-09-A-07<\/b> Summative/);
    expect(b).toMatch(/M-09-A-08<\/b> Formative/);
    expect(b.match(/class="fchip"/g)).toHaveLength(3);
  });

  test('an unresolved status shows the code and no status — never a guess', () => {
    const b = box(html({ ...baseDoc(), fbise_slos: TAGS }));
    expect(b).toMatch(/M-09-A-09<\/b><\/span>/);
  });

  test('the author model\'s own assessment_status still never paints', () => {
    const d = baseDoc();
    d.slo.assessment_status = 'Internal';
    expect(html(d)).not.toContain('Internal');
    expect(box(html(d))).not.toMatch(/fchip/);
  });

  test('Urdu pages label the status in Urdu', () => {
    const b = box(html({ ...baseDoc(), fbise_slos: TAGS }, 'ur'));
    expect(b.match(/class="fchip"/g)).toHaveLength(3);
    expect(b).not.toMatch(/Summative|Formative/);
    expect(b).toContain('M-09-A-07');
  });

  test('grades 6-8 say there is no board exam, in the label line', () => {
    const d = baseDoc();
    d.provenance.grade = 8;
    d.board_weight = null;
    const b = box(html(d));
    expect(b).toMatch(/class="lbl">[^<]*No board exam/);
    expect(box(html(baseDoc()))).not.toContain('No board exam');
  });
});

describe('the schema and the overlay', () => {
  test('both schemas accept fbise_slos and refuse any status but the two', () => {
    const d = { ...baseDoc(), fbise_slos: TAGS };
    expect(validateDoc(d).errors).toEqual([]);
    expect(validateDoc({ ...d, fbise_slos: [{ code: 'M-09-A-07', status: 'Internal' }] }).ok).toBe(false);
    const v2 = require('../../bot/vendor/lp-v9/schema/lp_doc.v2.schema.json');
    expect(v2.properties.fbise_slos).toEqual(require('../../bot/vendor/lp-v9/schema/lp_doc.schema.json').properties.fbise_slos);
  });

  test('an Urdu overlay cannot translate a code or a status', () => {
    const d = { ...baseDoc(), fbise_slos: TAGS, ur_overlay: { '/fbise_slos/0/status': 'مجموعی' } };
    expect(applyOverlay(d, 'ur').errors.join(' ')).toMatch(/fbise_slos/);
  });
});

describe('attachFbiseSlos — the render-time lookup', () => {
  const MAP = { 'grade_9_maths.c01.p1': TAGS };
  const doc9 = () => baseDoc();

  test('attaches the segment\'s tags to a grade 9-12 doc without mutating it', () => {
    const d = doc9();
    const out = attachFbiseSlos(d, 'grade_9_maths.c01.p1', MAP);
    expect(out.fbise_slos).toEqual(TAGS);
    expect(d.fbise_slos).toBeUndefined();
  });

  test('an unmapped segment carries none — and a stale copy is dropped', () => {
    const out = attachFbiseSlos({ ...doc9(), fbise_slos: TAGS }, 'grade_9_maths.c09.p9', MAP);
    expect(out.fbise_slos).toBeUndefined();
  });

  test('grades 6-8 carry none', () => {
    const d = doc9();
    d.provenance.grade = 8;
    expect(attachFbiseSlos(d, 'grade_9_maths.c01.p1', MAP).fbise_slos).toBeUndefined();
  });

  test('the checked-in map holds only codes and the two statuses', () => {
    const map = require('../../bot/shared/data/lp612-fbise-slo-tags.json');
    const all = Object.values(map).flat();
    expect(all.length).toBeGreaterThan(2000);
    const code = new RegExp(require('../../bot/vendor/lp-v9/schema/lp_doc.schema.json')
      .properties.fbise_slos.items.properties.code.pattern);
    for (const t of all) {
      expect([null, 'Summative', 'Formative']).toContain(t.status);
      expect(t.code).toMatch(code);
    }
  });
});

describe('renderLessonPlan attaches the tags on every render path', () => {
  // No mock: a doc missing `lp_type` is refused by the REAL schema check before Chromium launches,
  // and the service has already written the document it handed the renderer — which is what we read.
  const os = require('os');
  const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
  const SEG = 'grade_10_biology.c01.p007-009';

  test('the document handed to the renderer carries the segment\'s FBISE tags', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbise-'));
    const d = baseDoc();
    d.provenance.grade = 10;
    delete d.lp_type;
    await expect(renderLessonPlan({ lpDoc: d, stem: 'x', outDir, segmentId: SEG })).rejects.toThrow();
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'x.lp.json'), 'utf8'));
    expect(written.fbise_slos).toEqual(require('../../bot/shared/data/lp612-fbise-slo-tags.json')[SEG]);
    expect(d.fbise_slos).toBeUndefined();
  });
});
