/**
 * Web quiz page, Urdu: Latin text inside an Urdu page keeps normal word spacing.
 *
 * Why: the Urdu page widens word gaps (word-spacing .2em) and draws spaces with the Nastaliq face,
 * which is scaled up. That helps Nastaliq, where words otherwise run together, but an English video
 * title on the Urdu "more videos" list read "Life  Cycle  of  a  Hen", and a Latin name typed into
 * the Urdu name box had the same holes. Latin runs of two or more words are marked lang="en" and
 * drawn with the sans face at normal spacing; Urdu text around them keeps its spacing.
 */
const { page, flush, CSS } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const LIST = {
  grade: '3', subject: 'Science',
  videos: [
    { vid: 'v-1', title: 'Life Cycle of a Hen', subject: 'Science', grade: '3', secs: 143, mb: 3.2 },
    { vid: 'v-2', title: 'پودوں کے حصے', subject: 'Science', grade: '3', secs: 433, mb: 10.5 },
  ],
};
const LAT = (s) => `<span class="wq-lat" lang="en">${s}</span>`;

async function moreList(lang) {
  const p = page({ lang, store: finished(), api: { '/videos/TEST': LIST } });
  p.els['#wq-more'].fire('click');
  await flush();
  return p;
}

describe('Latin runs on an Urdu page are marked as English', () => {
  test('an English video title on the Urdu "more videos" list is one lang="en" run', async () => {
    const p = await moreList('ur');
    expect(p.moment()).toBe('M15');
    expect(p.html()).toContain(`<b dir="auto">${LAT('Life Cycle of a Hen')}</b>`);
  });

  test('Urdu text is left alone: the Urdu title and the Urdu copy carry no mark', async () => {
    const p = await moreList('ur');
    expect(p.html()).toContain('<b dir="auto">پودوں کے حصے</b>');
    expect(p.html()).not.toMatch(/wq-lat[^>]*>[^<]*[؀-ۿ]/);
  });

  test('"3.2 MB" (a number and a Latin unit) is a Latin run too', async () => {
    const p = await moreList('ur');
    expect(p.html()).toContain(`<bdi dir="ltr">${LAT('3.2 MB')}</bdi>`);
  });

  test('an English page is not touched', async () => {
    const p = await moreList('en');
    expect(p.html()).toContain('<b dir="auto">Life Cycle of a Hen</b>');
    expect(p.html()).not.toContain('wq-lat');
  });

  test('a Latin teacher name inside an Urdu sentence: only the Latin words are marked', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'Amna Testwala', chips: [] } });
    expect(p.html()).toContain(LAT('Amna Testwala'));
  });

  test('a single Latin word, a lone number and tag attributes are never wrapped', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'Amna', chips: [] } });
    const h = p.html();
    expect(h).toContain('Amna');
    expect(h).not.toContain(LAT('Amna'));
    // Every mark sits between tags, never inside an attribute value.
    expect(h).not.toMatch(/="[^"]*wq-lat/);
  });
});

describe('the name box', () => {
  function nameBox(value) {
    const p = page({ lang: 'ur' });
    const inp = { className: 'wq-input', value, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
    p.root.fire('input', { target: inp });
    return inp;
  }

  test('a typed Latin name marks the box lang="en"', () => {
    expect(nameBox('Sana Testwala').attrs.lang).toBe('en');
  });

  test('an Urdu name (or a mixed one) leaves the box Urdu', () => {
    expect(nameBox('ثنا').attrs.lang).toBeUndefined();
    expect(nameBox('Sana ثنا').attrs.lang).toBeUndefined();
  });

  test('erasing the Latin name takes the mark off again', () => {
    const p = page({ lang: 'ur' });
    const inp = { className: 'wq-input', value: 'Sana', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
    p.root.fire('input', { target: inp });
    expect(inp.attrs.lang).toBe('en');
    inp.value = '';
    p.root.fire('input', { target: inp });
    expect(inp.attrs.lang).toBeUndefined();
  });
});

describe('the stylesheet', () => {
  test('marked Latin runs and a Latin name box use the sans face at normal word spacing', () => {
    const m = /\nhtml\[lang=ur\] \.wq-lat,html\[lang=ur\] \.wq-input\[lang=en\]\{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m[1]).toContain('font-family:var(--f)');
    expect(m[1]).toContain('word-spacing:normal');
  });
});
