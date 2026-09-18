/**
 * bd-60113 — the I-SAPS certificate template.
 *
 * I-SAPS Level 1 is a fourth vendor, and it cannot reuse any existing template.
 * The accreditation line is the reason, and it is the same class of claim the
 * sibling suite (certificate-vendor-templates.test.js) already guards:
 *
 *   NIETE's certificate asserts the content was independently reviewed and
 *   approved by the Aga Khan University – Institute for Educational Development
 *   (AKU-IED). The I-SAPS certificate asserts APPROVAL BY ALLAMA IQBAL OPEN
 *   UNIVERSITY (AIOU) instead.
 *
 * Those are claims about two different universities. Falling through to the
 * NIETE template — which is what `templateIdFor()` does today for any unknown
 * vendor — would print an AKU-IED accreditation on a certificate AIOU
 * accredited. The negative assertions below are the point of this file.
 *
 * The header carries four marks, in this order, matching the approved design:
 *   1. MoFEPT circular seal   (Ministry of Federal Education, Govt of Pakistan)
 *   2. Government of Pakistan state emblem (flat)
 *   3. NIETE wordmark
 *   4. I-SAPS lockup
 *
 * NIETE branding and both NIETE signatories DO belong here — unlike the
 * Beaconhouse and Oxbridge partner templates — because the training is
 * conducted by NIETE and signed by its officers. Only the accreditor differs.
 */

const { EventEmitter } = require('events');

let svc;
let textCalls;
let imageCalls;

function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.x = 0; doc.y = 0;
    doc.registerFont = () => doc;
    doc.font = () => doc;
    doc.fontSize = chain;
    doc.fillColor = chain;
    doc.strokeColor = chain;
    doc.lineWidth = chain;
    doc.opacity = chain;
    doc.rect = chain;
    doc.roundedRect = chain;
    doc.circle = chain;
    doc.moveTo = chain;
    doc.lineTo = chain;
    doc.bezierCurveTo = chain;
    doc.closePath = chain;
    doc.fill = chain;
    doc.stroke = chain;
    doc.fillAndStroke = chain;
    doc.clip = chain;
    doc.linearGradient = () => ({ stop: function () { return this; } });
    doc.save = chain;
    doc.restore = chain;
    // bd-60140 — the non-production watermark transforms the canvas.
    // A double missing a primitive the renderer uses fails the whole
    // file with a TypeError unrelated to what it asserts.
    doc.rotate = chain;
    doc.translate = chain;
    doc.scale = chain;
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
  textCalls = []; imageCalls = [];
  jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

const page = () => textCalls.join('\n');
const art = () => imageCalls.join('\n');

const ISAPS = {
  teacherName: 'Fatima Rehman',
  certificateCode: 'NIETE-L1-20260801-AC8E14',
  issuedAt: '2026-08-01T09:00:00.000Z',
  levelName: 'Level 1: Novice',
  vendorKey: 'ISAPS',
};

describe('bd-60113 — templateIdFor routes ISAPS to its own template', () => {
  it('does not fall through to TALEEMABAD', () => {
    expect(svc.templateIdFor('ISAPS')).toBe('ISAPS');
    expect(svc.templateIdFor('isaps')).toBe('ISAPS');
  });

  it('leaves the existing vendors exactly as they were', () => {
    expect(svc.templateIdFor('BEACONHOUSE')).toBe('BEACONHOUSE');
    expect(svc.templateIdFor('OXBRIDGE')).toBe('OXBRIDGE');
    expect(svc.templateIdFor('TALEEMABAD')).toBe('TALEEMABAD');
    expect(svc.templateIdFor('something-else')).toBe('TALEEMABAD');
  });
});

describe('bd-60113 — I-SAPS certificate content', () => {
  it('asserts AIOU accreditation, and NEVER AKU-IED', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    const all = page();
    expect(all).toMatch(/Allama Iqbal Open University/i);
    expect(all).toMatch(/AIOU/);
    // The whole reason this template exists:
    expect(all).not.toMatch(/Aga Khan/i);
    expect(all).not.toMatch(/AKU-IED/);
  });

  it('names the level and the teacher', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    const all = page();
    expect(all).toContain('Fatima Rehman');
    expect(all).toMatch(/Secondary School Teachers/i);
    expect(all).toMatch(/CERTIFICATE OF COMPLETION/i);
  });

  it('states the training is conducted by NIETE', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    expect(page()).toMatch(/National Institute of Excellence in Teacher Education/i);
  });

  it('draws all four header marks', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    const a = art();
    expect(a).toMatch(/mofept-seal/);
    expect(a).toMatch(/gop-emblem/);
    expect(a).toMatch(/niete-logo/);
    expect(a).toMatch(/isaps-logo/);
  });

  it('carries both NIETE signatories', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    const all = page();
    expect(all).toContain('Sabeena Abbasi');
    expect(all).toContain('Rifat Jabeen');
    expect(art()).toMatch(/sabeena-signature/);
    expect(art()).toMatch(/riffat-signature/);
  });

  it('prints the issue date and the certificate code', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    const all = page();
    expect(all).toMatch(/1 August 2026/);
    expect(all).toContain('NIETE-L1-20260801-AC8E14');
  });

  it('does NOT print a CPD ladder label — I-SAPS levels are not CPD levels', async () => {
    await svc.renderCertificatePdf({ ...ISAPS });
    expect(page()).not.toMatch(/CPD-LEVEL/);
  });

  it('returns a PDF buffer', async () => {
    const buf = await svc.renderCertificatePdf({ ...ISAPS });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});
