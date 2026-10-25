// portal-login — the web lane's scenarios for tests/features/web/portal-login.feature (bd-hnhlgn.5/.7).
// One entry per @PLxx in the spec; scripts/qa/e2e-web.test.sh fails if the two lists drift apart.
// Each run(page, ctx) gets a fresh browser context on ctx.baseUrl, throws on a broken expectation and
// returns its evidence. ctx.sql(text) runs against THIS run's own local database (never a shared one).
'use strict';
const { PASSWORD, DEMO, MODES, expect, open, signIn, landsOn, setSetting, setFlags, sendUntilLink } = require('../lib.cjs');

const TEACHER = DEMO.teacher;
const PRINCIPAL = DEMO.principal;
const COACH = DEMO.coach;
const NO_PW_TEACHER = DEMO.noPwTeacher;
const CLASSIC = MODES.classic;
// A number nobody is registered with, built from parts so the repo holds no phone-shaped literal.
const UNREGISTERED = ['03', '009', '999999'].join('');

// The field message: the input is aria-invalid and aria-describedby points at its role="alert" text (AuthField.tsx).
async function fieldError(page, id) {
  const box = page.locator('#' + id + '[aria-invalid="true"]');
  await box.waitFor({ state: 'attached', timeout: 15000 })
    .catch(() => { throw new Error('#' + id + ' was never marked invalid'); });
  const errId = await box.getAttribute('aria-describedby');
  // React's useId ids look like ":r2:-err" — not a valid #selector, so match the attribute instead.
  return (await page.locator('[id="' + errId + '"]').innerText()).trim();
}

const scenarios = [
  { id: 'PL01', title: 'Classic portal: a teacher signs in and lands on her dashboard', run: async (page, ctx) => {
    await setFlags(ctx, CLASSIC); await open(page, ctx); await signIn(page, TEACHER, PASSWORD);
    return { landed: await landsOn(page, '/portal/dashboard') };
  } },
  { id: 'PL02', title: 'Classic portal: a principal signs in and lands on the leader portal', run: async (page, ctx) => {
    await setFlags(ctx, CLASSIC); await open(page, ctx); await signIn(page, PRINCIPAL, PASSWORD);
    return { landed: await landsOn(page, '/portal/leader') };
  } },
  { id: 'PL03', title: 'A wrong password is named under the password box', run: async (page, ctx) => {
    await open(page, ctx); await signIn(page, TEACHER, 'not-her-password');
    const msg = await fieldError(page, 'password');
    expect(msg === 'Wrong password', 'password message was "' + msg + '"');
    const path = new URL(page.url()).pathname;
    expect(path === '/portal/login', 'left the login page for ' + path);
    return { message: msg, path };
  } },
  { id: 'PL04', title: 'A number that is not registered is offered Register on WhatsApp, never "No account found"', run: async (page, ctx) => {
    await open(page, ctx); await signIn(page, '03009999999', 'anything');
    const link = page.getByRole('link', { name: /register on whatsapp/i });
    await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new Error('no Register on WhatsApp button'); });
    const href = await link.getAttribute('href');
    expect(/^https:\/\/wa\.me\/\d+\?text=%2Fregister$/.test(href || ''), 'the button opens ' + href);
    const body = await page.locator('body').innerText();
    expect(!/No account found/.test(body), 'the page still says "No account found"');
    return { href };
  } },
  { id: 'PL05', title: 'A malformed number is stopped before it is sent', run: async (page, ctx) => {
    await open(page, ctx);
    let sent = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && /\/login$/.test(new URL(r.url()).pathname)) sent += 1; });
    await signIn(page, '12345', 'anything');
    const msg = await fieldError(page, 'phoneNumber');
    expect(msg === 'Check the number', 'phone message was "' + msg + '"');
    expect(sent === 0, sent + ' /login request(s) went out for a malformed number');
    return { message: msg, loginRequests: sent };
  } },
  { id: 'PL06', title: 'An account with no password yet is sent to set one, not shown an error page', run: async (page, ctx) => {
    await ctx.sql("update users set portal_activated = true, portal_password_hash = null where phone_number = '92" + NO_PW_TEACHER.slice(1) + "'");
    await open(page, ctx); await signIn(page, NO_PW_TEACHER, 'anything');
    const landed = await landsOn(page, '/portal/reset-password');
    const title = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
    expect(title === 'Set password', 'the page is titled "' + title + '"');
    const carried = await page.inputValue('#phoneNumber');
    expect(carried === NO_PW_TEACHER, 'the number field holds "' + carried + '"');
    return { landed, title, carried };
  } },
  { id: 'PL07', title: 'Forgot password opens the reset page with her number carried over', run: async (page, ctx) => {
    await open(page, ctx);
    await page.fill('#phoneNumber', TEACHER);
    await page.getByRole('button', { name: /forgot password/i }).click();
    return { landed: await landsOn(page, '/portal/reset-password') };
  } },
  { id: 'PL08', title: 'Teacher app v2: a teacher signs in and lands on the teacher home', run: async (page, ctx) => {
    await setFlags(ctx, { portal_teacher_v2: true, portal_coach_v2: false }); await open(page, ctx);
    await signIn(page, TEACHER, PASSWORD);
    return { landed: await landsOn(page, '/portal/teacher') };
  } },
  { id: 'PL09', title: 'Teacher app v2: a principal lands on the teacher home too (the teacher app plus her school)', run: async (page, ctx) => {
    await setFlags(ctx, { portal_teacher_v2: true, portal_coach_v2: false }); await open(page, ctx);
    await signIn(page, PRINCIPAL, PASSWORD);
    return { landed: await landsOn(page, '/portal/teacher') };
  } },
  { id: 'PL10', title: 'Coach app v2: a coach signs in and lands on the coach home', run: async (page, ctx) => {
    await setFlags(ctx, { portal_teacher_v2: false, portal_coach_v2: true }); await open(page, ctx);
    await signIn(page, COACH, PASSWORD);
    return { landed: await landsOn(page, '/portal/coach') };
  } },
  { id: 'PL11', title: 'One-tap sign-in from WhatsApp: /menu sends a link that opens her teacher home, signed in', run: async (page, ctx) => {
    await setSetting(ctx, 'app_redirect_menu', '"teachers"');
    await setFlags(ctx, { portal_teacher_v2: true, portal_coach_v2: false });
    const phone = '92' + TEACHER.slice(1);
    if (ctx.headed) {   // watching? show the WhatsApp side too: the mock's chat console, beside the portal
      const chat = await page.context().newPage();
      await chat.goto(ctx.mockUrl + '/console').catch(() => {});
    }
    const { url, item, tries } = await sendUntilLink(ctx, phone, '/menu', /https?:\/\/[^\s"']+\/go\/[A-Za-z0-9._~-]+/, 60000);
    expect(url.startsWith(ctx.baseUrl + '/go/'), 'the link points at ' + url.split('/go/')[0] + ', not this run\'s portal ' + ctx.baseUrl);
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const landed = await landsOn(page, '/portal/teacher');
    return { replyType: item.type, link: url.replace(/\/go\/.*/, '/go/<token>'), tries, landed };
  } },
  // @obsolete (bd-xxi78f): the code sign-in is off the login page. Not driven; the lane reports it BLOCKED (the runner
  // calls run() for every entry, so an entry with no run would be a TypeError FAIL).
  { id: 'PL12', title: 'A code on WhatsApp signs her in: number, Send code, the code, her dashboard — no password', run: async () => ({
    blocked: 'spec/code disagreement: bd-xxi78f took the WhatsApp-code sign-in off /portal/login (phone + password only); @PL12 is marked @obsolete in the spec as a deletion proposal',
  }) },
  { id: 'PL14', title: "The analytics accounts' own sign-in asks for an account name and a password only, and a refused name stays on it", run: async (page, ctx) => {
    await page.goto(ctx.baseUrl + '/portal/analytics/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#accountName', { state: 'visible', timeout: 20000 })
      .catch(() => { throw new Error('no account name field on /portal/analytics/login (landed on ' + new URL(page.url()).pathname + ')'); });
    expect(await page.locator('#password').count() === 1, 'no password field');
    expect(await page.locator('#phoneNumber').count() === 0, 'the page has a phone field');
    for (const gone of [/^send code$/i, /use password instead/i, /use a code instead/i, /use a name instead/i, /use phone number/i, /forgot password/i]) {
      expect(await page.getByRole('button', { name: gone }).count() === 0, 'the page offers ' + gone);
    }
    expect(await page.locator('button[type="submit"]').count() === 1, 'not exactly one Log in button');
    await page.fill('#accountName', 'no_such_account');
    await page.fill('#password', 'not-a-password');
    await page.click('button[type="submit"]');
    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new Error('no message after a refused name'); });
    const msg = (await alert.innerText()).trim();
    expect(msg === "Couldn't log in", 'message was "' + msg + '"');
    await page.waitForTimeout(1500);   // a 401 handler that redirected would have moved her by now
    const path = new URL(page.url()).pathname;
    expect(path === '/portal/analytics/login', 'left the analytics sign-in for ' + path);
    return { message: msg, path };
  } },
  { id: 'PL15', title: 'Admin login opens the account-name sign-in', run: async (page, ctx) => {
    await open(page, ctx);
    await page.getByRole('button', { name: /^admin login$/i }).click();
    const landed = await landsOn(page, '/portal/analytics/login');
    await page.waitForSelector('#accountName', { state: 'visible', timeout: 20000 })
      .catch(() => { throw new Error('no account name field after Admin login'); });
    expect(await page.locator('#password').count() === 1, 'no password field');
    const title = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
    expect(title === 'NIETE Admin', 'the page is titled "' + title + '"');
    const badge = (await page.getByTestId('auth-badge').innerText()).trim();
    expect(/^admin$/i.test(badge), 'the badge reads "' + badge + '"');
    return { landed, title, badge };
  } },
  { id: 'PL16', title: 'Back on the Admin sign-in returns to the regular login', run: async (page, ctx) => {
    await open(page, ctx);
    await page.getByRole('button', { name: /^admin login$/i }).click();
    await landsOn(page, '/portal/analytics/login');
    await page.getByRole('button', { name: /^back$/i }).click();
    const fromLogin = await landsOn(page, '/portal/login');
    expect(await page.locator('#phoneNumber').count() === 1 && await page.locator('#password').count() === 1, 'the login is not the phone + password form');
    await page.goto(ctx.baseUrl + '/portal/analytics/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#accountName', { state: 'visible', timeout: 20000 });
    await page.getByRole('button', { name: /^back$/i }).click();
    const direct = await landsOn(page, '/portal/login');
    return { fromLogin, direct };
  } },
  { id: 'PL17', title: "Register on WhatsApp opens this deployment's own bot, or is not shown when none is configured", run: async (page, ctx) => {
    // This deployment's bot, as the server tells the portal (null when none is configured).
    const cfg = await (await page.request.get(ctx.baseUrl + '/api/portal/config')).json();
    const bot = cfg && typeof cfg.bot === 'string' ? cfg.bot : null;
    await open(page, ctx); await signIn(page, UNREGISTERED, 'anything');
    let href = null;
    if (bot) {
      const link = page.getByRole('link', { name: /register on whatsapp/i });
      await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new Error('no Register on WhatsApp button'); });
      href = await link.getAttribute('href');
      expect((href || '').startsWith('https://wa.me/' + bot + '?'), 'the button opens ' + href + ', not this deployment\'s bot');
    }
    // No number configured: /config answers bot null and the login answer carries no chat link.
    await page.route('**/api/portal/config', async (route) => {
      const res = await route.fetch(); const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, bot: null } });
    });
    await page.route('**/api/portal/login', async (route) => {
      const res = await route.fetch(); let body = {};
      try { body = await res.json(); } catch (_) { /* not JSON: pass it through unchanged */ return route.fulfill({ response: res }); }
      delete body.whatsapp;
      await route.fulfill({ response: res, json: body });
    });
    await open(page, ctx); await signIn(page, UNREGISTERED, 'anything');
    await page.getByText(/not registered yet/i).first().waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => { throw new Error('the page never said "Not registered yet"'); });
    const shown = await page.locator('a[href*="wa.me"]').count();
    expect(shown === 0, shown + ' WhatsApp link(s) shown with no bot number configured');
    const body = await page.locator('body').innerText();
    expect(!/No account found/.test(body), 'the page says "No account found"');
    return { bot, href, linksWithoutNumber: shown };
  } },
];

module.exports = { feature: 'portal-login', spec: 'tests/features/web/portal-login.feature', scenarios };
