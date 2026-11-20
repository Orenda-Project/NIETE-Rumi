/**
 * bd-o15qnr.28 (queue #204, v7) — the debrief is due 3 school days after the visit (#188's LOCK round: "It is due 3 school
 * days after the visit"). School days are Monday to Saturday (Sunday off): the canvas draws a Thursday visit as "Due by
 * Mon 23 Nov". Days are Pakistan calendar days, YYYY-MM-DD.
 */
export const DEBRIEF_SCHOOL_DAYS = 3;

/** The visit's day (YYYY-MM-DD) → the day its debrief is due (YYYY-MM-DD). */
export function debriefDueDay(visitDay: string, schoolDays = DEBRIEF_SCHOOL_DAYS): string {
  const d = new Date(`${visitDay}T00:00:00Z`);
  let left = schoolDays;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) left -= 1; // Sunday is not a school day
  }
  return d.toISOString().slice(0, 10);
}
