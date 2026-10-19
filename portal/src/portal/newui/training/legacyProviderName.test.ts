import { describe, expect, it } from "vitest";
import { providerInitials, providerLabel, providerShort } from "./trainingApi";

// bd-s42dye.7: the old platform's trainings are shown to coaches as "Taleemabad Archive", so it reads as
// no-longer-live. The short label wins over the server's name (providerShort), so the fallback must say it too.
describe("legacy provider name (TALEEMABAD_LEGACY)", () => {
  it("is 'Taleemabad Archive' when the server sends no name", () => {
    expect(providerLabel("TALEEMABAD_LEGACY")).toBe("Taleemabad Archive");
  });
  it("short label is 'Taleemabad Archive', even if the server still says 'Taleemabad'", () => {
    expect(providerShort("TALEEMABAD_LEGACY", "Taleemabad")).toBe("Taleemabad Archive");
  });
  it("initials are TA", () => {
    expect(providerInitials("TALEEMABAD_LEGACY")).toBe("TA");
  });
});
