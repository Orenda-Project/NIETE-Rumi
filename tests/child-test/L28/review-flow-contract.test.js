/**
 * Child test v2 — the review Flow JSON (bd-s1oo0.46.4): one screen, static slots driven by data, navigate mode.
 *
 * Guards: the committed docs/flows/child-test-review.json is the generator's output; the screen fits Meta's
 * limits (50 components, one Footer, label caps in code points); every ${data.*} it reads is declared, and the
 * data sendReview supplies is exactly what it declares (navigate mode has no endpoint to fill a gap); the
 * complete payload carries every slot's key and verdict; the coach copy fits its caps in both languages.
 */
const fs = require('fs');
const path = require('path');
const { buildChildTestReviewFlow, SLOTS } = require('../../../bot/shared/services/child-test/check-flow/review-flow');
const review = require('../../../bot/shared/services/child-test/check-flow/review');
const { resolveUx } = require('../../../bot/shared/config/ux-strings');

const COMMITTED = path.join(__dirname, '../../../docs/flows/child-test-review.json');
const cp = (s) => [...String(s)].length;

function walk(node, fn) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  if (node && typeof node === 'object') {
    if (node.type) fn(node);
    ['children', 'then', 'else'].forEach((k) => walk(node[k], fn));
  }
}

describe('review Flow JSON', () => {
  const flow = buildChildTestReviewFlow();
  const screen = flow.screens[0];

  test('the committed file is the generator output', () => {
    expect(JSON.parse(fs.readFileSync(COMMITTED, 'utf8'))).toEqual(flow);
  });

  test('one terminal screen, navigate-only (no endpoint), version 7.3', () => {
    expect(flow.version).toBe('7.3');
    expect(flow.screens).toHaveLength(1);
    expect(screen).toMatchObject({ id: 'REVIEW', terminal: true, success: true });
    expect(flow.data_api_version).toBeUndefined();
    expect(flow.routing_model).toBeUndefined();
    expect(cp(screen.title)).toBeLessThanOrEqual(30);
  });

  test('≤ 50 components, one Footer, 15 slots of heading + text + radio', () => {
    let n = 0; const types = {};
    walk(screen.layout.children, (c) => { n += 1; types[c.type] = (types[c.type] || 0) + 1; });
    expect(n).toBeLessThanOrEqual(50);
    expect(types.Footer).toBe(1);
    expect(types.RadioButtonsGroup).toBe(SLOTS);
    expect(SLOTS).toBe(review.MAX_ITEMS);
  });

  test('every ${data.x} it reads is declared, and the payload carries every slot', () => {
    const json = JSON.stringify(screen.layout);
    const used = new Set([...json.matchAll(/\$\{data\.(\w+)\}/g)].map((m) => m[1]));
    for (const k of used) expect(screen.data[k]).toBeDefined();
    let footer;
    walk(screen.layout.children, (c) => { if (c.type === 'Footer') footer = c; });
    const p = footer['on-click-action'];
    expect(p.name).toBe('complete');
    expect(p.payload.child_test).toBe('review');
    for (let i = 1; i <= SLOTS; i += 1) {
      expect(p.payload[`r${i}`]).toBe(`\${form.r${i}}`);
      expect(p.payload[`k${i}`]).toBe(`\${data.i${i}_k}`);
    }
  });

  test.each(['en', 'ur'])('the data sendReview supplies (%s) is exactly what the screen declares, within caps', (lang) => {
    const data = review.reviewScreenData(lang, [], 'rv_x');
    expect(Object.keys(data).sort()).toEqual(Object.keys(screen.data).sort());
    expect(cp(data.save)).toBeLessThanOrEqual(35);
    expect(cp(data.t_mark)).toBeLessThanOrEqual(30);
    expect(cp(data.heading)).toBeLessThanOrEqual(80);
    data.verdicts.forEach((v) => expect(cp(v.title)).toBeLessThanOrEqual(30));
  });
});

describe('review copy caps (code points)', () => {
  const r = (key, params, language) => resolveUx(key, { language, params });
  test.each(['en', 'ur'])('%s: button 20, header 60, heard ≤ 300 with a long answer', (lang) => {
    expect(cp(r('childTestReviewCta', {}, lang))).toBeLessThanOrEqual(20);
    expect(cp(r('childTestReviewHeader', { n: 15 }, lang))).toBeLessThanOrEqual(60);
    expect(cp(r('childTestReviewHeaderOne', {}, lang))).toBeLessThanOrEqual(60);
    const { header, body } = review.reviewMessage(lang, 15, 'x'.repeat(2000), null);
    expect(cp(header)).toBeLessThanOrEqual(60);
    expect(cp(body)).toBeLessThanOrEqual(1024);
    expect(body).toContain(r('childTestReviewAsk', { n: lang === 'en' ? '15' : '۱۵' }, lang));
  });

  test('Urdu coach copy is gender-neutral (no gendered person-verbs addressed to the coach or child)', () => {
    const keys = ['childTestReviewAsk', 'childTestReviewIntro', 'childTestReviewSaved', 'childTestReviewAlready', 'childTestReviewNotSaved', 'childTestReviewHeading'];
    for (const k of keys) {
      const s = r(k, { n: '۳' }, 'ur');
      expect(s).not.toMatch(/(کرتی|کرتا|سکتی|سکتا|گئی|گیا) (ہیں|ہو)/);
    }
  });
});
