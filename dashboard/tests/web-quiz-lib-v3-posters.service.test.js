/**
 * Web quiz page: the video library's poster fallback under app_settings web_quiz_videos_v3. The bot marks a
 * v3 chapters list with `tile: 'neutral'` and gives each chapter its `art` (its first poster): a card shows
 * its own poster, then the chapter's art, then a plain tile, never the subject art. Without the marker
 * the card is today's. Runs the shipped wq-lib.js + wq.js in the harness's vm; the bot API is faked.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Noor Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Noor Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const V = (n) => `aaaaaa${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const L1 = { grade: '3', mine: 'Science', grades: [{ g: '3', n: 3, art: '/wq/art/grade-3-1.webp' }], subjects: [{ key: 'Science', n: 3, art: '/wq/art/subject-science-1.webp' }] };
const P1 = 'https://r2.example/p1.jpg?X-Amz-Signature=y';
const P2 = 'https://r2.example/p2.jpg?X-Amz-Signature=x';
const chapters = () => [
  { name: 'Plants', videos: [
    { vid: V(2), title: 'Leaves', poster: P2 },
    { vid: V(1), title: 'Parts of a Flower', poster: P1 },
    { vid: V(4), title: 'Roots' },
  ] },
  { name: 'Animals', videos: [{ vid: V(3), title: 'Hen' }] },
];
const L2_OFF = { grade: '3', subject: 'Science', art: '/wq/art/subject-science-1.webp', chapters: chapters() };
const L2_V3 = { grade: '3', subject: 'Science', art: '/wq/art/subject-science-1.webp', tile: 'neutral',
  chapters: chapters().map((c) => (c.videos[0].poster ? { ...c, art: c.videos[0].poster } : c)) };

async function opened(l2) {
  const p = page({ lang: 'en', store: finished(), lib: true, api: { '/lib/TEST?st=s1&s=Science': l2, '/lib/TEST?st=s1': L1 } });
  await flush(); await flush();
  p.els['#wq-more'].fire('click');
  await flush();
  return p.html();
}
const attr = (tag, k) => { const m = new RegExp(` ${k}="([^"]*)"`).exec(tag); return m ? m[1].replace(/&amp;/g, '&') : undefined; };
const imgs = (h) => (h.match(/<img [^>]*>/g) || []).filter((tag) => /r2\.example/.test(tag))
  .map((tag) => ({ src: attr(tag, 'src'), f: attr(tag, 'data-f'), onerror: attr(tag, 'onerror') }));
// The card's onerror run against a stand-in <img>, the way the browser would on a broken picture.
function breakIt(img) {
  const el = { src: img.src, attrs: img.f ? { 'data-f': img.f } : {}, style: {} };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.removeAttribute = (k) => { delete el.attrs[k]; };
  const run = new Function(img.onerror.replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  return { el, fire: () => run.call(el) };
}

describe('web_quiz_videos_v3 on (tile: neutral)', () => {
  test('no subject art behind a card; own poster first, then the chapter art, then the plain tile', async () => {
    const h = await opened(L2_V3);
    expect(h).not.toContain('background-image:url(/wq/art/subject-science-1.webp)');
    const [leaves, flower, roots] = imgs(h);
    expect(leaves).toMatchObject({ src: P2 });        // the chapter art IS this poster: nothing else to try
    expect(flower).toMatchObject({ src: P1, f: P2 });
    expect(roots).toMatchObject({ src: P2 });         // no poster of its own: the chapter's art
    const b = breakIt(flower);
    b.fire();
    expect(b.el.src).toBe(P2);
    expect(b.el.style.display).toBeUndefined();
    b.fire();                                         // the chapter art is broken too: the plain tile shows
    expect(b.el.style.display).toBe('none');
  });

  test('a chapter with no poster at all: a plain tile, no picture', async () => {
    const h = await opened(L2_V3);
    expect(h).toMatch(/<span class="wql-thumb"><\/span><span class="wql-txt"><b dir="auto">Hen<\/b>/);
  });
});

describe('web_quiz_videos_v3 off (no marker): today\'s card', () => {
  test('subject art behind every card, the poster hides itself when broken, no chapter art used', async () => {
    const h = await opened(L2_OFF);
    expect(h).toContain('<span class="wql-thumb" style="background-image:url(/wq/art/subject-science-1.webp)">');
    const all = imgs(h);
    expect(all.map((i) => i.src)).toEqual([P2, P1]);
    expect(all.every((i) => i.f === undefined && i.onerror === "this.style.display='none'")).toBe(true);
  });
});
