/**
 * bd-nnco2 — the DC-intro broadcast's "View notification" quick-reply button.
 *
 * A template quick-reply arrives as messageType='button' with
 * message.button.payload (the same branch carousel buttons use). Tapping
 * VIEW_FDE_NOTIFICATION must (1) deliver the official FDE authorization
 * letter as a document and (2) log a countable tracking event.
 *
 * The PDF ships as a repo asset: no hosting, no env var, no expiring URL —
 * and sendDocument logs "sent successfully" even when the path is missing
 * (known trap), so the asset's existence is asserted here, red-first.
 */
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '../../bot');
const ASSET = path.join(BOT, 'shared/assets/fde-notification-digital-coach.pdf');

const src = () => fs.readFileSync(path.join(BOT, 'whatsapp-bot.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('bd-nnco2 — FDE notification button', () => {
  it('the PDF asset exists in the repo and is a real file (sendDocument silent-miss trap)', () => {
    expect(fs.existsSync(ASSET)).toBe(true);
    expect(fs.statSync(ASSET).size).toBeGreaterThan(100_000);
    const head = fs.readFileSync(ASSET).slice(0, 5).toString();
    expect(head).toBe('%PDF-');
  });

  it('the template-button dispatch handles VIEW_FDE_NOTIFICATION and sends the document', () => {
    const s = src();
    expect(s).toContain("'VIEW_FDE_NOTIFICATION'");
    const branch = s.slice(s.indexOf("'VIEW_FDE_NOTIFICATION'"), s.indexOf("'VIEW_FDE_NOTIFICATION'") + 1200);
    expect(branch).toContain('sendDocument');
    expect(branch).toContain('fde-notification-digital-coach.pdf');
  });

  it('the tap logs the countable tracking event', () => {
    expect(src()).toContain('broadcast.fde_notification_viewed');
  });
});
