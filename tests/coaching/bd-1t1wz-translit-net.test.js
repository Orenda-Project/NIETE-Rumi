/**
 * bd-1t1wz follow-up (operator, 26 Aug) — transliteration/bad-translation audit
 * of 200 real prod sessions found ZERO leaks in the report narrative but 22 in
 * the COMMITMENT/ACTION text (the report's "one thing to try next class" box),
 * because that path had only prompt-side rules and no deterministic net.
 *
 * Two fixes, both encoded here:
 *  1. TRANSLIT_FIX (shared net) learns every form observed in prod + the two
 *     the operator sighted (گرم الفاظ, کھلے جوابات).
 *  2. finalizeCard() runs the net over commitment + action on every return path.
 */
const { fixCodeswitch } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const fs = require('fs');
const path = require('path');

describe('bd-1t1wz — the code-switch net covers the forms found in prod', () => {
  const CASES = [
    // [observed Urdu-script form, canonical English it must become]
    ['ورژن', 'version'],                 // ×8 in prod actions
    ['ورژنز', 'versions'],
    ['فیڈبیک', 'feedback'],              // ×3
    ['فیڈ بیک', 'feedback'],
    ['چیلنجنگ', 'challenging'],          // ×2
    ['ماڈلنگ', 'modeling'],
    ['پریکٹس', 'practice'],
    ['ریئل لائف', 'real-life'],
    ['ون بائی ون', 'one-by-one'],
    ['ویٹ ٹائم', 'wait time'],
    ['انتظار کا وقت', 'wait time'],
    // The operator's sighted forms (bad literal translations):
    ['گرم الفاظ', 'warm words'],
    ['کھلے جوابات', 'open-ended questions'],
  ];
  it.each(CASES)('maps %s → %s', (bad, good) => {
    const out = fixCodeswitch(`آپ نے ${bad} استعمال کیا`);
    expect(out).toContain(good);
    expect(out).not.toContain(bad);
  });

  it('leaves accepted everyday loanwords alone (بورڈ، کلاس)', () => {
    const s = 'بورڈ پر کلاس کے سامنے لکھیں';
    expect(fixCodeswitch(s)).toBe(s);
  });
});

describe('bd-1t1wz — the commitment card runs the net on every return path', () => {
  const src = () => fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/coaching-card/commitment-card.service.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('finalizeCard applies fixCodeswitch to commitment and action', () => {
    const body = src().match(/function finalizeCard\(card\)[\s\S]*?\n}/);
    expect(body).toBeTruthy();
    expect(body[0]).toContain('fixCodeswitch');
  });

  it('the service imports the net from the shared narrative module', () => {
    expect(src()).toContain("require('../report-v2/narrative.service')");
  });
});
