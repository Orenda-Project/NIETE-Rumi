// bd-snkn32.4 — print a day's STORED plan through the Make my own page (no rewrite): checks the renderer on real
// grades 1–5 data (an Urdu book in embedded Nastaliq, an English one with its local lines). Writes
// <lesson>.stored.pdf and a 360px screenshot <lesson>.stored-360.png beside this file.
// Usage: node docs/lp612/make-my-own-g1-5/render-stored.js <lessonId>:<way> ...   (env: SUPABASE_*, sandbox, read-only)
const path = require('path');
const root = path.join(__dirname, '../../..');
const { loadK5 } = require(path.join(root, 'bot/shared/services/lp-k5-own-source'));
const { renderK5Own, WAY_NAMES } = require(path.join(root, 'bot/shared/services/lp-k5-own-render'));
const { fontCss } = require(path.join(root, 'bot/shared/services/lp-k5-own-fonts'));
const { printCard } = require(path.join(root, 'bot/shared/services/lp-v10-card/print'));

(async () => {
  const pw = require(path.join(root, 'bot/node_modules/playwright-core'));
  for (const [lessonId, way] of process.argv.slice(2).map((a) => a.split(':'))) {
    const day = await loadK5(lessonId);
    if (!day) { console.log(lessonId, 'no stored plan'); continue; }
    const html = renderK5Own(day.script, {
      lang: day.lang, grade: day.grade, subject: day.subjectName, way: WAY_NAMES[day.lang][way || 'story'], fontCss: fontCss(day.lang),
    });
    const { printPx } = await printCard(html, path.join(__dirname, `${lessonId}.stored.pdf`), { pw });
    const b = await pw.chromium.launch({ channel: 'chrome' });
    const p = await b.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(__dirname, `${lessonId}.stored-360.png`) });
    const wide = await p.evaluate(() => document.documentElement.scrollWidth);
    await b.close();
    console.log(JSON.stringify({ lessonId, lang: day.lang, printPx, scrollWidth360: wide, htmlKB: Math.round(html.length / 1024) }));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
