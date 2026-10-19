import { describe, it, expect } from "vitest";
import type { LiveCard } from "../../services/api";
import raw from "../../../../../tests/coaching/live-moves/fixtures/g4_english_ch12_seg1.card.json";
import { initState, applyTicks, applyTap, nowIndex, untickedIdx, toRecord } from "./liveMovesState";

// bd-v0toag.31 — what the live screen shows while she records: ✓ done / ▶ now / ○ to come.
// Ticks only ever add; her taps never change a tick; `now` follows her ticks, and the clock when ticks stall.

type RawCard = { sections: { sec: string; minutes: number; moves: { covers?: string[]; chip?: string; do: string; say: string }[] }[] };

// The same flattening the bot's card-store serves (hw dropped, idx numbered across sections).
function cardFrom(c: RawCard): LiveCard {
  let idx = 0;
  return {
    lessonId: "L-g4-ch12", stamp: "s1",
    sections: c.sections.filter((s) => s.sec !== "hw").map((s) => ({
      sec: s.sec, minutes: s.minutes,
      moves: s.moves.map((m) => ({ idx: idx++, covers: m.covers || [], chip: m.chip || "", do: m.do, say: m.say })),
    })),
  };
}

const CARD = cardFrom(raw as RawCard);
const MIN = 60_000;
const allIdx = () => CARD.sections.flatMap((s) => s.moves.map((m) => m.idx));

describe("liveMovesState", () => {
  it("fixture: open 0-1, explain 2, we 3-4", () => {
    expect(CARD.sections.map((s) => [s.sec, s.minutes, s.moves.map((m) => m.idx)]).slice(0, 3))
      .toEqual([["open", 5, [0, 1]], ["explain", 8, [2]], ["we", 12, [3, 4]]]);
  });

  it("initState: every move unticked, no taps", () => {
    const s = initState(CARD);
    expect(s.moves[3]).toEqual({
      idx: 3, sec: "we", chip: "I START, YOU FINISH", do: CARD.sections[2].moves[0].do,
      say: CARD.sections[2].moves[0].say, covers: ["m6"], ticked: false, tickedAtMs: null, lastTap: null,
    });
    expect(untickedIdx(s)).toEqual(allIdx());
    expect(s.taps).toEqual([]);
  });

  it("ticks never untick", () => {
    let s = applyTicks(initState(CARD), [0, 1], 60_000);
    s = applyTicks(s, [], 120_000);
    s = applyTicks(s, [1, 2], 180_000);
    expect(s.moves.filter((m) => m.ticked).map((m) => m.idx)).toEqual([0, 1, 2]);
    expect(s.moves[1].tickedAtMs).toBe(60_000);               // the first tick time stays
    expect(s.moves[2].tickedAtMs).toBe(180_000);
    expect(untickedIdx(s)).toEqual(allIdx().filter((i) => i > 2));
  });

  it("ticks for unknown moves are ignored; state is not mutated", () => {
    const s0 = initState(CARD);
    const s1 = applyTicks(s0, [99, -1], 1_000);
    expect(untickedIdx(s1)).toEqual(allIdx());
    applyTicks(s0, [0], 1_000);
    expect(s0.moves[0].ticked).toBe(false);
  });

  it("now = first unticked after last tick", () => {
    expect(nowIndex(initState(CARD), 0)).toBe(0);
    let s = applyTicks(initState(CARD), [0], 2 * MIN);
    expect(nowIndex(s, 3 * MIN)).toBe(1);
    s = applyTicks(s, [2], 4 * MIN);                            // she skipped move 1
    expect(nowIndex(s, 5 * MIN)).toBe(3);
  });

  it("now follows clock when no tick for longer than section minutes", () => {
    // g4 ch12: open 5 + explain 8 = 13 min; at 18:00 the clock puts her in We Do.
    expect(nowIndex(initState(CARD), 18 * MIN)).toBe(3);
    // Exactly at the section's minutes is not yet stale.
    expect(nowIndex(initState(CARD), 5 * MIN)).toBe(0);
    expect(nowIndex(initState(CARD), 5 * MIN + 1)).toBe(2);
    // A recent tick holds `now` on her place, not the clock.
    const s = applyTicks(initState(CARD), [0], 16 * MIN);
    expect(nowIndex(s, 18 * MIN)).toBe(1);
  });

  it("clock past the whole lesson → first unticked of the last section", () => {
    const last = CARD.sections[CARD.sections.length - 1].moves[0].idx;
    expect(nowIndex(initState(CARD), 120 * MIN)).toBe(last);
  });

  it("clock never pulls now back behind her ticks", () => {
    const s = applyTicks(initState(CARD), [0, 1, 2, 3, 4], 1 * MIN);   // she ticked through We Do fast
    expect(nowIndex(s, 15 * MIN)).toBe(5);                             // clock says We Do; now stays at 5
  });

  it("clock section all ticked → the next unticked after it", () => {
    const s = applyTicks(initState(CARD), [3, 4], 0);
    expect(nowIndex(s, 20 * MIN)).toBe(5);
  });

  it("now null when all ticked", () => {
    expect(nowIndex(applyTicks(initState(CARD), allIdx(), MIN), 2 * MIN)).toBeNull();
    expect(untickedIdx(applyTicks(initState(CARD), allIdx(), MIN))).toEqual([]);
  });

  it("tap on ticked records live_state ticked", () => {
    const s0 = applyTicks(initState(CARD), [0], MIN);
    const a = applyTap(s0, 0, "did_not", "2026-10-19T09:00:00.000Z");
    expect(a.tap).toEqual({ idx: 0, choice: "did_not", at: "2026-10-19T09:00:00.000Z", live_state: "ticked" });
    expect(a.state.moves[0]).toMatchObject({ ticked: true, lastTap: "did_not" });   // a tap never unticks
    const b = applyTap(a.state, 1, "did", "2026-10-19T09:01:00.000Z");
    expect(b.tap.live_state).toBe("unticked");
    expect(b.state.moves[1]).toMatchObject({ ticked: false, lastTap: "did" });      // nor ticks
    expect(b.state.taps).toEqual([a.tap, b.tap]);
    expect(s0.taps).toEqual([]);
  });

  it("toRecord carries covers", () => {
    let s = applyTicks(initState(CARD), [1], 90_000);
    s = applyTap(s, 2, "did", "2026-10-19T09:02:00.000Z").state;
    const r = toRecord(s, { liveId: "live-1", drops: 2, bytesSent: 4096 });
    expect(r).toMatchObject({ lessonId: "L-g4-ch12", stamp: "s1", liveId: "live-1", drops: 2, bytesSent: 4096 });
    expect(r.moves.slice(0, 3)).toEqual([
      { idx: 0, covers: ["m4"], tickedAtMs: null },
      { idx: 1, covers: ["m1", "m2"], tickedAtMs: 90_000 },
      { idx: 2, covers: ["m3", "m5"], tickedAtMs: null },
    ]);
    expect(r.taps).toEqual([{ idx: 2, choice: "did", at: "2026-10-19T09:02:00.000Z", live_state: "unticked" }]);
  });
});
