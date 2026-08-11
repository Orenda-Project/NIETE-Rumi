/**
 * Teacher Training — Certificate PDF renderer, store and delivery.
 *
 * `training_certificates.pdf_r2_key` shipped as a documented placeholder
 * ("null until PDF generated") that nothing ever wrote. A teacher who passed a
 * level exam got a row and a code — nothing they could hold, print, or hand to
 * a head teacher. This module fills the column in.
 *
 * WHY PDFKIT AND NOT ONE OF THE EXISTING RENDERERS
 * ------------------------------------------------
 * Four renderers already exist in this tree and none of them is the right base
 * for a certificate:
 *
 *   - `coaching/report-v2/hero-report.*` and the MEWAKA/quiz/reading templates
 *     all go through `utils/html-to-pdf` → Playwright. That means a Chromium
 *     launch. Issuance happens INSIDE the WhatsApp grading turn, on the web
 *     dyno and on the portal's Express process; paying a browser boot for a
 *     one-page static document with five fields would be the wrong trade, and
 *     it adds a failure mode (no Chromium in the image) to a path that must
 *     never fail.
 *   - `exam-checker/annotation.service` uses node-canvas — a native module the
 *     root test suite has to stub, and irrelevant here (nothing to composite).
 *   - `pdf-report.service._generatePDFKitReport` is PDFKit, which IS the right
 *     engine, but it is a multi-section scored-observation LAYOUT: header
 *     badge, domain cards, progress bars, per-criterion evidence boxes,
 *     paginated footers. A certificate shares none of that structure.
 *
 * So: reuse the ENGINE and the CONVENTIONS of `pdf-report.service.js` — the
 * chunk-collection stream idiom, the bundled NIETE mark, and above all its
 * hard-won font rule (register Noto Naskh, NOT Nastaliq, whose GPOS anchor
 * tables crash fontkit; and actually CALL `doc.font()` with it, because
 * registering a font and never selecting it is what shipped Latin-1 mojibake
 * for Urdu text) — and write the one-page landscape layout fresh. Reusing the
 * report layout would have meant bending a scorecard into a certificate.
 *
 * FAILURE POLICY
 * --------------
 * Everything here is BEST EFFORT. Every entry point swallows its errors and
 * returns null/false. A `training_certificates` row with a null `pdf_r2_key`
 * is a permanently valid state — it is what all 12k+ existing rows look like —
 * so nothing in this file may ever propagate an error into issuance.
 */

const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../utils/logger');
const branding = require('../../config/branding');

// NIETE palette (brand book): navy-slate + green. Same pair the coaching hero
// report uses for this deployment, so a teacher's certificate and their
// observation report read as one family.
const COLORS = {
  ink: '#333748',      // navy slate — headings, name, rules
  accent: '#47BA7D',   // green — border, seal, divider
  muted: '#6B7280',    // labels and the metadata footer
  paper: '#FFFFFF',
};

// A4 landscape, in points.
const PAGE = { width: 842, height: 595 };
const MARGIN = 40;

/**
 * PER-VENDOR TEMPLATES — why this is a registry and not one layout
 * ----------------------------------------------------------------
 * The system this fork replaced issued THREE different certificates, chosen by
 * vendor, and teachers have already received them. Collapsing them into one
 * generic page was a regression, and not only a cosmetic one:
 *
 *   The NIETE certificate asserts that the content was "independently reviewed
 *   and approved by The Aga Khan University – Institute for Educational
 *   Development (AKU-IED)", and carries two named NIETE signatories. Those are
 *   claims about NIETE and about AKU. Printing them on a Beaconhouse or an
 *   Oxbridge certificate would assert an accreditation that a third party never
 *   gave — so the partner templates must not merely *look* different, they must
 *   be provably free of NIETE/AKU text. The legacy repo guarded exactly this
 *   with a test; `tests/training/certificate-vendor-templates.test.js` is its
 *   equivalent here, and the negative assertions are the point of the file.
 *
 * Legacy source of truth (read-only migration source, taleemabad-core):
 *   frontend/libs/dsm/components/src/lib/molecules/level-certificate/
 *     level-certificate.tsx              → NIETE / TALEEMABAD (and the fallback)
 *     beaconhouse-level-certificate.tsx  → BEACONHOUSE
 *     oxbridge-level-certificate.tsx     → OXBRIDGE
 *   routed by vendor at training-level-page.tsx:920.
 *
 * An unknown vendor falls back to the NIETE template — matching the legacy
 * router's final `else`, and matching `getVendorConfig()`'s fallback. That is
 * the safe default HERE only because this deployment IS NIETE; a fork whose
 * house template is not the accredited one must change DEFAULT_TEMPLATE.
 */

// Partner palettes, lifted verbatim from the legacy components so a reissued
// certificate matches the one a teacher already holds.
const BH_NAVY = '#1F4788';
const BH_GOLD = '#FDB913';
const OX_NAVY = '#003366';
const OX_GOLD = '#FFD700';

const ASSET_DIR = path.join(__dirname, '../../assets/certs');

/**
 * Legacy LEVEL_DISPLAY_NAMES (level-certificate.tsx:15). The NIETE ladder is
 * printed as "CPD-LEVEL-2 SKILLED PRACTITIONER", not as the bare level name.
 * Anything absent from the map fell through to the raw name — which is what
 * "Aspiring Teacher" (cpd_level NULL in the schema) relies on.
 */
const CPD_DISPLAY_NAMES = {
  'Emerging Practitioner': 'CPD-LEVEL-1 EMERGING PRACTITIONER',
  'Skilled Practitioner': 'CPD-LEVEL-2 SKILLED PRACTITIONER',
  'Teacher Leader': 'CPD-LEVEL-3 TEACHER LEADER',
};

/**
 * The NIETE display name for a level.
 *
 * Prefers the explicit `cpd_level` column over the name map: the map is keyed
 * on English level names, so a renamed or translated level would silently lose
 * its CPD number. `cpdLevel` is the column the schema added for exactly this.
 * Falls back to the legacy map, then to the raw name.
 *
 * @param {string} levelName
 * @param {number|null} [cpdLevel]
 * @returns {string}
 */
function cpdDisplayName(levelName, cpdLevel) {
  const name = String(levelName || 'Level');
  if (cpdLevel === 0 || cpdLevel) {
    const n = Number(cpdLevel);
    if (Number.isInteger(n) && n > 0) return `CPD-LEVEL-${n} ${name.toUpperCase()}`;
  }
  return CPD_DISPLAY_NAMES[name] || name;
}

/**
 * Normalise a vendor key to a template id.
 * Legacy registered both 'BEACONHOUSE' and 'Beaconhouse', so callers may pass
 * either the raw API value or the title-case display name.
 * @param {string} [vendorKey]
 * @returns {'TALEEMABAD'|'BEACONHOUSE'|'OXBRIDGE'}
 */
function templateIdFor(vendorKey) {
  const key = String(vendorKey || '').trim().toUpperCase();
  if (key === 'BEACONHOUSE') return 'BEACONHOUSE';
  if (key === 'OXBRIDGE') return 'OXBRIDGE';
  return 'TALEEMABAD';
}

/**
 * The R2 object key for a certificate PDF. Shape is prescribed by the schema
 * comment on `training_certificates.pdf_r2_key` — keep them in step.
 * @param {string} userId
 * @param {string} certificateCode
 * @returns {string|null} null when either part is missing (never upload to a
 *   half-formed key — an object at `certs//X.pdf` is unreachable by the row)
 */
function certificatePdfKey(userId, certificateCode) {
  if (!userId || !certificateCode) return null;
  return `certs/${userId}/${certificateCode}.pdf`;
}

/** Arabic-script detection (base, supplement, extended-A, presentation forms). */
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function isArabicScript(text) {
  return ARABIC_SCRIPT_RE.test(String(text || ''));
}

/** Format an ISO timestamp as a human issue date; falls back to today. */
function formatIssueDate(issuedAt) {
  const d = issuedAt ? new Date(issuedAt) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Draw an optional image. Every asset on a certificate is optional by design —
 * a clone without the file gets a valid certificate rather than an ENOENT, and
 * a corrupt file costs one mark rather than the whole document.
 * @returns {boolean} whether it was drawn
 */
function drawAsset(doc, file, x, y, opts) {
  if (!fs.existsSync(file)) return false;
  try {
    doc.image(file, x, y, opts);
    return true;
  } catch (err) {
    logToFile('⚠️  Certificate asset skipped', { file: path.basename(file), error: err.message });
    return false;
  }
}

// Height reserved for a signature image. Signatures are constrained by HEIGHT,
// not width: the two assets have very different aspect ratios (Sabeena's is
// roughly square, Rifat's is tall), so sizing by width alone made one of them
// overflow its slot and strike through the name printed below it. Fitting each
// into the same box keeps them optically comparable and the name clear.
const SIG_BOX_H = 40;
const SIG_GAP = 6;

/**
 * A signature block: optional signature image, then name/title lines, with an
 * optional rule between them. `align` decides which edge the block hangs from.
 *
 * The image is scaled to fit SIG_BOX_H and the cursor advances by that same
 * box, so the text below can never collide with the artwork above it —
 * regardless of the asset's intrinsic dimensions. A missing image collapses the
 * box rather than leaving a hole.
 */
function drawSignatory(doc, { x, width, y, align, image, lines, rule, ruleColor }) {
  let cursor = y;

  if (image && fs.existsSync(image)) {
    // `fit` scales into the box preserving aspect ratio; the align options
    // position it inside that box, so the anchor is the box, not the artwork.
    const drawn = drawAsset(doc, image, x, cursor, {
      fit: [width, SIG_BOX_H],
      align,
      valign: 'bottom',
    });
    if (drawn) cursor += SIG_BOX_H + SIG_GAP;
  }

  if (rule) {
    const rx = align === 'right' ? x + width - 160 : align === 'center' ? x + (width - 160) / 2 : x;
    doc.lineWidth(2).strokeColor(ruleColor).moveTo(rx, cursor).lineTo(rx + 160, cursor).stroke();
    cursor += SIG_GAP;
  }

  for (const line of lines) {
    const size = line.size || 9;
    doc.font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
       .fillColor(line.color || COLORS.ink)
       .text(line.text, x, cursor, { width, align });
    cursor += size + 4;
  }
}

/**
 * Render the certificate. Returns a PDF Buffer.
 *
 * Dispatches on `vendorKey` to one of three templates (see the registry note at
 * the top of this file). The shared scaffolding — page, fonts, teacher name,
 * code/date footer — lives here; only the vendor-specific body differs, because
 * that body is precisely what must not leak between vendors.
 *
 * Throws on a genuine renderer failure — the callers below are the ones that
 * are required to swallow, so a direct caller (a script, a backfill) can still
 * see what went wrong.
 *
 * @param {object} p
 * @param {string} p.teacherName
 * @param {string} p.levelName
 * @param {string} [p.vendorKey]  - 'TALEEMABAD' | 'BEACONHOUSE' | 'OXBRIDGE'; unknown → NIETE
 * @param {string} [p.vendorName] - display name, used by partner templates
 * @param {number} [p.cpdLevel]   - training_levels.cpd_level; drives CPD-LEVEL-N naming
 * @param {string} p.certificateCode
 * @param {string} [p.issuedAt] - ISO timestamp
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePdf({
  teacherName, levelName, vendorKey, vendorName, cpdLevel, certificateCode, issuedAt,
}) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: [PAGE.width, PAGE.height], margin: MARGIN });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Naskh, never Nastaliq: Nastaliq's GPOS anchor tables crash fontkit
  // ("Cannot read properties of null (reading 'xCoordinate')"). Naskh renders
  // both Urdu and Arabic legibly. Registered up front, selected per-field.
  let hasArabicFont = false;
  const naskh = path.join(__dirname, '../../fonts/NotoNaskhArabic-Regular.ttf');
  if (fs.existsSync(naskh)) {
    doc.registerFont('CertArabic', naskh);
    hasArabicFont = true;
  }

  const template = templateIdFor(vendorKey);
  const isNiete = template === 'TALEEMABAD';
  const palette = template === 'BEACONHOUSE'
    ? { primary: BH_NAVY, secondary: BH_GOLD }
    : template === 'OXBRIDGE'
      ? { primary: OX_NAVY, secondary: OX_GOLD }
      : { primary: COLORS.ink, secondary: COLORS.accent };

  const centerW = PAGE.width - MARGIN * 2;
  const centered = { width: centerW, align: 'center' };
  const arabic = (v) => isArabicScript(v) && hasArabicFont;

  // ── Frame ────────────────────────────────────────────────────────────────
  // NIETE keeps the green/navy double rule. The partner templates reproduce
  // legacy's 3px primary border with a 6px secondary inset outline.
  doc.lineWidth(3).strokeColor(palette.primary)
     .rect(MARGIN * 0.6, MARGIN * 0.6, PAGE.width - MARGIN * 1.2, PAGE.height - MARGIN * 1.2).stroke();
  doc.lineWidth(isNiete ? 0.75 : 6).strokeColor(isNiete ? COLORS.ink : palette.secondary)
     .rect(MARGIN * 0.6 + 7, MARGIN * 0.6 + 7, PAGE.width - MARGIN * 1.2 - 14, PAGE.height - MARGIN * 1.2 - 14).stroke();

  // ── Masthead ─────────────────────────────────────────────────────────────
  let y;
  if (isNiete) {
    // Legacy put the NIETE mark top-RIGHT (level-certificate.tsx:38-49).
    drawAsset(doc, path.join(ASSET_DIR, 'niete-logo.png'), PAGE.width - MARGIN - 130, 58, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.ink)
       .text('CERTIFICATE OF COMPLETION', MARGIN, 132, { ...centered, characterSpacing: 2 });
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('THIS IS TO CERTIFY THAT', MARGIN, 168, { ...centered, characterSpacing: 3 });
    y = 200;
  } else {
    if (template === 'OXBRIDGE') {
      // Legacy banner: Oxbridge left, FDE right (oxbridge-level-certificate.tsx:57-68).
      drawAsset(doc, path.join(ASSET_DIR, 'oxbridge-logo.png'), MARGIN + 16, 56, { width: 190 });
      drawAsset(doc, path.join(ASSET_DIR, 'fde-logo.png'), PAGE.width - MARGIN - 76, 52, { width: 58 });
    }
    // Decorative rule — legacy used a primary→secondary→primary gradient.
    const ruleY = template === 'OXBRIDGE' ? 122 : 96;
    doc.lineWidth(4).strokeColor(palette.secondary)
       .moveTo(MARGIN + 16, ruleY).lineTo(PAGE.width - MARGIN - 16, ruleY).stroke();
    doc.font('Helvetica-Bold').fontSize(22).fillColor(palette.primary)
       .text('CERTIFICATE OF COMPLETION', MARGIN, ruleY + 24, { ...centered, characterSpacing: 2 });
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('This certifies that', MARGIN, ruleY + 58, centered);
    y = ruleY + 84;
  }

  // ── Recipient ────────────────────────────────────────────────────────────
  const nameIsArabic = arabic(teacherName);
  doc.font(nameIsArabic ? 'CertArabic' : 'Helvetica-Bold')
     .fontSize(nameIsArabic ? 28 : 32)
     .fillColor(palette.primary)
     .text(String(teacherName || 'Teacher'), MARGIN, y, centered);
  y += nameIsArabic ? 44 : 46;

  doc.lineWidth(0.75).strokeColor(isNiete ? COLORS.ink : palette.primary)
     .moveTo(PAGE.width / 2 - 190, y).lineTo(PAGE.width / 2 + 190, y).stroke();
  y += 16;

  // ── Body ─────────────────────────────────────────────────────────────────
  if (isNiete) {
    // Legacy sentence (level-certificate.tsx:71-79), including the AKU-IED
    // accreditation. NIETE-only — never on a partner certificate.
    const display = cpdDisplayName(levelName, cpdLevel);
    const displayIsArabic = arabic(display);
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('has successfully completed the Digital', MARGIN, y, centered);
    y += 20;
    doc.font(displayIsArabic ? 'CertArabic' : 'Helvetica-Bold').fontSize(15).fillColor(COLORS.accent)
       .text(display, MARGIN, y, centered);
    y += 24;
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('Program conducted by the National Institute of Excellence in Teacher Education (NIETE).',
             MARGIN + 60, y, { width: centerW - 120, align: 'center' });
    y += 30;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
       .text('The content of this digital training module has been independently reviewed and approved by '
           + 'The Aga Khan University – Institute for Educational Development (AKU-IED)',
             MARGIN + 70, y, { width: centerW - 140, align: 'center' });
  } else {
    const levelIsArabic = arabic(levelName);
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('Has successfully completed the', MARGIN, y, centered);
    y += 20;
    doc.font(levelIsArabic ? 'CertArabic' : 'Helvetica-Bold').fontSize(16).fillColor(palette.primary)
       .text(String(levelName || 'Level'), MARGIN, y, centered);
    y += 24;
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text('program conducted by', MARGIN, y, centered);
    y += 18;
    // The provider's own legal name — the attribution the partner signs off on.
    const provider = template === 'OXBRIDGE'
      ? 'Oxbridge Innovative Solutions (Pvt.) Ltd.'
      : 'Beaconhouse';
    doc.font('Helvetica-Bold').fontSize(13).fillColor(palette.primary)
       .text(provider, MARGIN, y, centered);
  }

  // ── Signatories ──────────────────────────────────────────────────────────
  // NIETE hangs its two signature blocks off the footer (they are tall, with
  // artwork). The partner templates carry a single short signature LINE, so
  // they sit just under the body instead of leaving a void mid-page.
  const sigY = isNiete ? PAGE.height - 190 : Math.min(y + 60, PAGE.height - 168);
  if (isNiete) {
    // Two named signatories with their signature images (level-certificate.tsx:82-110).
    drawSignatory(doc, {
      x: MARGIN + 40, width: 180, y: sigY, align: 'left',
      image: path.join(ASSET_DIR, 'sabeena-signature.png'),
      lines: [
        { text: 'Sabeena Abbasi', bold: true },
        { text: 'Chief Program Officer', color: COLORS.muted },
      ],
    });
    drawSignatory(doc, {
      x: PAGE.width - MARGIN - 220, width: 180, y: sigY, align: 'right',
      image: path.join(ASSET_DIR, 'riffat-signature.png'),
      lines: [
        { text: 'Rifat Jabeen', bold: true },
        { text: 'Project Director', color: COLORS.muted },
        { text: 'NIETE', color: COLORS.muted },
      ],
    });
  } else {
    // Legacy partner templates: one centred signature LINE (no image on file),
    // titled for the provider.
    const lines = template === 'OXBRIDGE'
      ? [
          { text: 'Manzil e Maqsood', bold: true },
          { text: 'CEO', color: COLORS.muted },
          { text: 'Oxbridge Innovative Solutions (Pvt.) Ltd.', color: COLORS.muted, size: 8 },
        ]
      : [
          { text: 'Director', bold: true },
          { text: 'Beaconhouse', color: COLORS.muted },
        ];
    drawSignatory(doc, {
      x: PAGE.width / 2 - 100, width: 200, y: sigY, align: 'center',
      rule: true, ruleColor: palette.primary,
      lines,
    });
  }

  // ── Footer: date left, code right ────────────────────────────────────────
  const footY = PAGE.height - 74;
  doc.lineWidth(0.5).strokeColor('#D8DCE0')
     .moveTo(MARGIN + 40, footY).lineTo(PAGE.width - MARGIN - 40, footY).stroke();

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
     .text('DATE OF ISSUE', MARGIN + 40, footY + 10, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
     .text(formatIssueDate(issuedAt), MARGIN + 40, footY + 22);

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
     .text('CERTIFICATE CODE', PAGE.width - MARGIN - 260, footY + 10, {
       width: 220, align: 'right', characterSpacing: 1.5,
     });
  doc.font('Courier-Bold').fontSize(10).fillColor(COLORS.ink)
     .text(String(certificateCode || ''), PAGE.width - MARGIN - 260, footY + 22, {
       width: 220, align: 'right',
     });

  doc.end();
  return done;
}

/**
 * Best-effort lookup of the vendor + CPD context behind a level.
 *
 * Returns the vendor KEY as well as the display name: the key chooses the
 * template, and choosing the wrong one prints a third party's accreditation on
 * the wrong certificate — so it is fetched from the same row that already had
 * to be read, not inferred from the display name.
 *
 * Its own try/catch: a lookup hiccup must degrade the certificate to the NIETE
 * default, not cost the teacher the whole PDF. Because that default IS the
 * accredited template, a partner whose lookup fails would get a NIETE-branded
 * certificate — so the failure is logged loudly rather than silently absorbed.
 *
 * @returns {Promise<{vendorKey: string|null, vendorName: string|null, cpdLevel: number|null}>}
 */
async function resolveCertificateContext(supabase, levelId) {
  const empty = { vendorKey: null, vendorName: null, cpdLevel: null };
  try {
    if (!supabase || levelId === undefined || levelId === null) return empty;
    const { data: level } = await supabase
      .from('training_levels').select('id, name, vendor_id, cpd_level').eq('id', levelId).maybeSingle();
    if (!level) return empty;
    const cpdLevel = (level.cpd_level === 0 || level.cpd_level) ? Number(level.cpd_level) : null;
    if (!level.vendor_id) return { ...empty, cpdLevel };
    const { data: vendor } = await supabase
      .from('training_vendors').select('id, key, name').eq('id', level.vendor_id).maybeSingle();
    return {
      vendorKey: (vendor && vendor.key) || null,
      vendorName: (vendor && vendor.name) || null,
      cpdLevel,
    };
  } catch (err) {
    logToFile('⚠️  Certificate vendor lookup failed — falling back to the default template', {
      levelId, error: err.message,
    });
    return empty;
  }
}

/**
 * Back-compat shim: the vendor DISPLAY NAME only.
 * @deprecated use resolveCertificateContext — the template needs the key too.
 * @returns {Promise<string|null>}
 */
async function resolveVendorName(supabase, levelId) {
  const { vendorName } = await resolveCertificateContext(supabase, levelId);
  return vendorName;
}

/**
 * Render → upload → persist. The single entry point issuance calls.
 *
 * Never throws. Returns the stored key, or null if ANY step failed — in which
 * case `pdf_r2_key` stays null, which is a valid certificate.
 *
 * The persist is a standalone UPDATE on the already-inserted row rather than a
 * column on the INSERT: bundling a best-effort value into the critical write
 * means one bad column takes the certificate down with it.
 *
 * @param {object} supabase - caller-injected client (bot or dashboard)
 * @param {object} p - { userId, levelId, certificateCode, teacherName, levelName, issuedAt }
 * @returns {Promise<string|null>} the R2 key, or null
 */
async function generateAndStoreCertificatePdf(supabase, p = {}) {
  const { userId, levelId, certificateCode, teacherName, levelName, issuedAt } = p;
  const key = certificatePdfKey(userId, certificateCode);
  if (!key) {
    logToFile('⚠️  Certificate PDF skipped — no key', { userId, certificateCode });
    return null;
  }

  try {
    const { vendorKey, vendorName, cpdLevel } = await resolveCertificateContext(supabase, levelId);
    const buffer = await renderCertificatePdf({
      teacherName, levelName, vendorKey, vendorName, cpdLevel, certificateCode, issuedAt,
    });

    const { uploadBuffer } = require('../../storage/r2');
    await uploadBuffer(buffer, key, 'application/pdf');

    const { error } = await supabase
      .from('training_certificates')
      .update({ pdf_r2_key: key })
      .eq('certificate_code', certificateCode);
    if (error) {
      // The object IS in R2, but the row cannot point at it. Report null so
      // the caller's view matches the database rather than the bucket.
      logToFile('❌ Certificate PDF stored but key not persisted', {
        certificateCode, key, error: error.message,
      });
      return null;
    }

    logToFile('✅ Certificate PDF generated', { certificateCode, key, bytes: buffer.length });
    return key;
  } catch (err) {
    logToFile('❌ Certificate PDF generation failed (row stands, pdf_r2_key stays null)', {
      certificateCode, userId, error: err.message,
    });
    return null;
  }
}

/**
 * Presigned URL for a stored certificate PDF.
 * @param {string} pdfR2Key
 * @param {number} [expiresIn=3600] seconds
 * @param {object} [options] - forwarded to the presigner (e.g. attachment mode)
 * @returns {Promise<string|null>}
 */
async function certificatePdfUrl(pdfR2Key, expiresIn = 3600, options = undefined) {
  if (!pdfR2Key) return null;
  try {
    const { buildR2PublicUrl, getPresignedUrl } = require('../../storage/r2');
    return await getPresignedUrl(buildR2PublicUrl(pdfR2Key), expiresIn, options);
  } catch (err) {
    logToFile('❌ Certificate presign failed', { pdfR2Key, error: err.message });
    return null;
  }
}

/** An error carrying a machine-readable `code` the HTTP layer maps to a status. */
function certError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * The teacher's certificates. A pure read: it never mints and never presigns.
 *
 * Listing is separated from minting on purpose. A teacher with 40 certificates
 * would otherwise trigger 40 renders and 40 uploads to draw a list they may
 * only glance at. `has_pdf` tells the caller which ones are already rendered;
 * the file itself is fetched (and minted, if needed) one at a time, on an
 * actual request.
 *
 * @param {object} supabase
 * @param {string} userId
 * @returns {Promise<Array<{certificate_code, level_name, teacher_name, issued_at, has_pdf}>>}
 */
async function listCertificates(supabase, userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('training_certificates')
    .select('id, certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at, pdf_r2_key')
    .eq('user_id', userId)
    .order('issued_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((c) => ({
    id: c.id,
    certificate_code: c.certificate_code,
    level_name: c.level_name_snapshot,
    teacher_name: c.teacher_name_snapshot,
    issued_at: c.issued_at,
    has_pdf: !!c.pdf_r2_key,
  }));
}

/**
 * FETCH-OR-MINT — the single definition of "give me this certificate's PDF".
 *
 * Both surfaces go through here: the portal (over the internal HTTP API) and
 * WhatsApp (`/certificate <code>`). One implementation, so the two can never
 * disagree about what a teacher is allowed to download or what the file
 * contains.
 *
 * Why mint on demand rather than backfilling: every certificate in production
 * predates PDF generation, and the vast majority will never be asked for.
 * Rendering ~13k PDFs to serve a few dozen is waste. The key is deterministic
 * (`certs/{user_id}/{cert_code}.pdf`), so a concurrent double-mint overwrites
 * one object instead of orphaning one — there is no cleanup path to get wrong.
 *
 * OWNERSHIP IS ENFORCED HERE, not only at the edge. The lookup filters on
 * user_id AND certificate_code. Callers have already established identity, but
 * a lookup by bare code would make any leaked code a working download link.
 *
 * THROWS rather than returning null, with a `code` the caller maps:
 *   bad_request | not_found | mint_failed
 * A file request that cannot be satisfied is a failure, and the caller must be
 * able to tell "you have no such certificate" from "we could not render it".
 * Silent success is what hid a comparable bug for two days elsewhere in this
 * codebase; degrading is the CALLER's decision, not this function's.
 *
 * @param {object} supabase
 * @param {{userId: string, certificateCode: string, expiresIn?: number}} p
 * @returns {Promise<{certificate_code, level_name, teacher_name, issued_at, pdf_r2_key, download_url, minted}>}
 */
async function fetchOrMintCertificatePdf(supabase, p = {}) {
  const { userId, certificateCode, expiresIn = 3600 } = p;
  if (!userId || !certificateCode) {
    throw certError('bad_request', 'userId and certificateCode are required');
  }

  const { data: row, error } = await supabase
    .from('training_certificates')
    .select('id, user_id, level_id, certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at, pdf_r2_key')
    .eq('user_id', userId)
    .eq('certificate_code', certificateCode)
    .maybeSingle();
  if (error) throw certError('lookup_failed', error.message);
  if (!row) throw certError('not_found', 'No such certificate for this user');

  let key = row.pdf_r2_key;
  let minted = false;

  if (!key) {
    key = await generateAndStoreCertificatePdf(supabase, {
      userId,
      levelId: row.level_id,
      certificateCode: row.certificate_code,
      teacherName: row.teacher_name_snapshot,
      levelName: row.level_name_snapshot,
      issuedAt: row.issued_at,
    });
    if (!key) throw certError('mint_failed', 'Certificate PDF could not be generated');
    minted = true;
    logToFile('🏆 Certificate PDF minted on demand', { certificateCode, key });
  }

  // Attachment, not inline: a certificate is a file a teacher saves and prints.
  const downloadUrl = await certificatePdfUrl(key, expiresIn, {
    disposition: 'attachment',
    filename: `${row.certificate_code}.pdf`,
  });
  if (!downloadUrl) throw certError('mint_failed', 'Certificate PDF could not be signed');

  return {
    certificate_code: row.certificate_code,
    level_name: row.level_name_snapshot,
    teacher_name: row.teacher_name_snapshot,
    issued_at: row.issued_at,
    pdf_r2_key: key,
    download_url: downloadUrl,
    minted,
  };
}

/**
 * Send the certificate to the teacher on WhatsApp as a document.
 *
 * No-op (false) when the certificate has no PDF — the congratulation message
 * with the code has already gone out and remains the fallback, so a missing
 * PDF costs the teacher an attachment, not the news.
 *
 * @param {string} phoneNumber
 * @param {object} cert - a training_certificates-shaped object
 * @param {string} [caption]
 * @returns {Promise<boolean>}
 */
async function sendCertificateDocument(phoneNumber, cert, caption) {
  try {
    const key = cert && cert.pdf_r2_key;
    if (!phoneNumber || !key) return false;

    const { buildR2PublicUrl } = require('../../storage/r2');
    const WhatsAppService = require('../whatsapp.service');

    const code = (cert.certificate_code || 'certificate').replace(/[^A-Za-z0-9._-]/g, '_');
    const text = caption || (cert.level_name
      ? `🏆 Your ${cert.level_name} certificate.`
      : '🏆 Your certificate.');

    const ok = await WhatsAppService.sendDocumentFromUrl(
      phoneNumber, buildR2PublicUrl(key), `${code}.pdf`, text,
    );
    return !!ok;
  } catch (err) {
    logToFile('❌ Certificate document delivery failed', {
      certificateCode: cert && cert.certificate_code, error: err.message,
    });
    return false;
  }
}

/**
 * A certificate code: <PREFIX>-<YYYYMMDD>-<alnum>, optionally with the legacy
 * import's extra `-L<n>` segment (`NIETE-L3-20260712-697CAA`).
 */
const CERT_CODE_RE = /^[A-Z0-9]{1,12}(?:-L\d+)?-\d{8}-[A-Z0-9]+$/;

/**
 * Parse the WhatsApp `/certificate[s]` command.
 *
 * Exported (and parsed here rather than inline in text-message.handler.js)
 * because that handler pulls in ~40 services and cannot be booted in a test —
 * anything hidden inside it is untestable by construction.
 *
 * @param {string} text - the trimmed inbound message
 * @returns {{code: string|null}|null} null when this is not the command at all;
 *   `{ code: null }` for a bare "show me my certificates";
 *   `{ code }` when the teacher named one.
 *
 * A junk argument degrades to the LIST rather than to a "not found" — a
 * teacher typing "/certificate please" wants their certificates, not an error.
 */
function parseCertificateCommand(text) {
  const trimmed = String(text || '').trim();
  const m = /^\/certificates?(?:\s+(.*))?$/i.exec(trimmed);
  if (!m) return null;

  const arg = (m[1] || '').trim().toUpperCase();
  if (!arg) return { code: null };
  return CERT_CODE_RE.test(arg) ? { code: arg } : { code: null };
}

/**
 * Fetch-or-mint one certificate and hand it to the teacher on WhatsApp.
 *
 * Goes through the SAME fetchOrMintCertificatePdf the portal reaches over the
 * internal API, so a certificate the teacher can download in the browser is
 * exactly the certificate they get in chat — including the legacy rows, which
 * mint on first request either way.
 *
 * Never throws. Returns a reason the caller turns into a message.
 *
 * @returns {Promise<{ok: boolean, reason?: 'not_found'|'mint_failed'|'send_failed'|'error', minted?: boolean}>}
 */
async function deliverCertificateByCode(supabase, { userId, phoneNumber, certificateCode }) {
  try {
    // Via module.exports so a test (and any future wrapper) can observe the
    // one shared entry point rather than a private closure reference.
    const cert = await module.exports.fetchOrMintCertificatePdf(supabase, { userId, certificateCode });

    const ok = await sendCertificateDocument(phoneNumber, {
      certificate_code: cert.certificate_code,
      level_name: cert.level_name,
      pdf_r2_key: cert.pdf_r2_key,
    });
    if (!ok) return { ok: false, reason: 'send_failed' };

    logToFile('🏆 Certificate delivered on WhatsApp', { userId, certificateCode, minted: cert.minted });
    return { ok: true, minted: cert.minted };
  } catch (err) {
    const reason = (err && (err.code === 'not_found' || err.code === 'mint_failed')) ? err.code : 'error';
    logToFile('❌ Certificate chat delivery failed', { userId, certificateCode, reason, error: err && err.message });
    return { ok: false, reason };
  }
}

module.exports = {
  certificatePdfKey,
  renderCertificatePdf,
  generateAndStoreCertificatePdf,
  certificatePdfUrl,
  sendCertificateDocument,
  // The shared fetch-or-mint surface — used by the internal HTTP API (which
  // the portal calls) and by the WhatsApp /certificate command.
  listCertificates,
  fetchOrMintCertificatePdf,
  // WhatsApp command surface, kept out of the un-bootable text handler.
  parseCertificateCommand,
  deliverCertificateByCode,
  // exported for tests + any future backfill script
  resolveVendorName,
  resolveCertificateContext,
  cpdDisplayName,
  templateIdFor,
  formatIssueDate,
  isArabicScript,
};
