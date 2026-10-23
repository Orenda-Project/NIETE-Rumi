/**
 * bd-yef5iq — the I-SAPS certificate names the level the teacher actually finished.
 *
 * The template (bd-60113) was approved when only Level 1 existed, and the body
 * line was written as a literal: "Level 1 (Basic Level) of Secondary School
 * Teachers' Training". I-SAPS ships three levels — Novice, Intermediate,
 * Advanced (Assessment Administration Process, §1) — and Level 2 went live on
 * 2026-10-23. Every Level 2 certificate would have told the teacher, and anyone
 * she shows it to, that she had completed Level 1.
 *
 * The level number comes from training_levels.cpd_level when the caller has it,
 * and otherwise from the level's own name ("Level 2: Intermediate"), because the
 * re-render path hands over only the name snapshot.
 */

const { EventEmitter } = require('events');

let svc;
let textCalls;

function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.x = 0; doc.y = 0;
    for (const m of ['registerFont', 'font', 'fontSize', 'fillColor', 'strokeColor', 'lineWidth',
      'opacity', 'rect', 'roundedRect', 'circle', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath',
      'fill', 'stroke', 'fillAndStroke', 'clip', 'save', 'restore', 'translate', 'rotate', 'addPage',
      'image']) {
      doc[m] = chain;
    }
    doc.linearGradient = () => ({ stop: function () { return this; } });
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
  textCalls = [];
  jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

const page = () => textCalls.join('\n');

const BASE = {
  teacherName: 'Fatima Rehman',
  certificateCode: 'ISAPS-20261023-AC8E14',
  issuedAt: '2026-10-23T09:00:00.000Z',
  vendorKey: 'ISAPS',
};

describe('bd-yef5iq — I-SAPS certificate level line', () => {
  it('Level 1 keeps the approved wording, unchanged', async () => {
    await svc.renderCertificatePdf({ ...BASE, levelName: 'Level 1: Novice', cpdLevel: 1 });
    expect(page()).toContain("Level 1 (Basic Level) of Secondary School Teachers' Training");
  });

  it('Level 2 says Level 2 (Intermediate Level), and never Level 1', async () => {
    await svc.renderCertificatePdf({ ...BASE, levelName: 'Level 2: Intermediate', cpdLevel: 2 });
    const all = page();
    expect(all).toContain("Level 2 (Intermediate Level) of Secondary School Teachers' Training");
    expect(all).not.toMatch(/Level 1/);
    expect(all).not.toMatch(/Basic Level/);
  });

  it('Level 3 says Level 3 (Advanced Level)', async () => {
    await svc.renderCertificatePdf({ ...BASE, levelName: 'Level 3: Advanced', cpdLevel: 3 });
    expect(page()).toContain("Level 3 (Advanced Level) of Secondary School Teachers' Training");
  });

  it('reads the level from the name when cpd_level is not passed (re-render path)', async () => {
    await svc.renderCertificatePdf({ ...BASE, levelName: 'Level 2: Intermediate' });
    const all = page();
    expect(all).toContain("Level 2 (Intermediate Level) of Secondary School Teachers' Training");
    expect(all).not.toMatch(/Basic Level/);
  });
});
