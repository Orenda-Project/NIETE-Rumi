import { describe, it, expect } from "vitest";
import { providerInitials, providerLabel, providerShort, type Vendor } from "./trainingApi";
import { certificateSummary, continueCard } from "../../teacher/training/model";

/**
 * bd-2gia5l — the training providers are renamed (NIETE, 2026-10-13), and the name teachers see is
 * the one in `training_vendors.name`. The portal used to hardcode each provider's label over the
 * server's, so renaming the DB row changed nothing a teacher saw.
 *
 *   OXBRIDGE    → Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10
 *   BEACONHOUSE → AI-Powered Subject Pedagogy, 6-10
 *   ISAPS       → Teacher Development Programme, 9-12
 *
 * The full names are long, so a chip, a certificate row and the Continue button use a short label.
 */

const vendor = (vendor_key: string, vendor_name: string) => ({ vendor_key, vendor_name }) as Vendor;

describe("providerLabel", () => {
  it("is the server's name for the provider, so a DB rename reaches the portal with no deploy", () => {
    expect(providerLabel("OXBRIDGE", [vendor("OXBRIDGE", "Renamed in the DB")])).toBe("Renamed in the DB");
    expect(providerLabel("BEACONHOUSE", [vendor("BEACONHOUSE", "Another DB name")])).toBe("Another DB name");
  });

  it("falls back to the new names where the page has no server name", () => {
    expect(providerLabel("OXBRIDGE")).toBe("Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10");
    expect(providerLabel("BEACONHOUSE")).toBe("AI-Powered Subject Pedagogy, 6-10");
    expect(providerLabel("ISAPS")).toBe("Teacher Development Programme, 9-12");
    expect(providerLabel("TALEEMABAD")).toBe("NIETE");
  });

  it("ignores a blank server name", () => {
    expect(providerLabel("ISAPS", [vendor("ISAPS", "  ")])).toBe("Teacher Development Programme, 9-12");
  });
});

describe("providerShort and providerInitials", () => {
  it("give the tight places a short label", () => {
    expect(providerShort("OXBRIDGE", "Oxbridge")).toBe("GBTLA");
    expect(providerShort("BEACONHOUSE", "Beacon House")).toBe("AI Pedagogy");
    expect(providerShort("ISAPS", "I-SAPS")).toBe("Teacher Development");
    expect(providerShort("TALEEMABAD", "NIETE")).toBe("NIETE");
  });

  it("badge the renamed providers by their new names", () => {
    expect(providerInitials("OXBRIDGE")).toBe("GB");
    expect(providerInitials("BEACONHOUSE")).toBe("AI");
    expect(providerInitials("ISAPS")).toBe("TD");
    expect(providerInitials("TALEEMABAD")).toBe("N");
  });
});

describe("teacher v2 hub", () => {
  it("names the provider on the Continue card by its short label", () => {
    const card = continueCard(
      { vendorKey: "OXBRIDGE", levelId: 17, to: "/x" } as never,
      [vendor("OXBRIDGE", "Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10")],
      [],
    );
    expect(card?.provider).toBe("GBTLA");
  });

  it("labels a certificate provider by the server's name", () => {
    const summary = certificateSummary([{ vendor_key: "BEACONHOUSE", vendor_name: "AI-Powered Subject Pedagogy, 6-10" }]);
    expect(summary.providers[0].label).toBe("AI-Powered Subject Pedagogy, 6-10");
  });
});
