/**
 * The quiz page's result screen (wq.js results()) on a round that does not count (finish answers counted:false).
 * "Play again" (?again=1) runs on the child's OWN phone, so the screen never says "another phone": it shows the
 * practice line the card already has (TW.practice, the kept first-try score). The finish's reason
 * 'already_finished' (this device finished before) says the same. "Another phone" stays only for a true other
 * phone (reason 'finished_elsewhere' on a page that was not opened with ?again=1). A teacher's own run (reason
 * 'preview') is never "another phone" and never the practice line (it keeps no score): its own line, "not saved for
 * your class". All of it rides the finish card (card_v3); with card_v3 off the screen is today's.
 * Runs the whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara Testwala', chip: '0123456789abcdef', animal: 'owl' };
const OTHER = { en: 'another phone', ur: 'کسی اور فون' };
const PREVIEW = { en: "This is your preview. It isn&#39;t saved for your class.", ur: 'یہ صرف آپ کے دیکھنے کے لیے ہے۔ یہ کلاس کے لیے محفوظ نہیں ہوا۔' };
const PRACTICE = { en: 'Practice round · your first score 4/5 is the one that counts', ur: 'مشق کا راؤنڈ · پہلی بار کا اسکور ۴/۵ شمار ہوتا ہے' };
const finishBody = (reason, cardV3 = true) => ({
  score: { correct: 2, total: 5, pct: 40 }, counted: false, reason, ...(cardV3 ? { card_v3: true } : {}),
  card: { first: 'Zara', animal: 'owl', correct: 2, total: 5, stars: 2, practice: true, kept: { correct: 4, total: 5 } },
});
// A finished attempt kept on this phone (the first, counted try); ?again=1 clears it and a new round is played.
const kept = { wq_s_TEST: { st: 'old-st', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: { score: { correct: 4, total: 5 }, card: { first: 'Zara' } } } };
// The second round's state (a fresh st on this phone) when the page was opened without ?again=1.
const playing = { wq_s_TEST: { st: 'new-st', child: CHILD, answers: { q1: { slot: 'B', ok: false } }, queue: [], result: null } };

async function end(p) {
  p.wq.S.st = p.wq.S.st || 'new-st';
  p.wq.results(0);
  await flush(); await flush(); await flush();
  expect(p.moment()).toBe('M9');
  return p.html();
}

describe.each(['en', 'ur'])('%s: a round that does not count', (lang) => {
  test('opened with ?again=1 (Play again on this phone), the server saying finished_elsewhere: no "another phone", the practice line', async () => {
    const p = page({ lang, store: kept, search: '?again=1', api: { finish: finishBody('finished_elsewhere') } });
    const h = await end(p);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).toContain(PRACTICE[lang]);
  });

  test('the server says already_finished (this device finished before): no "another phone", the practice line', async () => {
    const p = page({ lang, store: playing, api: { finish: finishBody('already_finished') } });
    const h = await end(p);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).toContain(PRACTICE[lang]);
  });

  test('a teacher\'s own run (reason preview): its own line, never "another phone", never the practice line', async () => {
    const p = page({ lang, store: playing, api: { finish: finishBody('preview') } });
    const h = await end(p);
    expect(h).toContain(PREVIEW[lang]);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).not.toContain(PRACTICE[lang]);
  });

  test('a teacher\'s own run opened with ?again=1, no kept score: the preview line still', async () => {
    const body = finishBody('preview'); delete body.card.kept; delete body.card.practice;
    const p = page({ lang, store: kept, search: '?again=1', api: { finish: body } });
    const h = await end(p);
    expect(h).toContain(PREVIEW[lang]);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).not.toMatch(lang === 'en' ? /Practice round/ : /مشق کا راؤنڈ/);
  });

  test('already_finished with no kept score on the card: the practice line with this round\'s score', async () => {
    const body = finishBody('already_finished'); delete body.card.kept;
    const p = page({ lang, store: playing, api: { finish: body } });
    const h = await end(p);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).toContain(lang === 'en' ? 'Practice round · your first score 2/5 is the one that counts' : 'مشق کا راؤنڈ · پہلی بار کا اسکور ۲/۵ شمار ہوتا ہے');
  });

  test('card_v3 off: today\'s "another phone" line on every reason, ?again=1 too', async () => {
    for (const [reason, search, store] of [['finished_elsewhere', '?again=1', kept], ['already_finished', '', playing], ['preview', '', playing]]) {
      const p = page({ lang, store, search, api: { finish: finishBody(reason, false) } });
      const h = await end(p);
      expect(h).toContain(OTHER[lang]);
      expect(h).not.toContain(PRACTICE[lang]);
      expect(h).not.toContain(PREVIEW[lang]);
    }
  });

  test('a true other phone (finished_elsewhere, no ?again=1): the "another phone" line, unchanged', async () => {
    const p = page({ lang, store: playing, api: { finish: finishBody('finished_elsewhere') } });
    const h = await end(p);
    expect(h).toContain(OTHER[lang]);
    expect(h).not.toContain(PRACTICE[lang]);
  });

  test('a counted round: neither line', async () => {
    const p = page({ lang, store: playing, api: { finish: { score: { correct: 4, total: 5, pct: 80 }, counted: true, card: { first: 'Zara', correct: 4, total: 5 } } } });
    const h = await end(p);
    expect(h).not.toContain(OTHER[lang]);
    expect(h).not.toContain(PRACTICE[lang]);
  });
});
