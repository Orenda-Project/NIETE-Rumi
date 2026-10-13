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
];

module.exports = { feature: 'portal-login', spec: 'tests/features/web/portal-login.feature', scenarios };
