import { describe, it, expect } from "vitest";
import { COPY } from "./copy";

// bd-s1oo0.7 — Urdu first, English beside it; neither may be missing a key, and
// no Urdu string may use a gendered form for the coach, teacher or child.

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

describe("child-test copy", () => {
  it("no roll number anywhere (L25, operator 3 Oct): no roll key, no 'Roll'/«رول» in any string", () => {
    for (const lang of ["ur", "en"] as const) {
      expect(COPY[lang]).not.toHaveProperty("roll");
      const all = strings(COPY[lang] as unknown as Record<string, unknown>).join("\n");
      expect(all).not.toMatch(/\broll\b/i);
      expect(all).not.toMatch(/رول/);
    }
  });

  it("the child's room line: class label and class teacher, and the same-name hints (L25)", () => {
    expect(COPY.en.teacher("Saima Bibi")).toBe("Teacher: Saima Bibi");
    expect(COPY.ur.teacher("Saima Bibi")).toBe("ٹیچر: \u2068Saima Bibi\u2069");
    expect(COPY.en.father("Ahmed Raza")).toBe("father: Ahmed Raza");
    expect(COPY.en.inThisClass(2)).toBe("2 in this class");
  });

  it("Urdu and English carry the same keys, of the same kind", () => {
    expect(shape(COPY.ur).sort()).toEqual(shape(COPY.en).sort());
  });

  it("Urdu strings are in Urdu (every one has Arabic-script text, bar the language switch)", () => {
    const ur = strings(COPY.ur).filter((s) => s !== COPY.ur.lang);
    for (const s of ur) expect(s).toMatch(/[؀-ۿ]/);
  });

  it("no gendered verb endings for a person in Urdu (چاہتا/چاہتی, سکا/سکی, گیا ہے for a child…)", () => {
    const ur = strings(COPY.ur).join("\n");
    for (const w of ["چاہتا", "چاہتی", " سکا", " سکی", "کرتا ", "کرتی ", "وہ ", "اس نے"]) expect(ur).not.toContain(w);
  });

  it("buttons stay short enough for a phone (≤ 24 code points)", () => {
    for (const lang of ["ur", "en"] as const) {
      const c = COPY[lang];
      for (const b of [c.start, c.stop, c.send, c.next, c.listen, c.recordAgain, c.takePhoto, c.retakePhoto, c.childFinished, c.cantRead, c.startSums, c.present, c.absent, c.refused, c.saveCheck, c.check]) {
        expect([...b].length).toBeLessThanOrEqual(24);
      }
    }
  });
});
