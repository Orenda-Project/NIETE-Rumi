import { describe, it, expect } from "vitest";
import { unitRowState } from "./unitLock";

/**
 * bd-vej4h — a locked unit LOOKS locked on the portal.
 *
 * The server already refuses a locked unit (the bot's checkModuleUnlocked), but
 * the list rendered every unit as open, so the refusal arrived only after the
 * tap. The list now carries each unit's lock from the bot; this is the one place
 * the portal turns it into what the row shows.
 */
describe("unitRowState", () => {
  it("a locked unit is disabled and says why", () => {
    expect(unitRowState({ lock: "locked" })).toEqual({ disabled: true, hint: "Pass the session before this one to open it" });
  });
  it("next-up and passed units open", () => {
    expect(unitRowState({ lock: "next" }).disabled).toBe(false);
    expect(unitRowState({ lock: "passed" }).disabled).toBe(false);
  });
  it("no lock information (other vendors, or the lookup failed) opens as before", () => {
    expect(unitRowState({})).toEqual({ disabled: false, hint: null });
    expect(unitRowState({ lock: null })).toEqual({ disabled: false, hint: null });
  });
});
