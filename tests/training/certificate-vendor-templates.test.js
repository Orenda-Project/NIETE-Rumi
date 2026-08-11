/**
 * Certificate PDF — per-vendor templates.
 *
 * The certificate we shipped after the migration was ONE generic layout for
 * every vendor. The system it replaced (`taleemabad-core`) shipped THREE,
 * selected by vendor, and teachers had already received those. These tests
 * lock the restored per-vendor contract.
 *
 * The legacy source of truth is
 * `frontend/libs/dsm/components/src/lib/molecules/level-certificate/`:
 *   - `level-certificate.tsx`             → NIETE / TALEEMABAD (and the fallback)
 *   - `beaconhouse-level-certificate.tsx` → BEACONHOUSE
 *   - `oxbridge-level-certificate.tsx`    → OXBRIDGE
 * routed at `training-level-page.tsx:920`.
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE NEGATIVE ONES. The NIETE template
 * carries an AKU-IED accreditation line and NIETE signatories; printing either
 * on a Beaconhouse or Oxbridge certificate is a FALSE ACCREDITATION CLAIM about
 * a third party, not a cosmetic slip. Legacy guarded this explicitly
 * (`docs/superpowers/plans/2026-05-08-oxbridge-certificate-junior-dev-plan.md:381`
 * — "displays Pakistan government support (NOT AKU-IED)"), and so do we.
 *
 * Contract, never pixels: which STRINGS and which ASSETS reach the page for a
 * given vendor. Geometry is free to change; provenance is not.
 *
 * `pdfkit` lives in `bot/`, which CI installs AFTER the root suite runs, so it
 * is mocked virtually — same as `certificate-pdf.test.js`.
 */

const { EventEmitter } = require('events');

let svc;
let textCalls;
let imageCalls;
let fontRegs;
let fontUses;

function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.x = 0; doc.y = 0;
    doc.registerFont = (name, file) => { fontRegs.push({ name, file }); return doc; };
    doc.font = (name) => { fontUses.push(name); return doc; };
    doc.fontSize = chain;
    doc.fillColor = chain;
    doc.strokeColor = chain;
    doc.lineWidth = chain;
    doc.opacity = chain;
    doc.rect = chain;
    doc.roundedRect = chain;
    doc.moveTo = chain;
    doc.lineTo = chain;
    doc.fill = chain;
    doc.stroke = chain;
    doc.fillAndStroke = chain;
    doc.linearGradient = () => ({ stop: function () { return this; } });
    doc.save = chain;
    doc.restore = chain;
    doc.addPage = chain;
    doc.image = (p) => { imageCalls.push(String(p)); return doc; };
    doc.widthOfString = () => 100;
    doc.heightOfString = () => 12;
    doc.text = (str) => { textCalls.push(String(str)); return doc; };
    doc.end = () => {
      setImmediate(() => {
        doc.emit('data', Buffer.from('%PDF-1.3 fake'));
        doc.emit('end');
      });
    };
    return doc;
  };
}

beforeEach(() => {
  jest.resetModules();
  textCalls = []; imageCalls = []; fontRegs = []; fontUses = [];
  jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

/** Everything drawn as text, as one blob. */
const page = () => textCalls.join('\n');
/** Everything drawn as an image, as one blob. */
const art = () => imageCalls.join('\n');

const BASE = {
  teacherName: 'Amina Khan',
  certificateCode: 'NIETE-20260802-A1B2C3',
  issuedAt: '2026-08-02T10:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────
// NIETE / TALEEMABAD — the accredited, signed certificate
// ─────────────────────────────────────────────────────────────────────────────

describe('NIETE template (vendorKey TALEEMABAD)', () => {
  const NIETE = {
    ...BASE,
    vendorKey: 'TALEEMABAD',
    vendorName: 'Taleemabad',
    levelName: 'Skilled Practitioner',
    cpdLevel: 2,
  };

  it('carries the AKU-IED accreditation, verbatim in substance', async () => {
    await svc.renderCertificatePdf(NIETE);
    const all = page();
    expect(all).toMatch(/Aga Khan University/i);
    expect(all).toMatch(/Institute for\s+Educational Development|Educational Development/i);
    expect(all).toMatch(/AKU-IED/);
    expect(all).toMatch(/independently\s+reviewed and approved|reviewed and approved/i);
  });

  it('names the full institute in the completion sentence', async () => {
    await svc.renderCertificatePdf(NIETE);
    expect(page()).toMatch(/National Institute of Excellence in Teacher\s+Education/i);
  });

  it('renders the CPD display name for the level, not the bare level name', async () => {
    await svc.renderCertificatePdf(NIETE);
    // Legacy LEVEL_DISPLAY_NAMES: 'Skilled Practitioner' → 'CPD-LEVEL-2 SKILLED PRACTITIONER'
    expect(page()).toContain('CPD-LEVEL-2 SKILLED PRACTITIONER');
  });

  it('maps all three CPD levels the way legacy did', async () => {
    const cases = [
      { levelName: 'Emerging Practitioner', cpdLevel: 1, expect: 'CPD-LEVEL-1 EMERGING PRACTITIONER' },
      { levelName: 'Skilled Practitioner', cpdLevel: 2, expect: 'CPD-LEVEL-2 SKILLED PRACTITIONER' },
      { levelName: 'Teacher Leader', cpdLevel: 3, expect: 'CPD-LEVEL-3 TEACHER LEADER' },
    ];
    for (const c of cases) {
      textCalls = [];
      await svc.renderCertificatePdf({ ...NIETE, levelName: c.levelName, cpdLevel: c.cpdLevel });
      expect(page()).toContain(c.expect);
    }
  });

  it('leaves a level with no CPD mapping (Aspiring Teacher) as its plain name', async () => {
    // Legacy fell through to `levelName` for anything not in LEVEL_DISPLAY_NAMES.
    // Aspiring Teacher has cpd_level NULL in the schema.
    await svc.renderCertificatePdf({ ...NIETE, levelName: 'Aspiring Teacher', cpdLevel: null });
    expect(page()).toContain('Aspiring Teacher');
    expect(page()).not.toMatch(/CPD-LEVEL-null|CPD-LEVEL-undefined/);
  });

  it('carries both signatories with their titles', async () => {
    await svc.renderCertificatePdf(NIETE);
    const all = page();
    expect(all).toContain('Sabeena Abbasi');
    expect(all).toContain('Chief Program Officer');
    expect(all).toContain('Rifat Jabeen');
    expect(all).toContain('Project Director');
  });

  it('draws both signature images and the NIETE logo', async () => {
    await svc.renderCertificatePdf(NIETE);
    const drawn = art();
    expect(drawn).toMatch(/sabeena-signature\.png/);
    expect(drawn).toMatch(/riffat-signature\.png/);
    expect(drawn).toMatch(/niete-logo\.png/);
  });

  it('still says CERTIFICATE OF COMPLETION and shows the code', async () => {
    await svc.renderCertificatePdf(NIETE);
    expect(page()).toMatch(/CERTIFICATE OF COMPLETION/i);
    expect(page()).toContain('NIETE-20260802-A1B2C3');
  });

  it('is the fallback for an unknown or missing vendor key', async () => {
    for (const vendorKey of [undefined, null, '', 'SOME_NEW_PARTNER']) {
      textCalls = [];
      await svc.renderCertificatePdf({ ...NIETE, vendorKey });
      expect(page()).toMatch(/Aga Khan University/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEACONHOUSE — partner, must NOT claim NIETE/AKU accreditation
// ─────────────────────────────────────────────────────────────────────────────

describe('Beaconhouse template (vendorKey BEACONHOUSE)', () => {
  const BH = {
    ...BASE,
    vendorKey: 'BEACONHOUSE',
    vendorName: 'Beacon House',
    levelName: 'English Language Teaching',
    certificateCode: 'BH-20260802-A1B2C3',
  };

  it('NEVER claims AKU-IED accreditation', async () => {
    await svc.renderCertificatePdf(BH);
    const all = page();
    expect(all).not.toMatch(/Aga Khan/i);
    expect(all).not.toMatch(/AKU-IED/);
  });

  it('NEVER carries NIETE branding or NIETE signatories', async () => {
    await svc.renderCertificatePdf(BH);
    const all = page();
    expect(all).not.toMatch(/NIETE/);
    expect(all).not.toMatch(/National Institute of Excellence/i);
    expect(all).not.toContain('Sabeena Abbasi');
    expect(all).not.toContain('Rifat Jabeen');
    expect(art()).not.toMatch(/niete-logo|sabeena-signature|riffat-signature/);
  });

  it('attributes the programme to Beaconhouse and signs as their Director', async () => {
    await svc.renderCertificatePdf(BH);
    const all = page();
    expect(all).toContain('Beaconhouse');
    expect(all).toContain('Director');
    expect(all).toContain('English Language Teaching');
  });

  it('does not apply CPD-LEVEL naming (that is a NIETE ladder)', async () => {
    await svc.renderCertificatePdf({ ...BH, levelName: 'Skilled Practitioner', cpdLevel: 2 });
    expect(page()).not.toContain('CPD-LEVEL-2');
    expect(page()).toContain('Skilled Practitioner');
  });

  it('shows the code and the completion date', async () => {
    await svc.renderCertificatePdf(BH);
    expect(page()).toContain('BH-20260802-A1B2C3');
    expect(page()).toMatch(/2026/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OXBRIDGE — partner, own logos + CEO signatory
// ─────────────────────────────────────────────────────────────────────────────

describe('Oxbridge template (vendorKey OXBRIDGE)', () => {
  const OX = {
    ...BASE,
    vendorKey: 'OXBRIDGE',
    vendorName: 'Oxbridge Innovative Solutions',
    levelName: 'Professional Training in Game-Based Teaching',
    certificateCode: 'OX-20260802-A1B2C3',
  };

  it('NEVER claims AKU-IED accreditation or NIETE branding', async () => {
    await svc.renderCertificatePdf(OX);
    const all = page();
    expect(all).not.toMatch(/Aga Khan/i);
    expect(all).not.toMatch(/AKU-IED/);
    expect(all).not.toMatch(/NIETE/);
    expect(all).not.toContain('Sabeena Abbasi');
    expect(all).not.toContain('Rifat Jabeen');
    expect(art()).not.toMatch(/niete-logo|sabeena-signature|riffat-signature/);
  });

  it('attributes the programme to the full Oxbridge legal name', async () => {
    await svc.renderCertificatePdf(OX);
    expect(page()).toContain('Oxbridge Innovative Solutions (Pvt.) Ltd.');
  });

  it('signs as the Oxbridge CEO', async () => {
    await svc.renderCertificatePdf(OX);
    const all = page();
    expect(all).toContain('Manzil e Maqsood');
    expect(all).toContain('CEO');
  });

  it('draws the Oxbridge and FDE logos', async () => {
    await svc.renderCertificatePdf(OX);
    const drawn = art();
    expect(drawn).toMatch(/oxbridge-logo\.png/);
    expect(drawn).toMatch(/fde-logo\.png/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting behaviour that must survive the rewrite
// ─────────────────────────────────────────────────────────────────────────────

describe('behaviour preserved across all templates', () => {
  const VENDORS = ['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE'];

  it('renders a non-Latin teacher name in Naskh, and actually selects it', async () => {
    for (const vendorKey of VENDORS) {
      fontRegs = []; fontUses = []; textCalls = [];
      await svc.renderCertificatePdf({
        ...BASE, vendorKey, levelName: 'Skilled Practitioner', teacherName: 'محمد عامر خان',
      });
      // Naskh, never Nastaliq — Nastaliq's GPOS anchor tables crash fontkit.
      expect(fontRegs.some((f) => /Naskh/i.test(f.file))).toBe(true);
      expect(fontRegs.some((f) => /Nastaliq/i.test(f.file))).toBe(false);
      expect(fontUses).toContain('CertArabic');
      expect(page()).toContain('محمد عامر خان');
    }
  });

  it('does not switch to the Arabic font for a Latin name', async () => {
    for (const vendorKey of VENDORS) {
      fontUses = [];
      await svc.renderCertificatePdf({ ...BASE, vendorKey, levelName: 'Skilled Practitioner' });
      expect(fontUses).not.toContain('CertArabic');
    }
  });

  it('returns a Buffer and always names the teacher', async () => {
    for (const vendorKey of VENDORS) {
      textCalls = [];
      const buf = await svc.renderCertificatePdf({ ...BASE, vendorKey, levelName: 'Skilled Practitioner' });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(page()).toContain('Amina Khan');
    }
  });

  it('accepts a lowercase / title-case vendor key (legacy used both forms)', async () => {
    // Legacy VENDOR_CONFIGS registered both 'BEACONHOUSE' and 'Beaconhouse'.
    for (const vendorKey of ['Beaconhouse', 'beaconhouse']) {
      textCalls = [];
      await svc.renderCertificatePdf({ ...BASE, vendorKey, levelName: 'ELT' });
      expect(page()).not.toMatch(/Aga Khan/i);
      expect(page()).toContain('Beaconhouse');
    }
  });

  it('renders even when the asset files are absent (clone deployments)', async () => {
    jest.resetModules();
    textCalls = []; imageCalls = []; fontRegs = []; fontUses = [];
    jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('fs', () => ({ ...jest.requireActual('fs'), existsSync: () => false }));
    const bare = require('../../bot/shared/services/training/certificate-pdf.service');

    for (const vendorKey of VENDORS) {
      textCalls = []; imageCalls = [];
      const buf = await bare.renderCertificatePdf({ ...BASE, vendorKey, levelName: 'Skilled Practitioner' });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(imageCalls).toHaveLength(0);       // nothing drawn
      expect(page()).toContain('Amina Khan');   // text still complete
    }
  });
});
