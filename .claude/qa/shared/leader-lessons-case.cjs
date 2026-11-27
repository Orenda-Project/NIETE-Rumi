'use strict';
/* leader-lessons-case.cjs — the step every "a leader's lesson-plan request opens the Lesson Plans tab" scenario takes
 * (menu M41, lesson-plan L132/L133/L135/L136/L138/L139/L140; bd-q8wt5e.6.3).
 *
 * The switch is `leader_app_lesson_plan` (app-redirect.service.js 2d): true, "coaches", or a list of users.id; anything
 * else — false, no row — is OFF. It is a GLOBAL app_settings row, so it is flipped only on the run's own local database
 * (api.setAppSetting refuses anywhere else) and put back whatever happens. The driver's role is set for the case and
 * put back to teacher (the harness also restores it after the feature).
 *
 * What a case reads back: every message the request brought (after a short settle), the cta_url buttons among them,
 * and where each button lands — its /go/<token> decoded with the bot's OWN key from the run's src/.env, the way /go
 * reads it (observe.cjs landingOfLink), then mapped to its page (app-login-link.js leaderPathFor). No portal runs on
 * the mock lane, so "signed in" is read from the token: it verifies, and it carries the driver's own user id.
 */
const fs = require('fs');
const path = require('path');

const KEY = 'leader_app_lesson_plan';
const LESSONS_PAGE = '/portal/teacher/lessons';
const LP_CARD = /سبق کے منصوبے|Lesson Plans/;

/** Where a /go/<token> link lands: { feature, page, user } or null (no stack, or the token does not verify). */
function landingOfLink(url) {
  try {
    const dir = require(path.join(__dirname, '..', 'engine', 'bin', 'stack-control.cjs')).runDir();
    if (!dir || !url) return null;
    const src = path.join(dir, 'src');
    const env = {};
    for (const line of fs.readFileSync(path.join(src, '.env'), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    const keep = { INTERNAL_API_KEY: process.env.INTERNAL_API_KEY, SUPABASE_URL: process.env.SUPABASE_URL };
    process.env.INTERNAL_API_KEY = env.INTERNAL_API_KEY || ''; process.env.SUPABASE_URL = env.SUPABASE_URL || '';
    try {
      const L = require(path.join(src, 'bot/shared/services/app-login-link.js'));
      const p = L.verifyAppLink(String(url).split('/go/')[1] || '');
      return p ? { feature: p.f, page: L.leaderPathFor(p.f), user: p.u } : null;
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  } catch (_) { return null; }
}

/** Everything a request brought: send (or run `act`), wait for the first reply, settle, then read the rest. */
async function collect(api, act, settleMs = 4000) {
  await api.freshReset();
  const first = await act();
  await new Promise((r) => setTimeout(r, settleMs));
  const items = await api.fresh();
  const all = items.length ? items : (first && first.ok ? [first] : []);
  const ctas = all.filter((m) => m.cta && m.cta.url);
  const lpMenu = all.some((m) => m.flow || (LP_CARD.test(m.txt || '') && (m.btns || []).length > 0));
  const textbookLine = all.some((m) => /straight from your own textbook|اپنی درسی کتاب سے/.test(m.txt || ''));
  return { first, all, ctas, lpMenu, textbookLine,
    messages: all.map((m) => ({ txt: (m.txt || '').slice(0, 120), btns: m.btns, cta: m.cta ? m.cta.text || null : null, flow: !!m.flow, audio: !!m.audio })) };
}

/** Run `fn` as `role` with the leader switch at `value` (false = OFF). { ran:false, reason } off the local lane. */
async function withLeaderSwitch(api, value, role, fn) {
  if (!api || typeof api.setAppSetting !== 'function') return { ran: false, reason: 'GLOBAL_SWITCH: this lane cannot flip app_settings' };
  const flip = await api.setAppSetting(KEY, value);
  if (!flip || !flip.ok) return { ran: false, reason: (flip && flip.err) || 'GLOBAL_SWITCH' };
  try {
    const r = await api.setRole(role);
    if (!r || !r.ok) return { ran: false, reason: 'could not make the driver a ' + role + ': ' + JSON.stringify(r) };
    await api.resetFlow();
    return { ran: true, value: await fn() };
  } finally {
    await api.restoreAppSettings();
    await api.setRole('teacher');
  }
}

/** The bot's own copy for the leader link, both languages (ux-strings appLink*LeaderLessonPlan): the driver may be Urdu. */
const { UX_STRINGS: UX } = require(path.resolve(__dirname, '..', '..', '..', 'bot/shared/config/ux-strings.js'));
const LEADER_BODY = [UX.appLinkBodyLeaderLessonPlan.en, UX.appLinkBodyLeaderLessonPlan.ur];
const LEADER_BUTTON = [UX.appLinkButtonLeaderLessonPlan.en, UX.appLinkButtonLeaderLessonPlan.ur];

/** The one-button verdict: exactly one message, one "Lesson plans" cta landing on the tab for this user, no LP menu.
 *  `body: true` also requires the leader body ("Read the lesson plans your teachers get.", or its Urdu). */
function tabVerdict(c, driverId, { body } = {}) {
  const m = c.ctas[0];
  const cta = m ? m.cta : null;
  const land = cta ? landingOfLink(cta.url) : null;
  const bodyOk = !body || LEADER_BODY.includes(String(m && m.txt || '').trim());
  const ok = c.all.length === 1 && c.ctas.length === 1 && LEADER_BUTTON.includes(cta.text)
    && !!land && land.page === LESSONS_PAGE && (!driverId || land.user === driverId) && !c.lpMenu && bodyOk;
  return [ok, { count: c.all.length, body: m ? String(m.txt || '').slice(0, 80) : null, bodyOk, button: cta ? cta.text : null,
    link: cta ? String(cta.url).replace(/\/go\/.*/, '/go/<token>') : null,
    landing: land, signedInAs: land ? (land.user === driverId ? 'the driver' : land.user) : null,
    lpMenu: c.lpMenu, textbookLine: c.textbookLine, messages: c.messages }];
}

/** The driver's users.id, from the training tool's driver-user read (same as lesson-plan.cjs L12). */
function driverId(api) {
  try {
    const o = api.db('driver-user');
    const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    return line ? JSON.parse(line).id : null;
  } catch (_) { return null; }
}

const LEADER_BLOCKED = 'needs leader_app_lesson_plan set, and the switch is global: on a shared database it would move every leader for the length of the run. Runs on the local lane (E2E_LOCAL_DB=1). Unit: tests/app-redirect/app-link-leader-lessons-doors.test.js';

module.exports = { LEADER_BODY, LEADER_BUTTON, KEY, LESSONS_PAGE, landingOfLink, collect, withLeaderSwitch, tabVerdict, driverId, LEADER_BLOCKED };
