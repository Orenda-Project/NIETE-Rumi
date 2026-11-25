'use strict';
/**
 * bd-chz35n.25 (3) — how long a teacher keeps her coaching report page (/cr) in view.
 *
 * The 25 Nov trace could count opens but not reading: the page is server-rendered and sent nothing back. With
 * app_settings.report_delivery_fixes.time_on_page on (report-delivery-switch.js; OFF by default, and then the page is
 * byte for byte today's), the page carries the small script below: it adds up the time the page is visible and, each
 * time she hides or leaves it, sends that slice with navigator.sendBeacon to POST /cr/<token>/time, which logs
 * `coaching.report_page.time` { sessionId, userId, screen, ms }. Several slices for one visit are summed in analysis.
 * Nothing is stored in the database; the event goes to the portal's own log sink like the page's other events.
 */

const MAX_MS = 3 * 60 * 60 * 1000;
const SCREENS = new Set(['card', 'detail']);

/** The inline script for one screen. `path` is the beacon's own /cr/<token>/time path. */
function timingScript(path, screen) {
  const p = JSON.stringify(String(path)).replace(/</g, '\\u003c');
  const s = JSON.stringify(SCREENS.has(screen) ? screen : 'card');
  return `<script>(function(){var u=${p},s=${s},t=0,a=document.visibilityState==='visible'?Date.now():0;`
    + 'function f(){if(a){t+=Date.now()-a;a=0}if(t>0&&navigator.sendBeacon){var b=new URLSearchParams();b.set("ms",String(t));b.set("screen",s);navigator.sendBeacon(u,b);t=0}}'
    + "document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'){a=Date.now()}else{f()}});"
    + "window.addEventListener('pagehide',f)})();</script>";
}

/** The page with the script just before </body>; a page without one is returned as it was. */
function withTiming(html, path, screen) {
  const at = typeof html === 'string' ? html.lastIndexOf('</body>') : -1;
  if (at < 0) return html;
  return `${html.slice(0, at)}${timingScript(path, screen)}\n${html.slice(at)}`;
}

/** { ms, screen } from the beacon's form body, ms clamped to 0..3 h and rounded; null when ms is not a number. */
function parseTime(body) {
  const raw = body && body.ms;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const ms = Math.min(MAX_MS, Math.max(0, Math.round(n)));
  const screen = body && SCREENS.has(body.screen) ? body.screen : 'card';
  return { ms, screen };
}

module.exports = { timingScript, withTiming, parseTime, MAX_MS };
