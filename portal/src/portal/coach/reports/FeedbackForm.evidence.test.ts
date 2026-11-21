import { describe, it, expect, vi, afterEach } from "vitest";
import api, { leader } from "../../services/api";
import type { V6Indicator } from "../../services/api";
import {
  addRow, clockSeconds, editRow, evText, heldV7, initialReview, keepV7, normClock, removeRow, reviewOut, sameReview, setSummary, shownRows,
} from "./evidenceReview";

/**
 * bd-o15qnr.31 — the evidence review's model (evidenceReview.ts) and its contract with the server: what ev_<code> holds
 * (today's one text) and what `evidence_review` is, and the draft POST that carries it only when there is one.
 */
afterEach(() => vi.restoreAllMocks());

const IND = (extra: Partial<Extract<V6Indicator, { kind: "dc" }>> = {}): V6Indicator => ({
  id: "C1", field: "C1", name: "Questions", kind: "dc", options: [], rumi: "3", rating: "3", evidence: "server text", improvement: "",
  rumiEvidence: { because: "Mostly closed questions.", items: [{ time: "04:30", quote: "اب ہم کیا کریں گے؟" }, { time: "12:15", quote: "Why?" }, { time: null, quote: "No time here" }] },
  ...extra,
});

describe("the review an indicator starts from", () => {
  it("the assistant's list as it came: every quote kept, the summary its line", () => {
    const r = initialReview(IND())!;
    expect(r.summary).toBe("Mostly closed questions.");
    expect(r.rows.map((x) => (x.source === "rumi" ? [x.time, x.status] : null))).toEqual([["04:30", "kept"], ["12:15", "kept"], [null, "kept"]]);
  });

  it("none without the assistant's list (an older bot), and none for one of the six", () => {
    expect(initialReview(IND({ rumiEvidence: undefined }))).toBeNull();
    expect(initialReview({ id: "C3", field: "C3", name: "x", kind: "combined", options: [], body: "", rating: "", why: "" })).toBeNull();
  });
});

describe("ev_<code>: today's one text", () => {
  it("summary · MM:SS \"quote\" for each kept or edited quote · MM:SS the coach's line; removed quotes left out", () => {
    let r = initialReview(IND())!;
    r = removeRow(r, r.rows[1].key);
    r = editRow(r, r.rows[2].key, "No time, edited");
    r = addRow(r, "The teacher praised two answers by name.", "21:05");
    r = addRow(r, "A line with no time.", null);
    r = setSummary(r, "Closed questions, one open.");
    expect(evText(r)).toBe('Closed questions, one open. · 04:30 "اب ہم کیا کریں گے؟" · "No time, edited" · 21:05 The teacher praised two answers by name. · A line with no time.');
    expect(shownRows(r)).toHaveLength(4);
  });

  it("the evidence_review sent beside it", () => {
    let r = initialReview(IND())!;
    r = removeRow(r, r.rows[1].key);
    r = editRow(r, r.rows[2].key, "edited");
    r = addRow(r, "Mine.", "21:05");
    expect(reviewOut(r)).toEqual({
      summary: { rumi: "Mostly closed questions.", coach: "Mostly closed questions." },
      items: [
        { source: "rumi", time: "04:30", quote: "اب ہم کیا کریں گے؟", status: "kept" },
        { source: "rumi", time: "12:15", quote: "Why?", status: "removed" },
        { source: "rumi", time: null, quote: "No time here", status: "edited", coach_text: "edited" },
        { source: "coach", time: "21:05", text: "Mine." },
      ],
    });
  });

  it("an Undo, or an edit typed back, is no change at all", () => {
    const start = initialReview(IND())!;
    const edited = editRow(start, start.rows[0].key, "different");
    expect(sameReview(start, edited)).toBe(false);
    expect(sameReview(start, editRow(edited, start.rows[0].key, start.rows[0].source === "rumi" ? start.rows[0].quote : ""))).toBe(true);
    const mine = addRow(start, "Mine.", null);
    expect(sameReview(start, removeRow(mine, mine.rows[3].key))).toBe(true);
  });

  it("a row emptied by an edit is a row removed (the server keeps an edited row only with words)", () => {
    const start = initialReview(IND())!;
    const r = editRow(start, start.rows[0].key, "   ");
    expect(reviewOut(r).items[0]).toEqual({ source: "rumi", time: "04:30", quote: "اب ہم کیا کریں گے؟", status: "removed" });
    const mine = addRow(start, "Mine.", null);
    expect(editRow(mine, mine.rows[3].key, "").rows).toHaveLength(3);
  });

  it("a review saved before comes back with each row's status", () => {
    const r = initialReview(IND({
      evidenceReview: {
        summary: { rumi: "Mostly closed questions.", coach: "Mine" },
        items: [{ source: "rumi", time: "04:30", quote: "q", status: "edited", coach_text: "q2" }, { source: "coach", time: null, text: "own" }],
      },
    }))!;
    expect(r.summary).toBe("Mine");
    expect(evText(r)).toBe('Mine · 04:30 "q2" · own');
  });
});

describe("the lesson clock", () => {
  it("reads MM:SS and H:MM:SS", () => {
    expect(clockSeconds("04:30")).toBe(270);
    expect(clockSeconds("1:02:05")).toBe(3725);
    expect(clockSeconds("4:3")).toBeNull();
    expect(clockSeconds(null)).toBeNull();
  });
  it("takes a typed time as mm:ss (Urdu digits too), or refuses it", () => {
    expect(normClock("21:05")).toBe("21:05");
    expect(normClock("5:07")).toBe("05:07");
    expect(normClock("۲۱:۰۵")).toBe("21:05");
    expect(normClock("2105")).toBeNull();
    expect(normClock("21:75")).toBeNull();
  });
});

describe("kept on this phone", () => {
  it("the checked indicators and the reviews come back after a reload", () => {
    localStorage.clear();
    const r = addRow(initialReview(IND())!, "Mine.", "01:00");
    keepV7("cs-9", ["C1", "F1"], { C1: r });
    const k = heldV7("cs-9")!;
    expect(k.checked).toEqual(["C1", "F1"]);
    expect(evText(k.reviews.C1)).toBe(evText(r));
  });
});

describe("the draft POST", () => {
  it("evidence_review only when there is one: an older server sees today's body", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { success: true } });
    await leader.saveObservationDraft("cs-1", { r_C1: "3" });
    expect(post).toHaveBeenLastCalledWith("/leader/observe/cs-1/draft", { edits: { r_C1: "3" } });
    await leader.saveObservationDraft("cs-1", { r_C1: "3" }, {});
    expect(post).toHaveBeenLastCalledWith("/leader/observe/cs-1/draft", { edits: { r_C1: "3" } });
    const review = { C1: { summary: { rumi: "a", coach: "b" }, items: [] } };
    await leader.saveObservationDraft("cs-1", { r_C1: "3" }, review);
    expect(post).toHaveBeenLastCalledWith("/leader/observe/cs-1/draft", { edits: { r_C1: "3" }, evidence_review: review });
  });

  it("the FDE/FICO-S save takes it the same way (its submit too)", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    await leader.saveObs612Form("cs-2", { a: "1" }, true);
    expect(post).toHaveBeenLastCalledWith("/leader/observe/cs-2/draft", { edits: { a: "1" }, submit: true });
    const review = { C1: { summary: { rumi: "a", coach: "a" }, items: [] } };
    await leader.saveObs612Form("cs-2", { a: "1" }, false, review);
    expect(post).toHaveBeenLastCalledWith("/leader/observe/cs-2/draft", { edits: { a: "1" }, evidence_review: review });
  });
});
