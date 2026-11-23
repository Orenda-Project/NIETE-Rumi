import { describe, it, expect } from "vitest";
import CASES from "../../../../tests/fixtures/school-search-cases.json";
import { schoolMatchRank, searchSchools, searchText } from "./schoolSearch";
import { searchSchools as analyticsSearch } from "../analytics/table";

/**
 * bd-bfagiy (queue #232) — the portal page's copy of the school search rule. The server's copy
 * (bot/shared/utils/school-search.js) runs the same case table in tests/portal/bd-bfagiy-school-search.test.js.
 */
type Row = { id: string; name: string; emis: string | null };
const schools = CASES.schools as Row[];
const fieldsOf = (s: Row) => ({ names: [s.name], codes: [s.emis] });

describe("school search: spaces, punctuation and capitals do not matter", () => {
  it.each(CASES.cases.map((c) => [c.q, c.ids, c.why] as const))("%j finds %j (%s)", (q, ids) => {
    expect(searchSchools(schools, q, fieldsOf).map((s) => s.id)).toEqual(ids);
  });

  it("the text it compares", () => {
    expect(searchText("IMSG (I-V) I-10/3")).toBe("imsgivi103");
    expect(searchText(undefined)).toBe("");
  });

  it("rank: exact, start, inside, words apart", () => {
    const f = { names: ["IMSG (I-V) I-10/3"], codes: ["612"] };
    expect([schoolMatchRank(f, "612"), schoolMatchRank(f, "imsg"), schoolMatchRank(f, "i-10/3"), schoolMatchRank(f, "i10 imsg"), schoolMatchRank(f, "g-10")])
      .toEqual([0, 1, 2, 3, null]);
  });
});

describe("the analytics schools list uses it", () => {
  const row = (name: string, emis: string | null) => ({ name, emis, region: "Urban-I" }) as never;
  const list = [row("IMSG (I-V) I-10/3", "612"), row("IMCB G-10/3", "1033")];
  it.each(["i103", "I 10 3", "i-10/3", "IMSG I10"])("%j finds IMSG (I-V) I-10/3", (q) => {
    expect(analyticsSearch(list, q).map((s: { name: string }) => s.name)).toContain("IMSG (I-V) I-10/3");
  });
});
