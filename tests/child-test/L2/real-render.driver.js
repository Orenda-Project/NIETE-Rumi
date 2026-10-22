/**
 * Driver for real-render.test.js and the lane's legibility proof: renders every card for
 * G3/G5 Form A with the real Chromium and prints one JSON line `{"result": …}`.
 *
 * Bank: the committed item bank if it exists (bot/shared/data/child-test/item-bank.v1.json),
 * else the test fixture. Set CHILD_TEST_PROOF_DIR to also write the PNGs and PDFs there.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const render = require(path.join(ROOT, 'bot/shared/services/child-test/render'));
const { closeBrowser } = require(path.join(ROOT, 'bot/shared/utils/html-to-pdf'));
const { PDFDocument } = require(path.join(ROOT, 'bot/node_modules/pdf-lib'));

const committed = path.join(ROOT, 'bot/shared/data/child-test/item-bank.v1.json');
const bankPath = process.env.CHILD_TEST_BANK || (fs.existsSync(committed) ? committed : path.join(__dirname, 'fixtures/item-bank.fixture.json'));
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const OUT = process.env.CHILD_TEST_PROOF_DIR || null;
const GRADES = (process.env.CHILD_TEST_GRADES || '3,5').split(',').map(Number);
const FORMS = (process.env.CHILD_TEST_FORMS || 'A').split(',');

const isPng = (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

async function pdfInfo(buf) {
  const doc = await PDFDocument.load(buf);
  const pages = doc.getPages();
  const a4 = pages.every((p) => Math.abs(p.getWidth() - 595.28) < 2 && Math.abs(p.getHeight() - 841.89) < 2);
  return { pages: pages.length, a4 };
}

(async () => {
  const result = { bank: path.relative(ROOT, bankPath), bankVersion: bank.version, inline: {}, printable: [], coach: [] };
  try {
    for (const grade of GRADES) for (const form of FORMS) {
      for (const block of ['urdu', 'english', 'maths']) for (const variant of ['main', 'fallback']) {
        if (block === 'maths' && variant === 'fallback') continue;
        const cards = await render.renderInlineCards({ grade, form, block, variant, itemBank: bank });
        const k = `g${grade}-${form}-${block}-${variant}`;
        result.inline[k] = {
          tokens: variant === 'main' && block !== 'maths' ? bank.grades[String(grade)].forms[form][block].story.tokens : [],
          cards: cards.map((c) => ({ part: c.part, index: c.index, text: c.text, lines: c.lines, widthPx: c.widthPx, heightPx: c.heightPx, isPng: isPng(c.png), bytes: c.png.length })),
        };
        if (OUT) {
          const dir = path.join(OUT, 'inline', k);
          fs.mkdirSync(dir, { recursive: true });
          cards.forEach((c) => fs.writeFileSync(path.join(dir, `${String(c.index).padStart(2, '0')}-${c.part}.png`), c.png));
        }
      }
      let layout = null;
      const pdf = await render.renderPrintableCard({ grade, form, itemBank: bank, onLayout: (r) => { layout = r; } });
      result.printable.push({ grade, form, ...(await pdfInfo(pdf)), overflow: layout ? layout.overflow : null, scales: layout ? layout.scales : null });
      const coach = await render.renderCoachSheet({ grade, form, itemBank: bank });
      result.coach.push({ grade, form, ...(await pdfInfo(coach)) });
      if (OUT) {
        fs.mkdirSync(path.join(OUT, 'pdf'), { recursive: true });
        fs.writeFileSync(path.join(OUT, 'pdf', `child-card-g${grade}-${form}.pdf`), pdf);
        fs.writeFileSync(path.join(OUT, 'pdf', `coach-sheet-g${grade}-${form}.pdf`), coach);
      }
    }
  } finally {
    await closeBrowser();
  }
  process.stdout.write(`\n${JSON.stringify({ result })}\n`);
})().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
