import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { savePlan: vi.fn(), suggestion: vi.fn(), clipUrl: () => "/clip" },
}));
import { disagreements, type Card, type Plan } from "./api";
import { ClipProvider } from "./cardParts";
import { CoachingBox } from "./CoachingBox";

/**
 * bd-tbprit.11 — Rifat's "💡 Coaching suggestion", with Amena's four answers (20 Oct):
 *   the disclaimer, then 1 listen, 2 what did you find (four answers), 3 the suggested way (★, with why; any way can
 *   be tapped), 4 what to do. The template shows at once and the AI-tailored version replaces it when it arrives;
 *   a failed AI keeps the template. "The teacher was right" flags the report for the DC team, with Undo.
 *   A message is a wa.me link with the edited Urdu text. A visit can be added to her next visit.
 */
const D = vi.mocked(disagreements);
const AI = {
  msg: "{name} جی، یہ AI کا پیغام ہے۔", qs: ["AI q1", "AI q2", "AI q3"], stuck: ["AI s1", "AI s2"],
  agree: "AI agree", check: "AI check", visit: ["AI v1", "AI v2", "AI v3"],
};
const card = (extra: Partial<Card> = {}) => ({
  id: "r1", teacher: "Sadia Bibi", nth: 1, language: "en", phone: "923001234567", plan: null, durationSec: 2400,
  moves: null, evidence: [],
  pattern: {
    points: [], avg: null, best: null, now: null, count: 5, perWeek: 1.6, level: "steady", ictAvg: 1.52,
    firstDate: null, lastDate: null, missed: { step: "We Do", n: 1, of: 5 }, earlier: 0,
  },
  ...extra,
}) as unknown as Card;
const show = (c: Card = card()) => render(<ClipProvider id={c.id}><CoachingBox card={c} /></ClipProvider>);
const box = () => screen.getByTestId("coaching-box");
const pick = (name: RegExp) => fireEvent.click(within(box()).getByRole("button", { name }));
const saved = (p: Partial<Plan> = {}): Plan => ({ found: null, mode: null, flagged: false, addedToVisit: false, sent: false, ...p });

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  D.savePlan.mockImplementation(async (_id, p) => saved(p as Partial<Plan>));
  D.suggestion.mockResolvedValue(null);
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("CoachingBox", () => {
  it("before an answer: the disclaimer, listen, the four answers, and no way yet", () => {
    show();
    expect(box()).toHaveTextContent("💡 Coaching suggestion");
    expect(box()).toHaveTextContent("This is only a suggestion. You are the coach");
    expect(box()).toHaveTextContent("1Listen to the audio");
    expect(within(box()).getAllByTestId("cb-found")).toHaveLength(4);
    expect(box()).toHaveTextContent("Choose what you found to see the suggested way.");
    expect(within(box()).queryByTestId("cb-step4")).toBeNull();
  });

  it("needs help, no warning signs: ★ Call, why, the template's questions; saved; the AI asked once", async () => {
    show();
    pick(/She needs help with the move/);
    expect(within(box()).getByRole("button", { name: /Call/ })).toHaveTextContent("★ suggested");
    expect(within(box()).getByTestId("cb-why")).toHaveTextContent("No warning signs");
    expect(within(box()).getByTestId("cb-step4")).toHaveTextContent("What did you want to happen in We Do?");
    expect(D.savePlan).toHaveBeenCalledWith("r1", { found: 1, mode: "call" });
    await waitFor(() => expect(D.suggestion).toHaveBeenCalledWith("r1", 1));
  });

  it("the AI version replaces the template when it arrives", async () => {
    D.suggestion.mockResolvedValue(AI);
    show();
    pick(/She needs help with the move/);
    await waitFor(() => expect(within(box()).getByTestId("cb-step4")).toHaveTextContent("AI q1"));
    expect(within(box()).getByTestId("cb-step4")).toHaveTextContent("AI agree");
  });

  it("a warning sign (We Do missed in 4 of her last 5): ★ Visit, saying why", () => {
    show(card({ pattern: { ...card().pattern!, missed: { step: "We Do", n: 4, of: 5 } } }));
    pick(/She needs help with the move/);
    expect(within(box()).getByRole("button", { name: /Visit/ })).toHaveTextContent("★ suggested");
    expect(within(box()).getByTestId("cb-why")).toHaveTextContent("We Do was missed in 4 of her last 5 lessons");
  });

  it("the teacher was right: the report is flagged for the DC team; Undo and Flag it again", async () => {
    show();
    pick(/The teacher was right/);
    expect(D.savePlan).toHaveBeenCalledWith("r1", { found: 0, mode: "msg", flagged: true });
    expect(box()).toHaveTextContent("✓ Report sent to the DC team for review.");
    fireEvent.click(within(box()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(box()).toHaveTextContent("Report not flagged."));
    expect(D.savePlan).toHaveBeenLastCalledWith("r1", { flagged: false });
    fireEvent.click(within(box()).getByRole("button", { name: "Flag it again" }));
    await waitFor(() => expect(D.savePlan).toHaveBeenLastCalledWith("r1", { flagged: true }));
  });

  it("message: her first name in the Urdu text, editable; Send opens wa.me with the edited text", async () => {
    show();
    pick(/The teacher was right/);
    const text = within(box()).getByRole("textbox") as HTMLTextAreaElement;
    expect(text.value).toMatch(/^Sadia جی، /);
    fireEvent.change(text, { target: { value: "Sadia جی، شکریہ" } });
    const send = within(box()).getByRole("link", { name: /Send to Sadia/ });
    expect(send).toHaveAttribute("href", `https://wa.me/923001234567?text=${encodeURIComponent("Sadia جی، شکریہ")}`);
    fireEvent.click(send);
    await waitFor(() => expect(D.savePlan).toHaveBeenLastCalledWith("r1", { sent: true }));
  });

  it("a coach's edit is kept when the AI answer arrives late", async () => {
    let arrive: (s: typeof AI) => void = () => {};
    D.suggestion.mockReturnValue(new Promise((r) => { arrive = r; }));
    show();
    pick(/The teacher was right/);
    fireEvent.change(within(box()).getByRole("textbox"), { target: { value: "my own words" } });
    await act(async () => { arrive(AI); });
    expect((within(box()).getByRole("textbox") as HTMLTextAreaElement).value).toBe("my own words");
  });

  it("no WhatsApp number: no link, says so", () => {
    show(card({ phone: null }));
    pick(/The teacher was right/);
    expect(within(box()).queryByRole("link")).toBeNull();
    expect(box()).toHaveTextContent("No WhatsApp number on file");
  });

  it("visit: the teacher was right needs none; otherwise steps and Add to my next visit", async () => {
    show();
    pick(/The teacher was right/);
    pick(/^🏫/);
    expect(box()).toHaveTextContent("No visit is needed for this. A message is enough.");
    pick(/doesn’t fit her class/);
    expect(within(box()).getByTestId("cb-step4")).toHaveTextContent("Watch how the class is seated during We Do.");
    fireEvent.click(within(box()).getByRole("button", { name: "Add to my next visit" }));
    await waitFor(() => expect(box()).toHaveTextContent("Added to your next visit."));
    expect(D.savePlan).toHaveBeenLastCalledWith("r1", { addedToVisit: true });
  });

  it("not in the recording: ★ Call, questions about after it stopped", () => {
    show();
    pick(/Not in the recording/);
    expect(within(box()).getByRole("button", { name: /Call/ })).toHaveTextContent("★ suggested");
    expect(within(box()).getByTestId("cb-step4")).toHaveTextContent("after the recording stopped");
  });

  it("what she saved comes back: her answer, her way, added to the visit", () => {
    show(card({ plan: saved({ found: 2, mode: "visit", addedToVisit: true }) }));
    expect(within(box()).getAllByTestId("cb-found")[2]).toHaveAttribute("aria-pressed", "true");
    expect(within(box()).getByRole("button", { name: /Visit/ })).toHaveAttribute("aria-pressed", "true");
    expect(box()).toHaveTextContent("Added to your next visit.");
  });

  it("a failed save says so", async () => {
    D.savePlan.mockResolvedValue(null);
    show();
    pick(/She needs help with the move/);
    await waitFor(() => expect(within(box()).getByRole("alert")).toHaveTextContent("Couldn’t save"));
  });

  it("in Urdu: Rifat's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    show();
    expect(box()).toHaveTextContent("💡 کوچنگ کا مشورہ");
    expect(box()).toHaveTextContent("آپ نے کیا پایا؟");
  });
});
