/** bd-sex15q.34 — what index.html asked for at boot is taken once, then gone. */
import { takeBoot } from "./bootReads";

describe("takeBoot", () => {
  afterEach(() => { delete (window as { __nieteBoot?: unknown }).__nieteBoot; });

  it("hands over the boot read once", async () => {
    (window as { __nieteBoot?: unknown }).__nieteBoot = { config: Promise.resolve({ a: 1 }) };
    expect(await takeBoot("config")).toEqual({ a: 1 });
    expect(takeBoot("config")).toBeNull();
  });

  it("nothing at boot: null", () => {
    expect(takeBoot("me")).toBeNull();
  });
});
