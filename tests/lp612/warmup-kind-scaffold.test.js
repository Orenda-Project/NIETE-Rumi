/**
 * THE SCHEMA FORBADE A `kind` THAT THE RENDERER, THE FIXTURE AND THE BUILDER ALL USE.
 *
 * `warmup.items[].kind` is enumerated `["prerequisite","spaced"]` in `lp_doc.v2.schema.json`,
 * but `scaffold` is a first-class value everywhere else: `overlay.js` gives it a label in BOTH
 * languages ("scaffold for today" / "آج کے سبق کی بنیاد"), the gate fixture's first warm-up row
 * carries it, the renderer's own comment above `warmupBody` says *"the scaffold item comes first
 * and says so"*, and the primary builder emits it. Only the enum disagrees, so a document that
 * renders perfectly fails validation -- the shipped Grade 3 English lesson among them.
 *
 * The enum is the outlier and it is what moves. Widening it cannot invalidate any existing
 * document, and narrowing the other four places would delete a distinction the warm-up is built
 * on: `scaffold` is today's foundation, `prerequisite` is assumed prior knowledge, `spaced` is
 * retrieval of something older. They are three different reasons for a row to be there.
 */

'use strict';

const schema = require('../../bot/vendor/lp-v9/schema/lp_doc.v2.schema.json');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay.js');

const KINDS = schema.properties.warmup.properties.items.items.properties.kind.enum;

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
