/**
 * bd-7g300 -- THE PHASE CHIP SAYS "HOOK". THE TEACHER'S WORD IS "OPENING".
 *
 * OPERATOR, verbatim: *"the hook tag should be opening instead"*.
 *
 * `hook` is Digital Coach vocabulary. It is one of the ten phase ids the fidelity
 * extractor enumerates (`fidelity/lp-upload-extractor.js`), it is a key in `DC_PHASE`
 * here, and `d0_crux.py` asserts set-equality on those ids from the python side. It is
 * also the word the SHEET ITSELF never uses anywhere else: the band that carries this
 * chip is introduced to the teacher as the opening of the lesson, and "hook" is a piece
 * of lesson-design jargon that arrives on the page with no referent.
 *
 * SO THE KEY DOES NOT MOVE AND THE LABEL DOES. The chip renders
 * `LABELS[lang].dcPhase[phase]` -- a human string looked up by a machine id. Changing the
 * string changes what a teacher reads and nothing else; changing the id would break a
 * contract with the coach's scorer and with `test_d0_crux.py`. The tests below assert
 * both halves, because "rename the tag" is exactly the request that gets satisfied by
 * renaming the key.
 *
 * RULE 20. A label change lands in BOTH language blocks, in real Urdu, never a
 * transliteration and never left in English. The Urdu chip currently reads تجسس, which
 * is "curiosity" -- a translation of the JARGON, not of what the band is. The Urdu word
 * for the opening of something is آغاز, and that is what a teacher reading the Urdu sheet
 * should see beside the same band the English sheet labels Opening.
 *
 * Every length below is measured with [...s].length. `.length` counts UTF-16 units and
 * would mis-measure Urdu; the chip's constraint is that it not outrun the heading it sits
 * beside, and that is a count of what prints.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat, dcPhaseOf } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The gate fixture at a primary grade -- the DC chip is primary-only. */
function doc() {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
}

const body = (lang) =>
  buildHtml(doc(), { docDir: path.dirname(FIXTURE), lang: lang || 'en' }).html.split('</style>').pop();

/** Every DC phase chip on the page, in print order, as printed. */
const chips = (h) => [...h.matchAll(/<span class="dct">([^<]*)<\/span>/g)].map((m) => m[1].trim());

/** Code points, not UTF-16 units -- the only honest length for an Urdu string. */
const cp = (s) => [...s].length;

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------- 1. what the label says */

describe('bd-7g300: the phase chip is labelled in the teacher\'s words', () => {
  test('the English label is Opening, not Hook', () => {
    expect(LABELS.en.dcPhase.hook).toBe('Opening');
  });

  test('the English page prints it -- and the word "Hook" is nowhere on it', () => {
    const h = body('en');
    expect(chips(h)).toContain('Opening');
    expect(chips(h)).not.toContain('Hook');
  });

  test('the Urdu label is the real Urdu for Opening, not for the jargon it replaced', () => {
    expect(LABELS.ur.dcPhase.hook).toBe('آغاز');
  });

  test('the Urdu page prints the Urdu label', () => {
    expect(chips(body('ur'))).toContain(LABELS.ur.dcPhase.hook);
  });
});

/* --------------------------------------------- 2. rule 20 -- both packs, real Urdu, always */

describe('bd-7g300: rule 20 holds across the whole phase vocabulary', () => {
  test('both language packs label exactly the same set of phases', () => {
    expect(Object.keys(LABELS.ur.dcPhase).sort()).toEqual(Object.keys(LABELS.en.dcPhase).sort());
  });

  test('no Urdu phase label is left in Latin script -- a transliteration is not a translation', () => {
    const latin = Object.entries(LABELS.ur.dcPhase).filter(([, v]) => /[A-Za-z]/.test(v));
    expect(latin).toEqual([]);
  });

  test('every Urdu phase label is actually Arabic-script text', () => {
    const notUrdu = Object.entries(LABELS.ur.dcPhase).filter(([, v]) => !/[؀-ۿ]/.test(v));
    expect(notUrdu).toEqual([]);
  });

  test('the chip stays short enough to sit beside a heading, measured in code points', () => {
    for (const pack of [LABELS.en.dcPhase, LABELS.ur.dcPhase]) {
      for (const [k, v] of Object.entries(pack)) expect([k, cp(v)][1]).toBeLessThanOrEqual(16);
    }
  });
});

/* ------------------------------------------ 3. the id is a contract and did NOT change */

describe('bd-7g300: only the label moved -- the machine vocabulary is untouched', () => {
  test('`hook` is still the key both packs are looked up by', () => {
    expect(LABELS.en.dcPhase).toHaveProperty('hook');
    expect(LABELS.ur.dcPhase).toHaveProperty('hook');
  });

  test('the renderer still maps the opening block onto the `hook` phase id', () => {
    expect(dcPhaseOf('hook')).toBe('hook');
  });

  test('no label pack invented an `opening` id alongside it', () => {
    expect(LABELS.en.dcPhase).not.toHaveProperty('opening');
    expect(LABELS.ur.dcPhase).not.toHaveProperty('opening');
    expect(dcPhaseOf('opening')).toBeNull();
  });
});
