'use strict';
/**
 * bd-fmf24g.61 — portal/public/open-file.html, the page "Open in another app" hands the phone's browser on Android
 * (bd-fmf24g.60). It forwards to the file by itself, so it must not invite a tap at once: the fallback link stays
 * hidden until a timer of at least 2.5 s. Its script runs here against a stand-in document, location and timer.
 */
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '../../portal/public/open-file.html');
const html = fs.readFileSync(PAGE, 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const b64url = (s) => Buffer.from(s).toString('base64url');

function run(search) {
  const els = {};
  const el = (id) => (els[id] ||= { id, hidden: /id="go"[^>]*hidden/.test(html) && id === 'go', textContent: '', href: '', classList: { add() {}, remove() {} } });
  const timers = [];
  const replaced = [];
  const fn = new Function('document', 'location', 'setTimeout', 'URLSearchParams', 'URL', 'atob', 'TextDecoder', script);
  fn(
    { getElementById: el, documentElement: { lang: '', dir: '' } },
    { search, replace: (u) => replaced.push(u) },
    (cb, ms) => { timers.push({ cb, ms }); return timers.length; },
    URLSearchParams, URL, (s) => Buffer.from(s, 'base64').toString('binary'), TextDecoder,
  );
  return { els, el, timers, replaced };
}

describe('open-file.html', () => {
  const FILE = 'https://digital-coach-audio.abc.r2.cloudflarestorage.com/lp-cache/v8/g4/x.pdf?X-Amz-Signature=1';

  it('forwards to an allowed file at once, and does NOT show "Tap here" until a timer of at least 2.5 s', () => {
    const r = run(`?f=${b64url(FILE)}`);
    expect(r.replaced).toEqual([FILE]);
    expect(r.el('go').hidden).toBe(true); // not shown straight away: the file opens by itself
    expect(r.timers.length).toBe(1);
    expect(r.timers[0].ms).toBeGreaterThanOrEqual(2500);
    r.timers[0].cb();
    expect(r.el('go').hidden).toBe(false);
    expect(r.el('go').href).toBe(FILE);
  });

  it('refuses a host it does not forward to, and says so', () => {
    const r = run(`?f=${b64url('https://evil.example/x.pdf')}`);
    expect(r.replaced).toEqual([]);
    expect(r.el('go').hidden).toBe(true);
  });

  it('looks like NIETE: the icon, the brand colours, Urdu and English', () => {
    expect(html).toContain('/favicon.png');
    expect(html).toMatch(/#47BA7D/i);
    expect(html).toMatch(/#333748/i);
    expect(html).toContain('Noto Nastaliq Urdu');
    expect(html).toContain('فائل کھل رہی ہے');
    expect(html).toContain('Opening the file');
  });

  it('forwards only to the hosts ShareActions hands off (the two lists are kept in step)', () => {
    const page = /var HOST = (\/.*\/i);/.exec(html)[1];
    const kit = /export const HANDOFF_HOST = (\/.*\/i);/.exec(fs.readFileSync(path.join(__dirname, '../../portal/src/portal/teacher/ui/ShareActions.tsx'), 'utf8'))[1];
    expect(page).toBe(kit);
  });
});
