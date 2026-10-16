/**
 * bd-x7aprz.3 — a portal sign-in lasts 30 days from her LAST visit, not 7 days from the sign-in.
 *
 * The cookie was a fixed 7-day maxAge with no `rolling`, so a teacher who used the portal every day
 * was still thrown out on day 8. With sign-in now a WhatsApp link or code (no password to retype),
 * a rolling 30 days means a teacher who opens it at least monthly never sees the sign-in page.
 * Secure / SameSite / httpOnly are untouched (the Capacitor app needs SameSite=None).
 */
const fs = require('fs');
const path = require('path');
const { sessionCookie, sessionBehaviour } = require('../../dashboard/lib/local-dev');

const PROD = { SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' };
const DAY = 24 * 60 * 60 * 1000;

it('the cookie lives 30 days', () => {
  expect(sessionCookie(PROD).maxAge).toBe(30 * DAY);
});

it('security flags are unchanged', () => {
  expect(sessionCookie(PROD)).toMatchObject({ secure: true, httpOnly: true, sameSite: 'none' });
});

it('the session rolls: every answer re-sends the cookie with a fresh 30 days', () => {
  expect(sessionBehaviour()).toEqual(expect.objectContaining({ rolling: true }));
});

it('the session middleware is wired to both', () => {
  // Line comments first: index.js has a `/*` inside a `//` comment ("/api/iab-probe/*"), which a block-comment
  // pass run first would treat as an opening and swallow everything up to the next `*/`.
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/index.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /app\.use\(session\(\{([\s\S]*?)\}\)\);/.exec(src);
  expect(block).not.toBeNull();
  expect(block[1]).toMatch(/cookie:\s*sessionCookie\(process\.env\)/);
  expect(block[1]).toMatch(/\.\.\.sessionBehaviour\(\)/);
});
