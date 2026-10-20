import { describe, it, expect } from "vitest";
import { COPY } from "./copy";

// The Learning assessment page: Urdu and English carry the same keys, the Urdu
// is in Urdu script, no person is gendered, and no roll number is ever named.

function shape(o: Record<string, unknown>, p = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? shape(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}:${typeof v}`]));
}

function strings(o: Record<string, unknown>): string[] {
  return Object.values(o).flatMap((v) => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") return [String((v as (...a: unknown[]) => string)("X", 1))];
    if (v && typeof v === "object") return strings(v as Record<string, unknown>);
    return [];
  });
}

describe("assess copy", () => {
  it("Urdu and English carry the same keys, of the same kind", () => {
    expect(shape(COPY.ur).sort()).toEqual(shape(COPY.en).sort());
  });

  it("titles", () => {
    expect(COPY.en.title).toBe("Learning assessment");
    expect(COPY.ur.title).toBe("تعلیمی جائزہ");
  });

  it("Urdu strings are in Urdu script (bar the language switch)", () => {
    const ur = strings(COPY.ur).filter((s) => s !== COPY.ur.lang);
    for (const s of ur) expect(s).toMatch(/[؀-ۿ]/);
  });

  it("Latin names and number pairs are isolated inside Urdu text", () => {
    expect(COPY.ur.teacher("Saima Testwala")).toBe("ٹیچر: ⁨Saima Testwala⁩");
    expect(COPY.ur.handover("Ayan")).toContain("⁨Ayan⁩");
    expect(COPY.ur.childrenDone(2, 5)).toContain("⁦2/5⁩");
    expect(COPY.ur.aboutMinutes(29)).toContain("⁦29⁩");
  });

  it("block names", () => {
    expect(COPY.en.blocks).toEqual({ B1: "Urdu reading", B2: "English reading", B3: "Listening", B4: "Maths: numbers", B5: "Maths: sums", full: "Whole battery" });
    expect(COPY.ur.blocks.B1).toBe("اردو پڑھنا");
    expect(COPY.ur.blocks.full).toBe("مکمل جائزہ");
  });

  it("no roll number anywhere", () => {
    for (const lang of ["ur", "en"] as const) {
      const all = strings(COPY[lang] as unknown as Record<string, unknown>).join("\n");
      expect(all).not.toMatch(/\broll\b/i);
      expect(all).not.toMatch(/رول/);
    }
  });

  it("no gendered words for the coach or the child", () => {
    const en = strings(COPY.en).join("\n");
    expect(en).not.toMatch(/\b(he|she|him|her|his|hers)\b/i);
    const ur = strings(COPY.ur).join("\n");
    for (const w of ["چاہتا", "چاہتی", " سکا", " سکی", "کرتا ", "کرتی ", "وہ ", "اس نے"]) expect(ur).not.toContain(w);
  });

  it("buttons stay short (≤ 24 code points)", () => {
    for (const lang of ["ur", "en"] as const) {
      const c = COPY[lang];
      for (const b of [c.present, c.absent, c.refused, c.start, c.holdEnd, c.wholeBattery, c.endVisit, c.finish, c.tryAgain, c.continue]) {
        expect([...b].length).toBeLessThanOrEqual(24);
      }
    }
  });
});
