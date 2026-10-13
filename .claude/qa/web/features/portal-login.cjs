// portal-login — the web lane's scenarios for tests/features/web/portal-login.feature (bd-hnhlgn.5).
// One entry per @PLxx in the spec; scripts/qa/e2e-web.test.sh fails if the two lists drift apart.
// Each run(page, ctx) gets a fresh browser context on ctx.baseUrl, throws on a broken expectation and
// returns its evidence. ctx.sql(text) runs against THIS run's own local database (never a shared one).
'use strict';

const PASSWORD = 'Demo2026';
const TEACHER = '03000000911';
const PRINCIPAL = '03000000902';
const NO_PW_TEACHER = '03000000919';

function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function open(page, ctx) {
  await page.goto(ctx.baseUrl + '/portal/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#phoneNumber', { state: 'visible', timeout: 20000 });
}

async function signIn(page, phone, password) {
  await page.fill('#phoneNumber', phone);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
}

async function landsOn(page, path) {
  await page.waitForURL((u) => new URL(u).pathname.startsWith(path), { timeout: 20000 })
    .catch(() => { throw new Error('expected ' + path + ', still on ' + new URL(page.url()).pathname); });
  return new URL(page.url()).pathname;
}

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
  { id: 'PL01', title: 'A teacher signs in and lands on her dashboard', run: async (page, ctx) => {
    await open(page, ctx); await signIn(page, TEACHER, PASSWORD);
    return { landed: await landsOn(page, '/portal/dashboard') };
  } },
  { id: 'PL02', title: 'A principal signs in and lands on the leader portal', run: async (page, ctx) => {
    await open(page, ctx); await signIn(page, PRINCIPAL, PASSWORD);
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
  { id: 'PL04', title: 'A number with no account is named under the phone box', run: async (page, ctx) => {
    await open(page, ctx); await signIn(page, '03009999999', 'anything');
    const msg = await fieldError(page, 'phoneNumber');
    expect(msg === 'No account found', 'phone message was "' + msg + '"');
    return { message: msg };
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
  { id: 'PL06', title: 'An activated account with no password yet is told so, not shown an error page', run: async (page, ctx) => {
    await ctx.sql("update users set portal_activated = true, portal_password_hash = null where phone_number = '92" + NO_PW_TEACHER.slice(1) + "'");
    await open(page, ctx); await signIn(page, NO_PW_TEACHER, 'anything');
    const msg = await fieldError(page, 'password');
    expect(msg === 'No password yet', 'password message was "' + msg + '"');
    return { message: msg };
  } },
  { id: 'PL07', title: 'Forgot password opens the reset page with her number carried over', run: async (page, ctx) => {
    await open(page, ctx);
    await page.fill('#phoneNumber', TEACHER);
    await page.getByRole('button', { name: /forgot password/i }).click();
    return { landed: await landsOn(page, '/portal/reset-password') };
  } },
];

module.exports = { feature: 'portal-login', spec: 'tests/features/web/portal-login.feature', scenarios };
