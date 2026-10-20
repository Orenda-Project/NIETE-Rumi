/**
 * bd-1p5nkt — ICT DC rows 146, 147: which lesson-plan catalogue subject her class is.
 *
 * Her class names come in HER language (grade-subjects.service: «ریاضی», «اردو» for an Urdu teacher), and the screen
 * used to compare names with an English-only cleaner (`[^a-z0-9]` removed). Every Urdu name became "", so her class
 * matched the FIRST Urdu-named subject in the grade's catalogue: an Urdu class opened General Knowledge
 * («واقفیتِ عامہ», grade 2–3), a Maths class Islamiat («اسلامیات», grade 4).
 *
 * Now: the class's own catalogue key first (featureKey, which /me/grade-subjects?feature=lessons resolves through
 * the subject vocabulary); then the catalogue entry with exactly her name; then a name match that keeps letters of
 * every script and never matches two empty names. Nothing found → null (the caller opens Lesson Plans).
 */

/** Letters and digits of every script, lower-cased; punctuation, spaces and diacritics' joiners dropped. */
function cleaned(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The same subject name, in any script — and never true for two names that clean to nothing. */
export function sameSubjectName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = cleaned(a);
  return x !== '' && x === cleaned(b);
}

export type ClassForKey = { grade: number; subject: string; featureKey?: string | null };
export type CatalogueSubject = { key: string; name: string };

/** The catalogue key the library wants for her class, or null. */
export function libraryKeyFor(cls: ClassForKey | null | undefined, subjects: readonly CatalogueSubject[] | null | undefined): string | null {
  if (!cls) return null;
  const list = subjects ?? [];
  if (cls.featureKey && list.some((s) => s.key === cls.featureKey)) return cls.featureKey;
  const exact = list.find((s) => s.name === cls.subject);
  if (exact) return exact.key;
  const alike = list.find((s) => sameSubjectName(s.name, cls.subject));
  return alike ? alike.key : null;
}
