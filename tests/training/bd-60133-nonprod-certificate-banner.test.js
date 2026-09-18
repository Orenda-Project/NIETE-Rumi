/**
 * bd-60133 — a certificate generated outside production must say so.
 *
 * Operator, 2026-09-18: "as long as environment is not production, all the
 * certificates should have a banner on top saying this is not a real
 * certificate but just for testing purposes."
 *
 * The reason this matters rather than being cosmetic: sandbox and staging
 * already mint PDFs carrying a real teacher's name, a real-looking code
 * (NIETESANDBOX-20260918-5BVD72) and the government seals. One was issued
 * today by mistake — passing a single MODULE minted a LEVEL certificate
 * (bd-60126) — and nothing on the page said it was a test.
 *
 * THE GATE IS FAIL-SAFE, and that is the load-bearing decision. Production is
 * the only environment that sets NODE_ENV=production; `.env.sandbox` leaves it
 * unset entirely. So the rule is "banner UNLESS explicitly production" — an
 * unset, misspelled or empty value must produce the banner, never suppress it.
 * The opposite default would put a clean certificate on every test run and a
 * TEST banner on nothing.
 */

const {
  isProductionEnv,
  shouldStampTestBanner,
  TEST_BANNER_TEXT,
} = require('../../bot/shared/services/training/certificate-env.rules');

describe('bd-60133 — isProductionEnv', () => {
  test('only the exact string "production" is production', () => {
    expect(isProductionEnv('production')).toBe(true);
  });

  test('every other environment is NOT production', () => {
    for (const env of ['sandbox', 'staging', 'development', 'dev', 'test', 'prod']) {
      expect(isProductionEnv(env)).toBe(false);
    }
  });

  test('unset, empty and nonsense are NOT production — the fail-safe', () => {
    // .env.sandbox does not set NODE_ENV at all. If absence read as
    // production, every sandbox certificate would ship unstamped.
    expect(isProductionEnv(undefined)).toBe(false);
    expect(isProductionEnv(null)).toBe(false);
    expect(isProductionEnv('')).toBe(false);
    expect(isProductionEnv('   ')).toBe(false);
  });

  test('case and padding are tolerated on the real value', () => {
    expect(isProductionEnv('PRODUCTION')).toBe(true);
    expect(isProductionEnv(' production ')).toBe(true);
  });
});

describe('bd-60133 — shouldStampTestBanner', () => {
  test('production certificates are clean', () => {
    expect(shouldStampTestBanner('production')).toBe(false);
  });

  test('sandbox, staging and development are stamped', () => {
    for (const env of ['sandbox', 'staging', 'development']) {
      expect(shouldStampTestBanner(env)).toBe(true);
    }
  });

  test('an unset environment is stamped', () => {
    expect(shouldStampTestBanner(undefined)).toBe(true);
  });

  test('it is exactly the inverse of isProductionEnv', () => {
    for (const env of [undefined, null, '', 'production', 'PRODUCTION', 'sandbox', 'prod']) {
      expect(shouldStampTestBanner(env)).toBe(!isProductionEnv(env));
    }
  });
});

describe('bd-60133 — the banner text', () => {
  test('says plainly that it is not a real certificate', () => {
    expect(TEST_BANNER_TEXT).toMatch(/not a real certificate/i);
  });

  test('names testing as the purpose', () => {
    expect(TEST_BANNER_TEXT).toMatch(/test/i);
  });

  test('is short enough for one banner line', () => {
    expect([...TEST_BANNER_TEXT].length).toBeLessThanOrEqual(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// And the banner must actually reach the rendered page — for EVERY vendor.
// The rules above are pure; this executes renderCertificatePdf, which is where
// the bd-60137 lesson applies: a correct rule wired to nothing proves nothing.
// ─────────────────────────────────────────────────────────────────────────────

const { EventEmitter } = require('events');

function makePdfkitMock(textCalls) {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.x = 0; doc.y = 0;
    doc.registerFont = chain; doc.font = chain; doc.fontSize = chain;
    doc.fillColor = chain; doc.strokeColor = chain; doc.lineWidth = chain;
    doc.opacity = chain; doc.rect = chain; doc.roundedRect = chain; doc.circle = chain;
    doc.moveTo = chain; doc.lineTo = chain; doc.bezierCurveTo = chain; doc.closePath = chain;
    doc.fill = chain; doc.stroke = chain; doc.fillAndStroke = chain; doc.clip = chain;
    doc.linearGradient = () => ({ stop() { return this; } });
    doc.save = chain; doc.restore = chain; doc.addPage = chain;
    doc.image = chain; doc.widthOfString = () => 100; doc.heightOfString = () => 12;
    doc.text = (str) => { textCalls.push(String(str)); return doc; };
    doc.end = () => setImmediate(() => { doc.emit('data', Buffer.from('%PDF')); doc.emit('end'); });
    return doc;
  };
}

describe('bd-60133 — the banner on the rendered page', () => {
  const VENDORS = ['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE', 'ISAPS'];
  const BASE = {
    teacherName: 'Test Teacher',
    certificateCode: 'TEST-20260918-AAAAAA',
    issuedAt: '2026-09-18T10:00:00.000Z',
    levelName: 'Level 1: Novice',
  };
  let prevEnv;

  beforeEach(() => { prevEnv = process.env.NODE_ENV; });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  async function render(vendorKey, nodeEnv) {
    const textCalls = [];
    jest.resetModules();
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    jest.doMock('pdfkit', () => makePdfkitMock(textCalls), { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const svc = require('../../bot/shared/services/training/certificate-pdf.service');
    await svc.renderCertificatePdf({ ...BASE, vendorKey });
    return textCalls.join('\n');
  }

  test.each(VENDORS)('%s is stamped in sandbox', async (vendorKey) => {
    expect(await render(vendorKey, 'sandbox')).toMatch(/NOT A REAL CERTIFICATE/i);
  });

  test.each(VENDORS)('%s is CLEAN in production', async (vendorKey) => {
    expect(await render(vendorKey, 'production')).not.toMatch(/NOT A REAL CERTIFICATE/i);
  });

  test('an UNSET NODE_ENV is stamped — the fail-safe, on the real page', async () => {
    expect(await render('TALEEMABAD', undefined)).toMatch(/NOT A REAL CERTIFICATE/i);
  });
});
