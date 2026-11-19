import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

/**
 * The survey bar at the end of a grades 1-5 plan (spec §1). Built from the kit: a CARD, RatingScale (2 in a row, then 3
 * stacked) with lucide icons, StatusChip for Thanks / Not saved / No internet, TextLine for What was wrong.
 *
 *   no answer yet           → This plan: Useful · Not useful
 *   Useful saved            → In class: Taught it today · Planning to · Not yet → Thanks
 *   Not useful saved        → Thanks at once, and What was wrong (Send only once it has words) → the box goes, Thanks stays
 *   answered earlier        → no bar; Useful earlier with no In class → straight at In class
 *   a failed save           → the state before the tap, Not saved + Try again (re-sends the same tap, once)
 *   no connection           → No internet + Try again
 *   the switch off (404)    → the bar goes
 * Every word from feedbackCopy.ts, English and Urdu. No spinner in any state.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/useNewUi", () => ({ readConfigShared: vi.fn() }));
import api from "../../services/api";
import { readConfigShared } from "../../lib/useNewUi";
import { tapProblems } from "../../newui/checks/rules";
import { FeedbackBar } from "./FeedbackBar";
import { fetchPlanFeedback, savePlanFeedback, useLpFeedbackBar } from "./feedbackApi";
import { FEEDBACK_COPY as C, FEEDBACK } from "./feedbackCopy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PLAN = { kind: "k5" as const, ref: "grade_1_english_ch1_seg3" };
const state = (feedback: unknown) => http.get.mockResolvedValue({ data: { success: true, feedback } });
const saved = (feedback: unknown, outcome = "saved") => ({ data: { success: true, outcome, feedback } });
const radio = (name: string) => screen.getByRole("radio", { name });

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("feedbackApi", () => {
  it("asks whether she answered, for the plan only; anything but a clean answer is 'off'", async () => {
    state(null);
    expect(await fetchPlanFeedback(PLAN)).toBeNull();
    expect(http.get).toHaveBeenCalledWith("/lp/feedback", expect.objectContaining({ params: PLAN }));
    state({ useful: true, usedInClass: null });
    expect(await fetchPlanFeedback(PLAN)).toEqual({ useful: true, usedInClass: null });
    http.get.mockRejectedValue({ response: { status: 404 } });
    expect(await fetchPlanFeedback(PLAN)).toBe("off");
  });

  it("saves the plan and the answer, with a 10 s limit; 404 is gone, a dropped connection offline", async () => {
    http.post.mockResolvedValue(saved({ useful: true, usedInClass: null }));
    expect(await savePlanFeedback(PLAN, { useful: true })).toEqual({ ok: true, feedback: { useful: true, usedInClass: null } });
    expect(http.post).toHaveBeenCalledWith("/lp/feedback", { ...PLAN, useful: true }, { timeout: 10000 });
    http.post.mockRejectedValue({ response: { status: 404 } });
    expect(await savePlanFeedback(PLAN, { useful: true })).toEqual({ ok: false, reason: "gone" });
    http.post.mockRejectedValue({ code: "ERR_NETWORK" });
    expect(await savePlanFeedback(PLAN, { useful: true })).toEqual({ ok: false, reason: "offline" });
    http.post.mockRejectedValue({ code: "ECONNABORTED" });
    expect(await savePlanFeedback(PLAN, { useful: true })).toEqual({ ok: false, reason: "failed" });
  });

  it("the switch is the /config feature, true only for a real true", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { lpFeedbackBar: true } } as never);
    function Probe() { const on = useLpFeedbackBar(); return <i data-testid="on">{String(on)}</i>; }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("on").textContent).toBe("true"));
    cleanup();
    vi.mocked(readConfigShared).mockResolvedValue({ features: { lpFeedbackBar: "yes" } } as never);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("on").textContent).toBe("false"));
  });
});

describe("FeedbackBar", () => {
  it("no answer yet: This plan with Useful and Not useful, 56px taps, lucide icons, no spinner", async () => {
    state(null);
    const { container } = render(<FeedbackBar plan={PLAN} />);
    await screen.findByText(C.thisPlan);
    expect(radio(C.useful).querySelector("svg")).not.toBeNull();
    expect(radio(C.notUseful)).toBeTruthy();
    expect(tapProblems(container)).toEqual([]);
    expect(container.querySelector(".animate-spin, [role='progressbar']")).toBeNull();
  });

  it("Useful → saving (picked, the other off, aria-busy) → In class → Thanks; one row, then the same row", async () => {
    state(null);
    let resolve!: (v: unknown) => void;
    http.post.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<FeedbackBar plan={PLAN} />);
    fireEvent.click(await screen.findByRole("radio", { name: C.useful }));
    expect(radio(C.useful)).toHaveAttribute("aria-checked", "true");
    expect((radio(C.notUseful) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("lp-feedback")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(radio(C.useful)); // a second tap while saving is ignored
    expect(http.post).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(saved({ useful: true, usedInClass: null })); });
    expect(http.post).toHaveBeenLastCalledWith("/lp/feedback", { ...PLAN, useful: true }, expect.anything());

    await screen.findByText(C.inClass);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([C.taught, C.planned, C.notYet]);
    http.post.mockResolvedValueOnce(saved({ useful: true, usedInClass: "taught" }));
    fireEvent.click(radio(C.taught));
    await screen.findByText(C.thanks);
    expect(http.post).toHaveBeenLastCalledWith("/lp/feedback", { ...PLAN, usedInClass: "taught" }, expect.anything());
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("Not useful → Thanks at once and What was wrong; Send only with words; sent → the box goes, Thanks stays", async () => {
    state(null);
    http.post.mockResolvedValueOnce(saved({ useful: false, usedInClass: null }));
    render(<FeedbackBar plan={PLAN} />);
    fireEvent.click(await screen.findByRole("radio", { name: C.notUseful }));
    await screen.findByText(C.thanks);
    const box = screen.getByRole("textbox", { name: C.whatWrong }) as HTMLInputElement;
    expect(box.maxLength).toBe(280);
    expect(screen.queryByRole("button", { name: C.send })).toBeNull();
    fireEvent.change(box, { target: { value: "the activity was too long" } });
    http.post.mockResolvedValueOnce(saved({ useful: false, usedInClass: null }));
    fireEvent.click(screen.getByRole("button", { name: C.send }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(http.post).toHaveBeenLastCalledWith("/lp/feedback", { ...PLAN, reasonText: "the activity was too long" }, expect.anything());
    expect(screen.getByText(C.thanks)).toBeTruthy();
  });

  it("answered earlier: no bar; Useful earlier with no In class opens straight at In class", async () => {
    state({ useful: true, usedInClass: "planned" });
    const { container } = render(<FeedbackBar plan={PLAN} />);
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
    cleanup();
    state({ useful: false, usedInClass: null });
    const second = render(<FeedbackBar plan={PLAN} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(second.container.innerHTML).toBe("");
    cleanup();
    state({ useful: true, usedInClass: null });
    render(<FeedbackBar plan={PLAN} />);
    await screen.findByText(C.inClass);
  });

  it("the state cannot be read, or the switch is off: no bar", async () => {
    http.get.mockRejectedValue(new Error("down"));
    const { container } = render(<FeedbackBar plan={PLAN} />);
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });

  it("a failed save: the state before the tap, Not saved + Try again, which re-sends the same tap once", async () => {
    state(null);
    http.post.mockRejectedValueOnce({ response: { status: 502 } });
    render(<FeedbackBar plan={PLAN} />);
    fireEvent.click(await screen.findByRole("radio", { name: C.useful }));
    await screen.findByText(C.notSaved);
    expect(radio(C.useful)).toHaveAttribute("aria-checked", "false");
    expect((radio(C.notUseful) as HTMLButtonElement).disabled).toBe(false);
    http.post.mockResolvedValueOnce(saved({ useful: true, usedInClass: null }));
    fireEvent.click(screen.getByRole("button", { name: C.tryAgain }));
    await screen.findByText(C.inClass);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post.mock.calls[1][1]).toEqual({ ...PLAN, useful: true });
    expect(screen.queryByText(C.notSaved)).toBeNull();
  });

  it("no connection: No internet + Try again, nothing sent", async () => {
    state(null);
    render(<FeedbackBar plan={PLAN} />);
    const useful = await screen.findByRole("radio", { name: C.useful });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    fireEvent.click(useful);
    await screen.findByText(C.noInternet);
    expect(screen.getByRole("button", { name: C.tryAgain })).toBeTruthy();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("the switch went off on the server (404): the bar goes", async () => {
    state(null);
    http.post.mockRejectedValueOnce({ response: { status: 404 } });
    const { container } = render(<FeedbackBar plan={PLAN} />);
    fireEvent.click(await screen.findByRole("radio", { name: C.useful }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("in Urdu every word is the Urdu one", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    state(null);
    render(<FeedbackBar plan={PLAN} />);
    await screen.findByText(FEEDBACK.ur.thisPlan);
    expect(radio(FEEDBACK.ur.useful)).toBeTruthy();
    expect(radio(FEEDBACK.ur.notUseful)).toBeTruthy();
    http.post.mockResolvedValueOnce(saved({ useful: true, usedInClass: null }));
    fireEvent.click(radio(FEEDBACK.ur.useful));
    await screen.findByText(FEEDBACK.ur.inClass);
    expect(radio(FEEDBACK.ur.taught)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
  });
});
