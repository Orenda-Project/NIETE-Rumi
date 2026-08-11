/**
 * bd-2509 … bd-2513 — source-level guards for the portal auth flow fixes
 * raised in ICT feedback ("ICT Feedback on Rumi" → Auth flow tab, Fatima
 * Rahman, Teacher/Portal). Two entries, one of them P1:
 *
 *   P1  "Phone number is requested multiple times during the password reset
 *        flow" — typed at login, again on reset, again after reset.
 *   --  "Phone Number and OTP placeholders are not user-friendly" — the
 *        numeric placeholders are mistaken for pre-filled values.
 *
 * Plus two adjacent problems found while tracing that feedback:
 *
 *   bd-2510  the UI demands 923XXXXXXXXX, but sanitizePhoneNumber() in
 *            dashboard/routes/portal.routes.js ALREADY accepts 03XX, +92,
 *            0092 and spaced/dashed forms. Teachers were being asked to
 *            hand-convert for a system that normalizes anyway.
 *   bd-2511  a wrong-length number falls through the loose 10-15 digit
 *            validator and returns "No portal account found for this phone
 *            number" — which reads as "you have no account" rather than
 *            "you dropped a digit".
 *
 * These assert on file CONTENTS, matching the house pattern in
 * portal-ui-contracts.test.js: there is no TSX transform in this runner and
 * no DOM, but each fix is a specific token present or absent in a specific
 * file, which is exactly what a later edit would silently undo.
 *
 * What these CANNOT tell you:
 *   - whether the pre-filled field looks right on a phone;
 *   - whether auto-login (bd-2513) actually survives the Capacitor WebView.
 *     bd-2402/BUG-142 was already a session-persistence bug in that shell,
 *     and per tests/portal/android-session-persistence.test.js, WebView
 *     cookie behaviour cannot be signed off in Jest or an emulator. The
 *     session assertions below prove the SHAPE of the fix, not that the
 *     cookie lands on a physical device. That check is a human step on the PR.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LOGIN = 'portal/src/portal/pages/PortalLogin.tsx';
const RESET = 'portal/src/portal/pages/PortalPasswordReset.tsx';
const VERIFY = 'portal/src/portal/pages/PortalPasswordResetVerify.tsx';
const ROUTES = 'dashboard/routes/portal.routes.js';

// Strip comments so we assert on real code, not on explanatory prose that
// happens to quote the very string we are banning.
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('bd-2509 — placeholders read as instructions, not as pre-filled values', () => {
  // The exact tokens teachers mistook for real data.
  it('no auth field ships a bare example number as its placeholder', () => {
    for (const f of [LOGIN, RESET, VERIFY]) {
      expect(code(f)).not.toMatch(/placeholder\s*=\s*"9230+1234567"/);
      expect(code(f)).not.toMatch(/placeholder\s*=\s*"123456"/);
    }
  });

  it('the phone placeholder tells the user what to do', () => {
    for (const f of [LOGIN, RESET]) {
      const m = code(f).match(/placeholder\s*=\s*"([^"]*)"/g) || [];
      const phoneish = m.find((p) => /phone|03X|enter/i.test(p));
      expect(phoneish).toBeTruthy();
      // Must not be a run of digits masquerading as a value.
      expect(phoneish).not.toMatch(/"\s*\d[\d\s-]*"/);
    }
  });

  it('the OTP placeholder does not look like an already-delivered code', () => {
    const m = code(VERIFY).match(/id="code"[\s\S]{0,400}?placeholder\s*=\s*"([^"]*)"/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toMatch(/^\s*\d+\s*$/);
  });
});

describe('bd-2510 — the UI asks for the format Pakistanis actually use', () => {
  // Verified against the live normalizer: '03361234567', '0336 123 4567',
  // '+92 336 1234567' and '0092…' all normalize to 923361234567 today.
  it('the backend normalizer really does accept a leading 0 (premise check)', () => {
    const src = read(ROUTES);
    const fn = src.slice(src.indexOf('function sanitizePhoneNumber'));
    expect(fn).toMatch(/startsWith\('0'\)/);
    expect(fn).toMatch(/'92'\s*\+/);
  });

  it('every auth endpoint normalizes before looking the user up', () => {
    const src = read(ROUTES);
    for (const ep of ['/login', '/request-reset', '/verify-reset-code']) {
      const body = src.slice(src.indexOf(`router.post('${ep}'`));
      const upTo = body.slice(0, body.indexOf('\nrouter.post('));
      expect(upTo).toMatch(/sanitizePhoneNumber\(/);
    }
  });

  it('the helper text no longer claims the country code is required', () => {
    expect(code(RESET)).not.toMatch(/Include country code/i);
    expect(code(LOGIN)).not.toMatch(/without \+ or spaces/i);
  });

  it('the local 03XX form is what the user is shown', () => {
    for (const f of [LOGIN, RESET]) {
      expect(code(f)).toMatch(/03X{2}|0336/);
    }
  });
});

describe('bd-2511 — a mistyped number says so, instead of denying the account', () => {
  it('the client checks the length before hitting the API', () => {
    // 11 digits for 03XXXXXXXXX, 12 for 923XXXXXXXXX. Assert on the shared
    // helper by name — a bare /11|12/ would match any stray number in the file.
    for (const f of [LOGIN, RESET]) {
      expect(code(f)).toMatch(/isValidPkMobile\(/);
    }
  });

  it('login and reset share one validator rather than each rolling their own', () => {
    const helper = 'portal/src/portal/lib/phone.ts';
    expect(fs.existsSync(path.join(ROOT, helper))).toBe(true);
    for (const f of [LOGIN, RESET]) {
      expect(code(f)).toMatch(/from\s+['"].*lib\/phone['"]/);
    }
  });

  it('the validator accepts every form the backend already normalizes', () => {
    const src = read('portal/src/portal/lib/phone.ts');
    // Mirrors sanitizePhoneNumber: strip non-digits, drop 00, 0->92, bare 3->92.
    expect(src).toMatch(/replace\(\s*\/\\D\/g\s*,\s*''\s*\)/);
    expect(src).toMatch(/startsWith\('00'\)/);
  });
});

describe('bd-2512 — the phone survives the hop from login into reset (P1)', () => {
  it('login hands the typed number to the reset screen', () => {
    expect(code(LOGIN)).toMatch(
      /navigate\(\s*['"]\/portal\/reset-password['"]\s*,\s*\{\s*state:\s*\{\s*phoneNumber/
    );
  });

  it('the reset screen seeds its field from that state', () => {
    const src = code(RESET);
    expect(src).toMatch(/useLocation/);
    expect(src).toMatch(/useState\(\s*location\.state\?\.phoneNumber/);
  });

  it('the field stays editable — a pre-fill is a default, not a lock', () => {
    const src = code(RESET);
    expect(src).toMatch(/onChange=\{\(e\)\s*=>\s*setPhoneNumber/);
    expect(src).not.toMatch(/id="phoneNumber"[\s\S]{0,300}?readOnly/);
  });

  it('arriving at reset directly still works (no state, empty field)', () => {
    expect(code(RESET)).toMatch(/location\.state\?\.phoneNumber\s*(\?\?|\|\|)\s*''/);
  });
});

describe('bd-2513 — a successful reset lands the teacher inside, not back at login', () => {
  it('the server opens the session itself, from the id it already verified', () => {
    const src = read(ROUTES);
    const handler = src.slice(src.indexOf("router.post('/reset-password'"));
    const body = handler.slice(0, handler.indexOf('\nrouter.post('));
    // resetUserId is written by verify-reset-code and never leaves the server,
    // so promoting it is not trusting anything the client sent.
    expect(body).toMatch(/req\.session\.resetUserId/);
    expect(body).toMatch(/req\.session\.portalUserId\s*=/);
    expect(body).toMatch(/isPortalAuth\s*=\s*true/);
  });

  it('the session id is regenerated, as the login handler does', () => {
    const src = read(ROUTES);
    const handler = src.slice(src.indexOf("router.post('/reset-password'"));
    const body = handler.slice(0, handler.indexOf('\nrouter.post('));
    expect(body).toMatch(/req\.session\.regenerate\(/);
  });

  it('the one-shot reset grant is still consumed', () => {
    const src = read(ROUTES);
    const handler = src.slice(src.indexOf("router.post('/reset-password'"));
    const body = handler.slice(0, handler.indexOf('\nrouter.post('));
    expect(body).toMatch(/delete req\.session\.resetUserId/);
  });

  it('the client stops sending the user back to an empty login form', () => {
    const src = code(VERIFY);
    const submit = src.slice(src.indexOf('const handleSubmit'), src.indexOf('return ('));
    expect(submit).not.toMatch(/navigate\(\s*['"]\/portal\/login['"]\s*\)/);
    expect(submit).toMatch(/\/portal\/(dashboard|leader)/);
  });

  it('a leader still lands on My Patch, per bd-2434', () => {
    expect(code(VERIFY)).toMatch(/isLeader/);
  });

  it('the old "now log in" copy is gone from the API response', () => {
    const src = read(ROUTES);
    const handler = src.slice(src.indexOf("router.post('/reset-password'"));
    const body = handler.slice(0, handler.indexOf('\nrouter.post('));
    expect(body).not.toMatch(/Please log in with your new password/);
  });
});
