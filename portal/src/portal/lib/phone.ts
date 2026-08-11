/**
 * bd-2510 / bd-2511 — Pakistani mobile number handling, client side.
 *
 * This deliberately MIRRORS `sanitizePhoneNumber()` in
 * dashboard/routes/portal.routes.js. The server already accepts every form
 * below and normalizes to `923XXXXXXXXX` before it looks anyone up, so this
 * is not new leniency — it is the client finally telling the truth about what
 * the server takes.
 *
 * Why it exists at all: the server's loose 10-15 digit validator lets a
 * wrong-length number through to the DB lookup, which then misses and returns
 * "No portal account found for this phone number." A teacher who dropped a
 * digit reads that as "you have no account". Catching the length here turns
 * that into a format hint.
 *
 * Keep the two in step — if the server's accepted forms change, change these.
 */

/** Digits only, `00` prefix dropped — the shared first step. */
function digitsOf(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

/**
 * Normalize to the stored form (`923XXXXXXXXX`), or return the digits
 * unchanged when they match no known shape — exactly as the server does.
 *
 *   '03361234567'      -> '923361234567'
 *   '0336 123 4567'    -> '923361234567'
 *   '+92 336 1234567'  -> '923361234567'
 *   '3361234567'       -> '923361234567'
 */
export function normalizePkMobile(input: string): string {
  const digits = digitsOf(input);
  if (digits.startsWith('0') && digits.length === 11) return '92' + digits.slice(1);
  if (digits.startsWith('3') && digits.length === 10) return '92' + digits;
  return digits;
}

/**
 * True when the input is a complete PK mobile number in any accepted form.
 * A PK mobile is `03` + 9 more digits locally, i.e. `923` + 9 internationally.
 */
export function isValidPkMobile(input: string): boolean {
  return /^923\d{9}$/.test(normalizePkMobile(input));
}

/** The one message shown when `isValidPkMobile` says no. */
export const PK_MOBILE_HINT =
  'Enter an 11-digit mobile number starting with 03 — for example 0336 1234567.';
