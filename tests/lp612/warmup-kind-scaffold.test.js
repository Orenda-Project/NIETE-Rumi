/**
 * EVERY `kind` THE RENDERER LABELS IS A `kind` THE LIVE SCHEMA ADMITS.
 *
 * `scaffold` is a first-class warm-up value everywhere in the v9 system: `overlay.js` gives it a
 * label in BOTH languages ("scaffold for today" / "\u0622\u062c \u06a9\u06d2 \u0633\u0628\u0642 \u06a9\u06cc \u0628\u0646\u06cc\u0627\u062f"), the gate fixture's first
 * warm-up row carries it, the renderer's comment above `warmupBody` says *"the scaffold item
 * comes first and says so"*, and the primary builder emits it. This suite pins the enum to that
 * set so a re-vendor cannot quietly drop one and turn a rendering document into a SCHEMA failure.
 *
 * IT ASSERTS AGAINST `lp_doc.schema.json`, WHICH IS THE ONE THAT JUDGES THESE DOCUMENTS.
 * `validate.js` picks the file from `schema_version`: "3.0" -> this file, "2.0" -> the frozen v8
 * `lp_doc.v2.schema.json`, whose warm-up enum is the narrower `["prerequisite","spaced"]` and
 * stays that way -- the v8 corpus never emitted `scaffold`, and widening a frozen schema to match
 * a newer renderer is how you stop being able to tell the two corpora apart. An earlier version
 * of this suite read the frozen file, "found" a bug that did not exist in the live schema, and
 * the widening that followed shipped into the wrong file entirely.
 */

'use strict';

const schema = require('../../bot/vendor/lp-v9/schema/lp_doc.schema.json');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay.js');

const KINDS = schema.properties.sections.items.properties.warmup.properties.items.items.properties.kind.enum;

describe('warm-up item kinds: the schema admits every kind the renderer labels', () => {
  test('scaffold is a legal kind', () => {
    expect(KINDS).toContain('scaffold');
  });

  test('the three reasons a row can be there are all present', () => {
    expect(new Set(KINDS)).toEqual(new Set(['scaffold', 'prerequisite', 'spaced']));
  });

  test.each(['en', 'ur'])('every enumerated kind has a %s label', (lang) => {
    const labels = LABELS[lang].kind;
    for (const k of KINDS) expect(typeof labels[k]).toBe('string');
  });

  test('no label exists for a kind the schema rejects', () => {
    for (const lang of ['en', 'ur']) {
      expect(Object.keys(LABELS[lang].kind).sort()).toEqual([...KINDS].sort());
    }
  });
});
