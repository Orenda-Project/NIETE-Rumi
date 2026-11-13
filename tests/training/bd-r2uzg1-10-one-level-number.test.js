/**
 * bd-r2uzg1.10 — one level number everywhere (ICT issues sheet: Primary TT 22,
 * Middle and High TT 28; open umbrella bd-arghnv.5).
 *
 * A teacher opened My Certificates on WhatsApp, saw "Level 3 · Skilled
 * Practitioner", downloaded it, and the certificate read
 * "CPD-LEVEL-2 SKILLED PRACTITIONER". The certificate list numbered levels
 * `order_index + 1`; the PDF (cpd_level) and the WhatsApp training Flow
 * (`Level ${order_index}`, bd-2235) number the NIETE ladder 0-3. Two lists in
 * the same chat disagreed about the same level.
 *
 * The rule now lives in ONE place (level-label.rules.js) and every WhatsApp
 * surface that prints a level number goes through it:
 *   - the My Certificates Flow list (certificateOptionTitle),
 *   - the typed /certificates reply,
 *   - the level-exam intro ("🎓 *Level 2 · Skilled Practitioner — Grand Quiz*",
 *     pinned in grand-quiz-level-resolution.test.js).
 *
 * Partner programmes (Beaconhouse subjects, the single Oxbridge programme,
 * I-SAPS, all `all_modules`) have no ladder number on their certificate, so
 * their rows carry the level name only — as the training Flow already does
 * (bd-2137). I-SAPS keeps its number because its NAME carries it ("Level 1:
 * Novice"), and that number already matched its PDF.
 *
 * Fixtures are the production training_levels rows (NIETE prod, read 13 Nov 2026).
 */

const fs = require('fs');
const path = require('path');

const { certificateOptionTitle } = require('../../bot/shared/routes/teacher-training-endpoint');
const { cpdDisplayName } = require('../../bot/shared/services/training/certificate-pdf.service');
const Labels = require('../../bot/shared/services/training/level-label.rules');

const ROOT = path.join(__dirname, '../..');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const cert = (name, orderIndex, unlockLogic, code = 'NIETE-20261111-4TYMHE') => ({
  certificate_code: code,
  level_name_snapshot: name,
  teacher_name_snapshot: 'Aisha Malik',
  issued_at: '2026-11-11T09:00:00.000Z',
  training_levels: { order_index: orderIndex, training_vendors: { unlock_logic: unlockLogic } },
});

// TALEEMABAD (NIETE) — chain ladder. cpd_level: null, 1, 2, 3.
const NIETE = [
  { c: cert('Aspiring Teacher', 0, 'chain'), cpd: null },
  { c: cert('Emerging Practitioner', 1, 'chain'), cpd: 1 },
  { c: cert('Skilled Practitioner', 2, 'chain', 'NIETE-L3-20260709-04B3CD'), cpd: 2 },
  { c: cert('Teacher Leader', 3, 'chain'), cpd: 3 },
];

describe('My Certificates: a NIETE level carries the number its certificate prints', () => {
  test('Skilled Practitioner reads Level 2 — the PDF says CPD-LEVEL-2', () => {
    expect(certificateOptionTitle(NIETE[2].c)).toBe('Level 2 · Skilled Practitioner');
  });

  test('the whole ladder reads 0-3, as the training Flow numbers it', () => {
    expect(NIETE.map(x => certificateOptionTitle(x.c))).toEqual([
      'Level 0 · Aspiring Teacher',
      'Level 1 · Emerging Practitioner',
      'Level 2 · Skilled Practitioner',
      'Level 3 · Teacher Leader',
    ]);
  });

  test('every level with a CPD number shows that same number in the list and on the PDF', () => {
    for (const { c, cpd } of NIETE.filter(x => x.cpd !== null)) {
      const onPdf = /CPD-LEVEL-(\d+)/.exec(cpdDisplayName(c.level_name_snapshot, cpd))[1];
      const inList = /^Level (\d+) · /.exec(certificateOptionTitle(c))[1];
      expect(inList).toBe(onPdf);
    }
  });

  test('a missing level name still degrades to the code, never "Level 2 · undefined"', () => {
    const bare = { certificate_code: 'NIETE-20260101-AAAAAA', training_levels: { order_index: 2, training_vendors: { unlock_logic: 'chain' } } };
    expect(certificateOptionTitle(bare)).toBe('NIETE-20260101-AAAAAA');
  });
});

describe('partner programmes are not given a ladder number their certificate does not have', () => {
  test('Beaconhouse subjects read as the subject', () => {
    expect(certificateOptionTitle(cert('English', 1, 'all_modules', 'BH-20260101-AAAAAA'))).toBe('English');
    expect(certificateOptionTitle(cert('Computer Science', 4, 'all_modules', 'BH-20260101-AAAAAB'))).toBe('Computer Science');
  });

  test('the single Oxbridge programme is not "Level 5"', () => {
    const name = 'Professional Training in Game-Based Teaching, Learning & Assessment';
    expect(certificateOptionTitle(cert(name, 4, 'all_modules', 'OXB-L17-20260430-1B2C3D'))).toBe(name);
  });

  test('I-SAPS keeps the number its name and PDF carry (Level 1/2/3), never Level 0', () => {
    expect(certificateOptionTitle(cert('Level 1: Novice', 0, 'all_modules'))).toBe('Level 1: Novice');
    expect(certificateOptionTitle(cert('Level 2: Intermediate', 1, 'all_modules'))).toBe('Level 2: Intermediate');
    expect(certificateOptionTitle(cert('Level 3: Advanced', 2, 'all_modules'))).toBe('Level 3: Advanced');
  });
});

describe('the typed /certificates reply uses the same numbering', () => {
  test('lists Skilled Practitioner as Level 2 and keeps the old certificate code as it is', () => {
    const body = Labels.certificatesListText([NIETE[0].c, NIETE[2].c]);
    expect(body).toContain('✅ *Level 0 · Aspiring Teacher*');
    expect(body).toContain('✅ *Level 2 · Skilled Practitioner*');
    expect(body).toContain('Cert: `NIETE-L3-20260709-04B3CD`');
    expect(body).not.toMatch(/Level 3 · Skilled/);
    expect(body).toContain('🏆 *NIETE Certifications — Aisha Malik*');
    expect(body).toContain('Passed 11 Nov 2026');
    expect(body).toContain('/certificate <code>');
  });

  test('a partner certificate in the reply carries no invented number', () => {
    const body = Labels.certificatesListText([cert('English', 1, 'all_modules', 'BH-20260101-AAAAAA')]);
    expect(body).toContain('✅ *English*');
    expect(body).not.toMatch(/Level \d+ · English/);
  });

  test('the handler builds the reply through the shared rule, with no +1 of its own', () => {
    const src = read('bot/shared/handlers/text-message.handler.js');
    expect(src).toMatch(/certificatesListText\(/);
    expect(src).not.toMatch(/order_index\s*\?\?\s*0\)\s*\+\s*1/);
  });
});

describe('both certificate reads fetch the vendor rule the label needs', () => {
  test('the embed carries order_index and the vendor unlock_logic', () => {
    expect(Labels.CERTIFICATE_LEVEL_EMBED).toMatch(/training_levels\(/);
    expect(Labels.CERTIFICATE_LEVEL_EMBED).toMatch(/order_index/);
    expect(Labels.CERTIFICATE_LEVEL_EMBED).toMatch(/training_vendors\(unlock_logic\)/);
  });

  test('the Flow list and the typed reply both select it', () => {
    for (const rel of ['bot/shared/routes/teacher-training-endpoint.js', 'bot/shared/handlers/text-message.handler.js']) {
      const src = read(rel);
      expect(src).toMatch(/CERTIFICATE_LEVEL_EMBED/);
      expect(src).not.toMatch(/training_levels\(order_index\)/);
    }
  });
});

describe('levelLabel — the one rule', () => {
  test('a ladder level is "Level <order_index> · name"; a missing unlock_logic counts as a ladder (the Flow default)', () => {
    expect(Labels.levelLabel({ order_index: 2, unlock_logic: 'chain' }, 'Skilled Practitioner')).toBe('Level 2 · Skilled Practitioner');
    expect(Labels.levelLabel({ order_index: 2 }, 'Skilled Practitioner')).toBe('Level 2 · Skilled Practitioner');
  });

  test('a non-ladder level, or one with no order, is its name', () => {
    expect(Labels.levelLabel({ order_index: 1, unlock_logic: 'all_modules' }, 'English')).toBe('English');
    expect(Labels.levelLabel({ order_index: null, unlock_logic: 'chain' }, 'Skilled Practitioner')).toBe('Skilled Practitioner');
    expect(Labels.levelLabel(null, 'Skilled Practitioner')).toBe('Skilled Practitioner');
  });
});
