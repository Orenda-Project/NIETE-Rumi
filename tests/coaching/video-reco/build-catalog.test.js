'use strict';
/**
 * bd-gzfdu9 — build-catalog.js turns m-catalog's contracts/catalog.json into the bot's data file, and its
 * validator refuses a file the engine could not trust.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../../../bot/scripts/video-reco/build-catalog');

function source() {
  return [{
    module_id: 3, level_id: 2, cpd_level: 1, level_name: 'Emerging Practitioner', course_id: 1, course_title: 'Classroom',
    course_type: 'CLASSROOM_MANAGEMENT', title: 'Attention cues', order_index: 3,
    video_url: 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/training/3.mp4', duration_s: 312.4,
    thumb: 'catalog/thumbs/3.jpg', language: 'ur', format: 'classroom_footage', subjects: ['general'], grade_band: 'all',
    summary_en: 'Shows a clap cue.', summary_ur: 'تالی سے توجہ۔', teacher_line_en: 'Get quiet fast', teacher_line_ur: 'جلدی خاموشی',
    moves: ['attention_cue'], fico: [{ indicator: 'B2', strength: 1, evidence_s: 104 }], symptoms: ['repeats chup ho jao'],
    not_for: 'quiet classes', quality: { audio: 'good', clarity: 'high', flags: [] }, recommendable: true, recommendable_reason: null,
    segments: [
      { seg_id: '3-s1', start_s: 0, end_s: 95, title_en: 'Intro', title_ur: 'تعارف', summary_en: 'intro', moves: ['programme_intro'], fico: [], recommendable: false },
      { seg_id: '3-s2', start_s: 95, end_s: 188.5, title_en: 'Clap-back cue', title_ur: 'تالی', summary_en: 'Clap cue.', moves: ['attention_cue'], fico: [{ indicator: 'B2', strength: 1, evidence_s: 104 }], fico_main37: ['C6'], language: 'ur', continues_to: null },
    ],
    transcript: { txt: 'catalog/transcripts/3.txt', chars: 4123 }, card_by: 'w3', checked_by: 'm-catalog',
  }];
}
const crosswalk = { map: { B10: { exact: 'B7', approx: [] }, C6: { exact: null, approx: [] }, C8: { exact: null, approx: ['F5'] } } };

test('build keeps the engine fields, drops transcripts/provenance, attaches keywords, versions by source sha', () => {
  const data = B.build({ modules: source(), keywords: { '3-s2': ['clap', 'cue'] }, crosswalk, meta: { holes: ['D3', 'F7'] }, sourceSha: 'abcdef1234567890', now: new Date('2026-10-20T19:30:00Z') });
  expect(data.holes).toEqual(['D3', 'F7']);
  expect(data.modules[0].segments[1].fico_main37).toEqual(['C6']);
  expect(data.modules[0].segments[1].language).toBe('ur');
  expect(data.modules[0].segments[1].continues_to).toBeUndefined();
  expect(data.version).toBe('catalog-v1-20261020T1930-abcdef12');
  expect(data.framework).toBe('fico-v4');
  const m = data.modules[0];
  expect(m.transcript).toBeUndefined();
  expect(m.card_by).toBeUndefined();
  expect(m.thumb).toBe('video-thumbs/3.jpg');
  expect(m.topic).toEqual([]);
  expect(m.segments[1].keywords).toEqual(['clap', 'cue']);
  expect(m.segments[0].keywords).toEqual([]);
});

test('aliases {exact, approx}: identity for the v4 ids the crosswalk does not name; both lists for 37-ids', () => {
  const { indicator_aliases: a } = B.build({ modules: source(), keywords: {}, crosswalk, sourceSha: 'x' });
  expect(a.C1).toEqual({ exact: 'C1', approx: [], name: null });
  expect(a.F10).toEqual({ exact: 'F10', approx: [], name: null });
  expect(a.B10).toEqual({ exact: 'B7', approx: [], name: null });
  expect(a.C6).toEqual({ exact: null, approx: [], name: null });
  expect(a.C8).toEqual({ exact: null, approx: ['F5'], name: null });
  expect(Object.keys(a).filter((k) => a[k].exact === k)).toHaveLength(26);
});

test('a crosswalk row wins over identity where the schemes share an id (37-B7 is not v4-B7)', () => {
  const cw = { map: { ...crosswalk.map, B7: { exact: null, approx: [] } } };
  expect(B.build({ modules: source(), keywords: {}, crosswalk: cw, sourceSha: 'x' }).indicator_aliases.B7).toEqual({ exact: null, approx: [], name: null });
});

test('no crosswalk yet → identity aliases only', () => {
  const { indicator_aliases: a } = B.build({ modules: source(), keywords: {}, crosswalk: null, sourceSha: 'x' });
  expect(Object.keys(a)).toHaveLength(26);
});

test('keywords.json as an array of {seg_id, keywords} is read too', () => {
  const data = B.build({ modules: source(), keywords: [{ seg_id: '3-s2', keywords: ['x'] }], crosswalk: null, sourceSha: 'x' });
  expect(data.modules[0].segments[1].keywords).toEqual(['x']);
});

describe('validate', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-thumbs-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const good = () => B.build({ modules: source(), keywords: { '3-s2': ['clap'] }, crosswalk, sourceSha: 'x' });

  test('a good file has no errors', () => {
    fs.writeFileSync(path.join(dir, '3.jpg'), Buffer.alloc(1000));
    expect(B.validate(good(), { thumbsDir: dir })).toEqual([]);
  });

  test('a segment outside the video, an overlap-free order and unique ids are enforced', () => {
    const d = good();
    d.modules[0].segments[1].end_s = 400;
    d.modules[0].segments.push({ ...d.modules[0].segments[1], end_s: 100 });
    const errs = B.validate(d, {}).join('\n');
    expect(errs).toMatch(/3-s2.*outside/);
    expect(errs).toMatch(/duplicate seg_id 3-s2/);
  });

  test('duplicate module ids and unknown FICO ids are errors', () => {
    const d = good();
    d.modules.push(JSON.parse(JSON.stringify(d.modules[0])));
    d.modules[0].segments[1].fico = [{ indicator: 'C9', strength: 1 }];
    const errs = B.validate(d, {}).join('\n');
    expect(errs).toMatch(/duplicate module_id 3/);
    expect(errs).toMatch(/unknown indicator C9/);
  });

  test('every recommendable chapter needs keywords (a build with none fails)', () => {
    const d = B.build({ modules: source(), keywords: {}, crosswalk, sourceSha: 'x' });
    expect(B.validate(d, {}).join('\n')).toMatch(/3-s2.*no keywords/);
    expect(B.validate(d, {}).join('\n')).not.toMatch(/3-s1/); // not recommendable: no keywords needed
  });

  test('a thumb over 25 KB is an error', () => {
    fs.writeFileSync(path.join(dir, '3.jpg'), Buffer.alloc(26 * 1024));
    expect(B.validate(good(), { thumbsDir: dir }).join('\n')).toMatch(/3\.jpg.*25 KB/);
  });
});

describe('ped/vetoes.json (lead-review 19:49Z ruling 2: the panel veto is binding)', () => {
  const kw = { '3-s2': ['clap', 'cue'] };
  test('a segment entry sets that chapter recommendable:false with its reason; the module stays recommendable', () => {
    const vetoes = [{ module_id: 3, seg_id: '3-s2', reason: 'not_a_move: the card asks for a goal on the board' }];
    const data = B.build({ modules: source(), keywords: kw, crosswalk, vetoes, sourceSha: 'abc' });
    const s = data.modules[0].segments[1];
    expect(s.recommendable).toBe(false);
    expect(s.recommendable_reason).toMatch(/^panel_veto: not_a_move/);
    expect(data.modules[0].recommendable).toBe(true);
    expect(B.validate(data)).toEqual([]);
  });
  test('a module entry sets the module recommendable:false with its reason', () => {
    const vetoes = [{ module_id: 3, recommendable: false, recommendable_reason: 'panel_veto: not_a_move (ped-panel)' }];
    const data = B.build({ modules: source(), keywords: kw, crosswalk, vetoes, sourceSha: 'abc' });
    expect(data.modules[0]).toMatchObject({ recommendable: false, recommendable_reason: 'panel_veto: not_a_move (ped-panel)' });
  });
  test('a veto naming a chapter the catalogue does not have is an error, never a silent no-op', () => {
    expect(() => B.build({ modules: source(), keywords: kw, crosswalk, vetoes: [{ module_id: 3, seg_id: '3-s9', reason: 'x' }], sourceSha: 'abc' }))
      .toThrow(/3-s9/);
  });
  test('no vetoes → the same file as before', () => {
    const now = new Date('2026-10-20T19:30:00Z');
    expect(B.build({ modules: source(), keywords: kw, crosswalk, vetoes: [], sourceSha: 'abc', now }))
      .toEqual(B.build({ modules: source(), keywords: kw, crosswalk, sourceSha: 'abc', now }));
  });
});
