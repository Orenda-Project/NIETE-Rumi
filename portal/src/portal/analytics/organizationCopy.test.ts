import { describe, it, expect } from "vitest";
import { analyticsCopy, type AnalyticsWords } from "./copy";

/**
 * Whose words: the page is FDE's (ICT, six sectors, the RDF's lists) and also Moawin's (Gilgit-Baltistan), whose
 * view counts its own region's schools and roster. A Moawin head-office reader must never be told about FDE's list,
 * Islamabad, the six ICT sectors or the RDF; FDE's words stay exactly as they are.
 */
const SIX = ["B.K", "Sihala", "Urban-I", "Nilore", "Urban-II", "Tarnol"];
const GB = { organization: "moawin", regions: ["Gilgit-Baltistan"] };

/** Every word the page can show: strings, and what each word-making function says for sample arguments. */
function allWords(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (typeof node === "function") {
    const said = (node as (...a: string[]) => unknown)("12", "34", "56");
    if (typeof said === "string") out.push(said);
  } else if (Array.isArray(node)) node.forEach((n) => allWords(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => allWords(n, out));
  return out;
}

describe("analyticsCopy(lang, scope)", () => {
  it("FDE's view (niete, or no scope yet given) is the words as they are", () => {
    const plain = analyticsCopy("en");
    expect(analyticsCopy("en", { organization: "niete", regions: SIX })).toEqual(plain);
    expect(analyticsCopy("en", null)).toEqual(plain);
    expect(plain.lede).toMatch(/Islamabad/);
  });

  it("a Moawin view never names FDE, Islamabad, ICT, the six sectors or the RDF", () => {
    const words = allWords(analyticsCopy("en", GB));
    const bad = words.filter((w) => /FDE|Islamabad|\bICT\b|\bRDF\b|Routine Data Flow|the six|out of six|B\.K|Sihala|Tarnol|Nilore|Urban-I/.test(w));
    expect(bad).toEqual([]);
  });

  it("it says whose schools these are: Gilgit-Baltistan's, from the scope's own regions", () => {
    const c = analyticsCopy("en", GB);
    expect(c.lede).toMatch(/Gilgit-Baltistan/);
    expect(c.trainingLevels.population.primary("141")).toMatch(/^141 .*Gilgit-Baltistan/);
    const other = analyticsCopy("en", { organization: "moawin", regions: ["Hunza", "Skardu"] });
    expect(other.lede).toMatch(/Hunza and Skardu/);
  });

  it("a region, not a sector: the headings a Moawin reader sees", () => {
    const c: AnalyticsWords = analyticsCopy("en", GB);
    const headings = [
      c.sections.sectors, c.sections.lpChart, c.sections.trainingChart, c.sections.obsChart, c.sections.obsSectors,
      c.sections.coachingSectors, c.lpEngagement.sections.sectors, c.lpEngagement.cards.chartHint,
      c.lpEngagement.tiles.activeSectors, c.lpEngagement.hints.activeSectors, c.obsV7.chart.human, c.obsV7.chart.dc,
      c.obsV7.sectors, c.obsV7.tiles.sectorsActive.human, c.obsV7.tiles.sectorsActive.dc, c.coachingV7.byRegion,
      c.trainingLevels.sections.chart, c.trainingLevels.sections.sectors, c.trainingLevels.partners.perSector, c.trainingLevels.partners.columns.sector,
    ];
    for (const h of headings) expect([h, /sector/i.test(h)]).toEqual([h, false]);
  });

  it("the Information tab explains the Moawin view's own rules: its roster, the grades rule, FMOs", () => {
    const text = analyticsCopy("en", GB).how.groups.flatMap((g) => g.items.map((i) => `${i.term}: ${i.text}`)).join("\n");
    expect(text).toMatch(/registration/);
    expect(text).toMatch(/Primary/);
    expect(text).toMatch(/FMO/);
  });
});
