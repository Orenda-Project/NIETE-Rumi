/** bd-sex15q.34 — what index.html asked for at boot is taken once, then gone. */
import { peekBoot, takeBoot } from "./bootReads";

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

/** bd-1q4z4o — the teacher Home draws its final layout at once when index.html's /me/home read has ALREADY answered. */
describe("peekBoot", () => {
  afterEach(() => { delete (window as { __nieteBoot?: unknown }).__nieteBoot; });

  it("an answer that has arrived: its value now, synchronously, without taking the read", async () => {
    const read = Promise.resolve({ success: true });
    (window as { __nieteBoot?: unknown }).__nieteBoot = { home: read, done: { home: { success: true } } };
    expect(peekBoot("home")).toEqual({ success: true });
    expect(await takeBoot("home")).toEqual({ success: true });
    // taken means gone: Home opened again later in the visit reads afresh
    expect(peekBoot("home")).toBeNull();
  });

  it("still on its way, or nothing at boot: null", () => {
    (window as { __nieteBoot?: unknown }).__nieteBoot = { home: new Promise(() => {}), done: {} };
    expect(peekBoot("home")).toBeNull();
    delete (window as { __nieteBoot?: unknown }).__nieteBoot;
    expect(peekBoot("home")).toBeNull();
  });
});
