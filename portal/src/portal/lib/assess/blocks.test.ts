import { describe, it, expect } from "vitest";
import { BLOCKS, pickBlock, startIndex } from "./blocks";

// One block per child, chosen on the phone: the day's start block (PKT day,
// rotating through B1..B5), skipping blocks other children of this visit
// already have; "full" when the coach turns on the whole battery.

const DAY = 24 * 60 * 60 * 1000;
const FIVE_H = 5 * 60 * 60 * 1000;
// PKT midnight of PKT day number k (days since the epoch, Pakistan time).
const pktDay = (k: number) => k * DAY - FIVE_H;

describe("blocks", () => {
  it("five blocks, in order", () => {
    expect(BLOCKS).toEqual(["B1", "B2", "B3", "B4", "B5"]);
  });

  it("the start block moves by one each Pakistan day", () => {
    expect(startIndex(pktDay(10))).toBe(0);
    expect(startIndex(pktDay(10) + DAY - 1)).toBe(0);
    expect(startIndex(pktDay(11))).toBe(1);
    expect(startIndex(pktDay(14))).toBe(4);
    expect(startIndex(pktDay(15))).toBe(0);
    // 23:00 UTC is already the next day in Pakistan
    expect(startIndex(Date.UTC(2026, 9, 20, 23))).toBe(startIndex(Date.UTC(2026, 9, 21, 12)));
  });

  it("the first child gets the day's start block", () => {
    expect(pickBlock([], { now: pktDay(10) })).toBe("B1");
    expect(pickBlock([], { now: pktDay(12) })).toBe("B3");
  });

  it("skips blocks already used on this visit, wrapping round", () => {
    expect(pickBlock(["B3"], { now: pktDay(12) })).toBe("B4");
    expect(pickBlock(["B4", "B5"], { now: pktDay(13) })).toBe("B1");
    expect(pickBlock(["B1", "B2", "B4"], { now: pktDay(10) })).toBe("B3");
  });

  it("ignores 'full' and unknown values among the used", () => {
    expect(pickBlock(["full", "x"], { now: pktDay(10) })).toBe("B1");
  });

  it("all five used: the least used, from the start block", () => {
    expect(pickBlock(["B1", "B2", "B3", "B4", "B5"], { now: pktDay(11) })).toBe("B2");
    expect(pickBlock(["B1", "B2", "B3", "B4", "B5", "B2", "B3"], { now: pktDay(11) })).toBe("B4");
  });

  it("whole battery gives 'full'", () => {
    expect(pickBlock(["B1"], { now: pktDay(10), full: true })).toBe("full");
  });
});
