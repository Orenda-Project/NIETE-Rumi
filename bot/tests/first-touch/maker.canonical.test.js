'use strict';
/**
 * The maker link is minted on the canonical web-quiz base, and the canonical-host redirect never touches it:
 * (i) makerUrl() builds on web-quiz-link.js webBaseUrl() (the base the child links use);
 * (ii) dashboard/routes/web-quiz-canonical.js createCanonicalRedirect calls next() — no redirect, no 404 — for
 * GET /m/<token> and GET /f/<token> on a NON-canonical host, while /q/<code> on that host still redirects (control).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const WebQuizLink = require('../../shared/services/quiz/web-quiz-link');
const Cta = require('../../shared/services/first-touch/maker.cta');
const { createCanonicalRedirect } = require('../../../dashboard/routes/web-quiz-canonical');

const SAVED = { ...process.env };
const CANON = 'https://quiz.canonical.example';
const TOKEN = 'eyJrIjoibSJ9.AAAAAAAAAAAAAAAAAAAAAA';
afterEach(() => { process.env = { ...SAVED }; });

test('(i) makerUrl is webBaseUrl() + /m/<token>', () => {
  process.env.WEB_QUIZ_BASE_URL = CANON;
  process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret';
  const spy = jest.spyOn(WebQuizLink, 'webBaseUrl');
  const u = Cta.makerUrl({ uid: 'a0000000-0000-4000-8000-0000000000f1', lang: 'en', tour: 0, via: 'menu' });
  expect(spy).toHaveBeenCalled();
  expect(u.startsWith(`${WebQuizLink.webBaseUrl()}/m/`)).toBe(true);
  expect(u.startsWith(`${CANON}/m/`)).toBe(true);
  spy.mockRestore();
});

function run(mw, path, host = 'other-host.example') {
  const req = { method: 'GET', path, originalUrl: path, hostname: host };
  const res = { status: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, redirect(s, l) { this.status = s; this.location = l; } };
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { nexted, res };
}

test('(ii) /m/<token> and /f/<token> (and /m/<token>/send) on a non-canonical host → next(), no redirect', () => {
  const mw = createCanonicalRedirect(CANON);
  for (const p of [`/m/${TOKEN}`, `/f/${TOKEN}`, `/m/${TOKEN}/send?c=x`]) {
    const { nexted, res } = run(mw, p.split('?')[0]);
    expect(nexted).toBe(true);
    expect(res.status).toBeNull();
  }
});

test('control: /q/<code> on the same non-canonical host → 301 to the canonical origin', () => {
  const { nexted, res } = run(createCanonicalRedirect(CANON), '/q/ABCDEF');
  expect(nexted).toBe(false);
  expect(res.status).toBe(301);
  expect(res.location).toBe(`${CANON}/q/ABCDEF`);
});
