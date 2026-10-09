/** What she typed into a number box: digits only. Urdu (۰-۹) and Arabic-Indic (٠-٩) digits become the ones the server reads. */
export function digitsOnly(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
}
