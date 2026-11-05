/**
 * Coach reports in the app — the drafted UTILITY template coach_report_ready_v1 (en, ur) is inside Meta's caps, has
 * no variable in its body (it names nobody: messages get forwarded), one URL button carrying the signed link token,
 * the button word the bot's cta_url uses, and the name and languages the sweep sends with.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/templates/drafts');
const cp = (s) => [...String(s)].length;
const load = (lang) => JSON.parse(fs.readFileSync(path.join(DIR, `coach_report_ready_v1_${lang}.json`), 'utf8'));
const { TEMPLATE_DEFAULT } = require('../../bot/shared/services/observe/coach-report-whatsapp.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

for (const lang of ['en', 'ur']) {
  test(`${lang}: inside the caps, no body variable, one URL button with the token`, () => {
    const t = load(lang);
    expect(t.name).toBe(TEMPLATE_DEFAULT);
    expect(t.category).toBe('UTILITY');
    expect(t.language).toBe(lang);
    const body = t.components.find((c) => c.type === 'BODY');
    const foot = t.components.find((c) => c.type === 'FOOTER');
    const [button] = t.components.find((c) => c.type === 'BUTTONS').buttons;
    expect(cp(body.text)).toBeLessThanOrEqual(1024);
    expect(body.text).not.toMatch(/\{\{/);
    expect(cp(foot.text)).toBeLessThanOrEqual(60);
    expect(button.type).toBe('URL');
    expect(cp(button.text)).toBeLessThanOrEqual(25);
    expect(button.url).toMatch(/\/t\/\{\{1\}\}$/);
    expect(button.text).toBe(observeStrings(lang).coach_report_link_button);
  });
}
