#!/usr/bin/env node
/**
 * Build the child-test print pack v3 (bd-s1oo0.50.4, CONTRACT §21.7) from the v3 item bank.
 *
 *   node bot/scripts/child-test/build-print-pack-v3.js --out <dir> [--bank <item-bank.v3.json>] [--set A]
 *                                                      [--dpi 300] [--no-png]
 *
 * Writes, into --out:
 *   PRINT_ME_v3.pdf                          everything for one coach, in print order (A4, double-sided,
 *                                            flip on the long edge): cover, 4 coach cards, 4 booklets
 *   booklet_{urdu-reading,english-reading,maths-G3,maths-G5}_Set<S>.pdf      the child booklets
 *   coach-card_{urdu-reading,english-reading,maths-G3,maths-G5}_Set<S>.pdf   the coach cards (one sheet)
 *   png/PRINT_ME_v3-NN.png                   every page at --dpi (default 300; needs pdftoppm)
 *   layout.json                              fit scales, overflows, gaps, the page of every task
 * Bank: --bank, else bot/shared/data/child-test/item-bank.v3.json.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const v3 = require('../../shared/services/child-test/render/v3');
const { TASKS_V3 } = require('../../shared/services/child-test/tasks');
const { closeBrowser } = require('../../shared/utils/html-to-pdf');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const NAMES = { ur: 'urdu-reading', en: 'english-reading', ma3: 'maths-G3', ma5: 'maths-G5' };

async function main() {
  const out = arg('out');
  if (!out) throw new Error('--out <dir> is required');
  const bankPath = arg('bank') || path.join(__dirname, '../../shared/data/child-test/item-bank.v3.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  const set = String(arg('set') || 'A').toUpperCase();
  fs.mkdirSync(out, { recursive: true });
  const layout = { bank: bank.version || null, bankPath: path.basename(bankPath), set, files: {}, gaps: v3.gapsOf(bank, set), pages: {} };
  const write = (name, r) => { fs.writeFileSync(path.join(out, name), r.pdf); layout.files[name] = r.layout; return name; };

  for (const b of v3.BOOKLET_ORDER) {
    write(`booklet_${NAMES[b]}_Set${set}.pdf`, await v3.renderBooklet({ bank, set, booklet: b }));
    write(`coach-card_${NAMES[b]}_Set${set}.pdf`, await v3.renderCoachCard({ bank, set, card: b }));
  }
  const pm = write('PRINT_ME_v3.pdf', await v3.renderPrintMe({ bank, set }));

  for (const task of TASKS_V3) {
    if (task.startsWith('ma.')) {
      for (const grade of [3, 5]) layout.pages[`G${grade}:${task}`] = v3.pageFor({ bank, set, grade, task });
    } else layout.pages[task] = v3.pageFor({ bank, set, grade: 3, task });
  }

  if (!process.argv.includes('--no-png')) {
    const dpi = arg('dpi') || '300';
    fs.mkdirSync(path.join(out, 'png'), { recursive: true });
    try {
      execFileSync('pdftoppm', ['-png', '-r', dpi, path.join(out, pm), path.join(out, 'png', 'PRINT_ME_v3')]);
    } catch (err) {
      layout.previews = `pdftoppm failed or missing: ${err.message}`;
    }
  }
  const overflow = Object.entries(layout.files).filter(([, l]) => l && l.overflow && l.overflow.length);
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(layout, null, 2));
  process.stdout.write(`\n${JSON.stringify({ result: { files: Object.keys(layout.files), overflow: overflow.map(([n, l]) => [n, l.overflow]), gaps: layout.gaps } })}\n`);
  if (overflow.length) process.exitCode = 2;
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => closeBrowser().catch(() => {}));
