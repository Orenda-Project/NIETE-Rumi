/**
 * Driver for real-render-v2.test.js: renders the v2 print pack with the real Chromium and prints
 * one JSON line `{"result": …}` — PDF page counts and sizes, the fit pass's overflow list, and the
 * setup picture's pixel size, and the coach cards (L33). Bank: CHILD_TEST_BANK, else the committed
 * v2 bank (the coach cards need its coach lines and oral maths).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const v2 = require(path.join(ROOT, 'bot/shared/services/child-test/render/v2'));
const { closeBrowser } = require(path.join(ROOT, 'bot/shared/utils/html-to-pdf'));
const { PDFDocument } = require(path.join(ROOT, 'bot/node_modules/pdf-lib'));

const bankPath = process.env.CHILD_TEST_BANK || path.join(ROOT, 'bot/shared/data/child-test/item-bank.v1.json');
const itemBank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

async function pdfInfo(buf) {
  const doc = await PDFDocument.load(buf);
  const pages = doc.getPages();
  return { pages: pages.length, a4: pages.every((p) => Math.abs(p.getWidth() - 595.28) < 2 && Math.abs(p.getHeight() - 841.89) < 2) };
}

function pngSize(buf) {
  return { isPng: buf.slice(1, 4).toString() === 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
  const result = { cards: [], printMe: [], coach: null, pictures: {}, coachCards: [] };
  for (const set of ['A', 'B']) {
    for (const grade of [3, 5]) {
      const r = await v2.renderCards({ grade, set, itemBank, notYet: set === 'B' });
      result.cards.push({ grade, set, ...(await pdfInfo(r.pdf)), overflow: r.layout.overflow });
      const cc = await v2.renderCoachCard({ grade, set, itemBank, notYet: set === 'B' });
      result.coachCards.push({ grade, set, ...(await pdfInfo(cc.pdf)), overflow: cc.layout.overflow, scale: cc.layout.scales[`g${grade}/coachcard`] });
    }
    const p = await v2.renderPrintMe({ itemBank, set });
    result.printMe.push({ set, ...(await pdfInfo(p.pdf)), overflow: p.layout.overflow });
  }
  const c = await v2.renderCoachPage();
  result.coach = { ...(await pdfInfo(c.pdf)), overflow: c.layout.overflow };
  for (const lang of ['en', 'ur']) result.pictures[lang] = pngSize(await v2.renderSetupPicture(lang));
  await closeBrowser();
  process.stdout.write(`\n${JSON.stringify({ result })}\n`);
})().catch(async (err) => { console.error(err); await closeBrowser().catch(() => {}); process.exit(1); });
