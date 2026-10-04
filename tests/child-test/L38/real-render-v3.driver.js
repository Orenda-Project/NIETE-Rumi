/**
 * Driver for real-render-v3.test.js: renders the v3 print pack with the real Chromium and prints one
 * JSON line `{"result": …}` — per file: PDF page count, every page A4, the fit pass's overflow list and
 * scales. Bank: CHILD_TEST_BANK_V3, else the committed bank if it exists, else the L38 fixture.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const v3 = require(path.join(ROOT, 'bot/shared/services/child-test/render/v3'));
const { closeBrowser } = require(path.join(ROOT, 'bot/shared/utils/html-to-pdf'));
const { PDFDocument } = require(path.join(ROOT, 'bot/node_modules/pdf-lib'));

const committed = path.join(ROOT, 'bot/shared/data/child-test/item-bank.v3.json');
const bankPath = process.env.CHILD_TEST_BANK_V3 || (fs.existsSync(committed) ? committed : path.join(__dirname, 'fixtures/item-bank.v3.fixture.json'));
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

async function pdfInfo(buf) {
  const doc = await PDFDocument.load(buf);
  const pages = doc.getPages();
  return { pages: pages.length, a4: pages.every((p) => Math.abs(p.getWidth() - 595.28) < 2 && Math.abs(p.getHeight() - 841.89) < 2) };
}

(async () => {
  const result = { bank: path.basename(bankPath), booklets: {}, coachCards: {}, printMe: null, expected: {} };
  for (const b of v3.BOOKLET_ORDER) {
    const r = await v3.renderBooklet({ bank, set: 'A', booklet: b });
    result.booklets[b] = { ...(await pdfInfo(r.pdf)), overflow: r.layout.overflow, scales: r.layout.scales };
    const n = v3.bookletPlan(bank, 'A', b).pages.length;
    result.expected[b] = n + (n % 2);
    const c = await v3.renderCoachCard({ bank, set: 'A', card: b });
    result.coachCards[b] = { ...(await pdfInfo(c.pdf)), overflow: c.layout.overflow, scales: c.layout.scales };
  }
  const p = await v3.renderPrintMe({ bank, set: 'A' });
  result.printMe = { ...(await pdfInfo(p.pdf)), overflow: p.layout.overflow, scales: p.layout.scales };
  await closeBrowser();
  process.stdout.write(`\n${JSON.stringify({ result })}\n`);
})().catch(async (err) => { console.error(err); await closeBrowser().catch(() => {}); process.exit(1); });
