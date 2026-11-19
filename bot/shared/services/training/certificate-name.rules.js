/**
 * Whose name goes on a certificate that was issued without one.
 *
 * Issuance freezes the account's name into training_certificates.teacher_name_snapshot
 * (certificate.service.js). An account with no name at that moment gets the placeholder
 * 'Teacher', and the PDF prints it. A coach adding the name afterwards changed nothing:
 * the snapshot and the cached PDF were both kept, so the teacher downloaded "Teacher"
 * again and again.
 *
 * The rule: a snapshot that is blank or the placeholder is repaired from the account's
 * name once the account has a real one. A snapshot that already holds a name stays
 * frozen — this fills a missing name, it does not rewrite issued certificates.
 *
 * Pure: no database, no env. certificate-pdf.service.js applies it on fetch.
 */

/** What issuance writes when the account has no name (certificate.service.js). */
const PLACEHOLDER_TEACHER_NAME = 'Teacher';

/** training_certificates.teacher_name_snapshot is a varchar(255). */
const MAX_NAME_LENGTH = 255;

/**
 * Is this snapshot the "no name" placeholder: null, blank, or 'Teacher' in any case?
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
function isPlaceholderTeacherName(name) {
  const t = String(name == null ? '' : name).trim();
  return t === '' || t.toLowerCase() === PLACEHOLDER_TEACHER_NAME.toLowerCase();
}

/**
 * The name to put on this certificate instead of its snapshot, or null to leave it.
 * Only a placeholder snapshot is repaired, and only with a real account name.
 * @param {string|null|undefined} snapshot - training_certificates.teacher_name_snapshot
 * @param {string|null|undefined} accountName - users.name now
 * @returns {string|null}
 */
function nameToRepair(snapshot, accountName) {
  if (!isPlaceholderTeacherName(snapshot)) return null;
  if (isPlaceholderTeacherName(accountName)) return null;
  return String(accountName).trim().slice(0, MAX_NAME_LENGTH);
}

module.exports = {
  PLACEHOLDER_TEACHER_NAME,
  isPlaceholderTeacherName,
  nameToRepair,
};
