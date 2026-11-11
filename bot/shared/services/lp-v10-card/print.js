'use strict';
/**
 * The v10 card's print PDF, as ICT's shots.js makes it: a 520x2000 viewport under print media, one 520-wide page 2000 tall or as long as the card,
 * backgrounds on. Returns the printed height of .page; the caller refuses a card with none. The browser is launched
 * as the v9 renderer launches it (render_lp.js: LP612_CHROME_CHANNEL, container flags).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function chromeChannel() {
  const explicit = process.env.LP612_CHROME_CHANNEL;
  if (explicit) return explicit === 'bundled' ? undefined : explicit;
  return process.platform === 'darwin' ? 'chrome' : undefined;
}

async function printCard(html, outPdf, { pw = require('playwright-core') } = {}) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  const channel = chromeChannel();
  const browser = await pw.chromium.launch(channel ? { channel, args } : { args });
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'v10card-'));
  const file = path.join(tmp, 'card.html');
  try {
    await fs.promises.writeFile(file, html);
    const page = await browser.newPage({ viewport: { width: 520, height: 2000 } });
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const printPx = await page.evaluate(() => { const p = document.querySelector('.page'); return p ? p.scrollHeight : null; });
    // A card longer than 2000px prints whole on one longer page rather than being dropped (sandbox, 7 Nov).
    const h = Math.max(2000, printPx || 0);
    // bd-snkn32.23: the card's CSS fixes @page at 2000px tall, which split a longer card in two; this rule comes last and wins.
    await page.addStyleTag({ content: `@page{size:520px ${h}px;margin:0}` });
    await page.pdf({ path: outPdf, width: '520px', height: `${h}px`, printBackground: true });
    return { printPx };
  } finally {
    await browser.close();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

module.exports = { printCard, chromeChannel };
