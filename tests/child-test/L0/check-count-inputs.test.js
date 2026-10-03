'use strict';

/**
 * bd-s1oo0.43 — the check Flow's count inputs were input-type "phone" (bd-s1oo0.19 chose it so Meta
 * would publish string init-values). The WhatsApp client then validates every count as a phone
 * number: in the real WhatsApp capture on 3 Oct (WhatsApp Web, sandbox) "60" showed
 * "Enter a valid phone number" and the screen's save button stayed disabled, so no coach could save
 * a check. The publish-time validator never sees client-side validation, which is why the earlier
 * red test passed.
 *
 * Rule now: counts are plain text inputs (string init-values publish fine, nothing validates them
 * as phones), capped at 3 characters, and the endpoint reads Latin, Urdu (۰–۹) and Arabic-Indic
 * (٠–٩) digits, so a coach typing on an Urdu keyboard is not rejected.
 */

const { buildChildTestCheckFlow } = require('../../../bot/shared/services/child-test/check-flow/flow');
const P = require('../../../bot/shared/services/child-test/check-flow/prefill');
const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const { STRINGS } = require('../../../bot/shared/services/child-test/check-flow/strings');
const F = require('../L6/fixtures/ai-marks');

const items = CheckFlow.formItems('3', 'A');

function components(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => components(n, out));
  else if (node && typeof node === 'object') {
    if (node.name && node.type) out.push(node);
    Object.values(node).forEach((v) => components(v, out));
  }
  return out;
}

function withStrict(fn) {
  const before = process.env.CHILD_TEST_PREFILL_MODE;
  delete process.env.CHILD_TEST_PREFILL_MODE;
  try { return fn(); } finally {
    if (before !== undefined) process.env.CHILD_TEST_PREFILL_MODE = before;
  }
}

/** Every Urdu field the strict screen needs, with the story counts set by the caller. */
function urduPost(wc, wa) {
  return {
    u_wc: wc, u_wa: wa, u_q1: 'correct', u_q2: 'correct', u_q3: 'none',
    u_fs1: 'correct', u_fs2: 'wrong', u_fs3: 'correct', u_fs4: 'none', u_fs5: 'correct',
    u_nw1: 'correct', u_nw2: 'correct', u_nw3: 'correct', u_nw4: 'wrong', u_nw5: 'correct',
    u_flag: [], u_nwc: [],
  };
}
const readUrdu = (wc, wa) => withStrict(() => P.readScreen('urdu', urduPost(wc, wa), { aiMarks: F.urduConfident(), items, lang: 'ur' }));

describe('check Flow count inputs are text, not phone (bd-s1oo0.43)', () => {
  const counts = components(buildChildTestCheckFlow().screens).filter((c) => c.type === 'TextInput');

  test('there are count inputs to check', () => {
    expect(counts.length).toBeGreaterThan(0);
  });

  test('no count input is input-type phone (WhatsApp validates those as phone numbers)', () => {
    expect(counts.filter((c) => c['input-type'] === 'phone').map((c) => c.name)).toEqual([]);
  });

  test('every count input is a plain text input capped at 3 characters', () => {
    for (const c of counts) {
      expect(c['input-type']).toBe('text');
      expect(c['max-chars']).toBe(3);
    }
  });
});

describe('the endpoint reads counts typed in any digit script', () => {
  test('Latin digits, with stray spaces', () => {
    const r = readUrdu(' 58 ', '60');
    expect(r.ok).toBe(true);
    expect(r.coachMarks.story.words_correct).toBe(58);
    expect(r.coachMarks.story.words_attempted).toBe(60);
  });

  test('Urdu digits (۵۸ / ۶۰) from an Urdu keyboard', () => {
    const r = readUrdu('۵۸', '۶۰');
    expect(r.ok).toBe(true);
    expect(r.coachMarks.story.words_correct).toBe(58);
    expect(r.coachMarks.story.words_attempted).toBe(60);
  });

  test('Arabic-Indic digits (٥٨ / ٦٠)', () => {
    const r = readUrdu('٥٨', '٦٠');
    expect(r.ok).toBe(true);
    expect(r.coachMarks.story.words_correct).toBe(58);
  });

  test('letters are still refused with the "whole number" message', () => {
    const r = readUrdu('fifty', '60');
    expect(r.ok).toBe(false);
    expect(r.errors.u_wc).toBe(STRINGS.ur.err_number);
  });
});
