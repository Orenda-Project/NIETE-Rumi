/**
 * Byte-level parity with the Python builder (workbench/card/*.py) on real cards: 15 real ICT and GB cards (English,
 * Maths, Urdu RTL, Science, with and without video) and 24 real cards broken one way each. Each golden was written by
 * the Python modules; the Node output must equal it exactly. The v9 page is stored as a skeleton (its section anchors,
 * diagram tags and video block) because the real page is 1.8 to 3.4 MB; the Python gave identical output on the full page.
 */
const { addIds, missing } = require('../../../shared/services/lp-v10-card/anchor');
const { validate } = require('../../../shared/services/lp-v10-card/rules');
const { render } = require('../../../shared/services/lp-v10-card/render');
const { gates, withVideo } = require('../../../shared/services/lp-v10-card/gates');
const { v9Video } = require('../../../shared/services/lp-v10-card/check');
const { goldens, clone } = require('../../fixtures/lp-v10-card/load');

const ALL = goldens();

test('the golden set covers the subjects, RTL, video and failures', () => {
  expect(ALL.length).toBeGreaterThanOrEqual(30);
  const subjects = new Set(ALL.map((g) => g.card.header.subject));
  expect([...subjects].sort()).toEqual(['English', 'Maths', 'Science', 'Urdu']);
  expect(ALL.some((g) => g.card.lang === 'ur')).toBe(true);
  expect(ALL.some((g) => g.expect.video)).toBe(true);
  expect(ALL.some((g) => g.name.startsWith('gb_'))).toBe(true);
  expect(ALL.some((g) => g.expect.validate.length > 0)).toBe(true);
  expect(ALL.some((g) => g.expect.gates.length === 0)).toBe(true);
});

describe.each(ALL.map((g) => [g.name, g]))('golden %s', (_name, g) => {
  const ided = addIds(g.v9Skeleton);
  test('add_ids and missing', () => {
    expect(ided).toBe(g.expect.addIds);
    expect(missing(ided)).toEqual(g.expect.missing);
  });
  test('v9_video', () => {
    expect(v9Video(g.v9Skeleton)).toEqual(g.expect.video);
  });
  test('validate', () => {
    expect(validate(clone(g.card))).toEqual(g.expect.validate);
  });
  test('with_video, render and gates', () => {
    const card = withVideo(clone(g.card), ided);
    expect(card).toEqual(g.expect.cardWithVideo);
    const html = render(card);
    expect(html).toBe(g.expect.html);
    expect(gates(card, html, ided, g.must)).toEqual(g.expect.gates);
  });
});
