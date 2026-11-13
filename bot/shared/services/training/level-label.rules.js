/**
 * One level number on WhatsApp (bd-r2uzg1.10; ICT sheet Primary TT 22, Middle and High TT 28).
 *
 * The certificate PDF prints the NIETE ladder as CPD 0-3 ("CPD-LEVEL-2 SKILLED
 * PRACTITIONER") and the WhatsApp training Flow already numbers it `Level ${order_index}`
 * (bd-2235). The My Certificates list, the typed /certificates reply and the level-exam
 * intro printed `order_index + 1`, so a teacher saw "Level 3 · Skilled Practitioner" in
 * the list and "Level 2" on the PDF she downloaded from it. Every WhatsApp surface that
 * prints a level number now goes through levelLabel().
 *
 * Partner programmes (Beaconhouse subjects, the single Oxbridge programme, I-SAPS; vendor
 * unlock_logic 'all_modules') have no ladder number on their certificate. Their rows carry
 * the level name only, as the training Flow does (bd-2137). I-SAPS keeps its own number
 * because its NAME carries it ("Level 1: Novice").
 *
 * Certificate codes are identifiers and are never touched (old ones embed "L3").
 */

/** The embed both certificate reads select, so a label knows its vendor's rule. */
const CERTIFICATE_LEVEL_EMBED = 'training_levels(order_index, training_vendors(unlock_logic))';

/** A missing unlock_logic counts as a ladder, the default every lock rule uses. */
function isLadder(unlockLogic) {
  return (unlockLogic || 'chain') === 'chain';
}

/**
 * "Level <order_index> · <name>" for a ladder level; the name alone for a partner level
 * or a level with no order.
 * @param {{order_index?: number|null, unlock_logic?: string|null}|null} level
 * @param {string} name
 */
function levelLabel(level, name) {
  if (!level || typeof level.order_index !== 'number') return name;
  return isLadder(level.unlock_logic) ? `Level ${level.order_index} · ${name}` : name;
}

/** The level a certificate row was read with (CERTIFICATE_LEVEL_EMBED). */
function certificateLevel(cert) {
  const lvl = cert && cert.training_levels;
  if (!lvl) return null;
  return { order_index: lvl.order_index, unlock_logic: lvl.training_vendors?.unlock_logic ?? null };
}

/**
 * The label a teacher reads on a certificate row. Falls back to the code when the name
 * snapshot is missing: legacy imports do not all carry one.
 */
function certificateTitle(cert) {
  if (!cert) return '';
  const name = cert.level_name_snapshot;
  if (!name) return cert.certificate_code || '';
  return levelLabel(certificateLevel(cert), name);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The typed /certificates reply. */
function certificatesListText(certs) {
  const lines = certs.map(c =>
    `✅ *${certificateTitle(c)}*\n   Passed ${fmtDate(c.issued_at)}\n   Cert: \`${c.certificate_code}\``);
  const teacherName = (certs[0] && certs[0].teacher_name_snapshot) || 'Teacher';
  return `🏆 *NIETE Certifications — ${teacherName}*\n\n` +
    lines.join('\n\n') +
    `\n\n_Send_ \`/certificate <code>\` _to get the PDF._` +
    `\n_Type /training to continue with your next level._`;
}

module.exports = {
  CERTIFICATE_LEVEL_EMBED,
  isLadder,
  levelLabel,
  certificateTitle,
  certificatesListText,
};
