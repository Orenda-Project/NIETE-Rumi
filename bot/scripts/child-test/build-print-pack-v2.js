#!/usr/bin/env node
/**
 * Build the child-test print pack v2 (bd-s1oo0.46.5) from the item bank.
 *
 *   node bot/scripts/child-test/build-print-pack-v2.js --out <dir> [--bank <item-bank.json>] [--data-dir <dir>]
 *
 * Writes, into --out:
 *   PRINT_ME.pdf                                   Set A, everything for one coach, in print order
 *   PRINT_ME_SetB_NEXT-TERM_do-not-print-yet.pdf   Set B, the same, stamped
 *   cards_G{3,5}_Set{A,B}*.pdf                     the six card sides per grade and set
 *   coach-page_en-ur.pdf                           English front, Urdu back
 *   setup-picture-{en,ur}.png                      the "before the first child" picture
 *   png/…                                          a preview of every PDF page (needs pdftoppm)
 *   layout.json                                    fit scales, overflows, where the maths items came from
 * and, with --data-dir, setup-picture-{en,ur}.png there too (the bot sends them).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const v2 = require('../../shared/services/child-test/render/v2');
const { closeBrowser } = require('../../shared/utils/html-to-pdf');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const out = arg('out');
  if (!out) throw new Error('--out <dir> is required');
  const bankPath = arg('bank');
  const itemBank = bankPath ? JSON.parse(fs.readFileSync(bankPath, 'utf8')) : require('../../shared/data/child-test/item-bank.v1.json');
  const dataDir = arg('data-dir');
  fs.mkdirSync(path.join(out, 'png'), { recursive: true });
  const layout = { bank: itemBank.version || null, bankPath: bankPath ? path.basename(bankPath) : 'item-bank.v1.json', files: {}, maths: {} };

  const write = (name, buf) => { fs.writeFileSync(path.join(out, name), buf); return name; };
  const pdfs = [];

  for (const set of ['A', 'B']) {
    for (const grade of [3, 5]) {
      const form = itemBank.grades[String(grade)].forms[set];
      layout.maths[`G${grade}-${set}`] = v2.oralMaths({ grade, set, form }).source;
      const notYet = set === 'B';
      const r = await v2.renderCards({ grade, set, itemBank, notYet });
      const name = write(`cards_G${grade}_Set${set}${notYet ? '_NEXT-TERM' : ''}.pdf`, r.pdf);
      layout.files[name] = r.layout;
      pdfs.push(name);
    }
    const p = await v2.renderPrintMe({ itemBank, set });
    const name = write(set === 'A' ? 'PRINT_ME.pdf' : 'PRINT_ME_SetB_NEXT-TERM_do-not-print-yet.pdf', p.pdf);
    layout.files[name] = p.layout;
    pdfs.push(name);
  }
  const c = await v2.renderCoachPage();
  layout.files[write('coach-page_en-ur.pdf', c.pdf)] = c.layout;
  pdfs.push('coach-page_en-ur.pdf');

  for (const lang of ['en', 'ur']) {
    const png = await v2.renderSetupPicture(lang);
    write(`setup-picture-${lang}.png`, png);
    if (dataDir) fs.writeFileSync(path.join(dataDir, `setup-picture-${lang}.png`), png);
  }

  for (const name of pdfs) {
    try {
      execFileSync('pdftoppm', ['-png', '-r', '70', path.join(out, name), path.join(out, 'png', name.replace(/\.pdf$/, ''))]);
    } catch (err) {
      layout.previews = `pdftoppm failed or missing: ${err.message}`;
    }
  }
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(layout, null, 2));
  process.stdout.write(`\n${JSON.stringify({ result: layout })}\n`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => closeBrowser().catch(() => {}));
