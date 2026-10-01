/**
 * bd-vej4h — what a unit row shows, from the lock the bot sent with it.
 *
 * The rule itself lives in the bot (annotateModuleLocks); the server refuses a
 * locked unit regardless. This only turns the lock into the row's state, so a
 * locked unit looks locked instead of failing after the tap. A unit with no
 * lock information renders open, exactly as it did before.
 */
export type UnitLock = "passed" | "next" | "locked" | null | undefined;

export function unitRowState(unit: { lock?: UnitLock }): { disabled: boolean; hint: string | null } {
  if (unit && unit.lock === "locked") {
    return { disabled: true, hint: "Pass the session before this one to open it" };
  }
  return { disabled: false, hint: null };
}
