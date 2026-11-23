import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { tapProblems } from "../../newui/checks/rules";

/**
 * The teacher Home's class link card (switch web_quiz_class_link; tonight's line with web_quiz_evening_round too),
 * the server deciding both (GET /api/portal/class-link: 404 = off). On: per class, the term's link, "Send to class
 * group" (the wa.me href the server built, opened in a new tab) and "Copy"; a Send or Copy tells the server
 * (POST /class-link/tap) and folds the class to one row. With the round: tonight's ready line (the lesson title is
 * data), then a count of children and the report's Evening rounds link; never a name. Mocked at the network only.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { ClassLinkCard } from "./ClassLinkCard";
import { CLASS_LINK_COPY as EN, CLASS_LINK_COPY_UR as UR } from "../classlink/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const URL1 = "https://quiz.example.org/j/K7QM2XR9TB";
const URL2 = "https://quiz.example.org/j/H4PW8NZ3CD";
const wa = (u: string) => `https://wa.me/?text=${encodeURIComponent(`${u}?f=1`)}`;
const REPORT = "https://quiz.example.org/r/tok?tab=class#evening-rounds";
const C1 = { classId: "c1", grade: 3, section: "A", url: URL1, sendHref: wa(URL1), sent: false, round: null };
const C2 = { classId: "c2", grade: 5, section: null, url: URL2, sendHref: wa(URL2), sent: false, round: null };
const on = (body: unknown) => http.get.mockResolvedValue({ data: body });
const off = () => http.get.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  http.get.mockReset();
  http.post.mockReset();
  http.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("ClassLinkCard: off", () => {
  it("draws nothing while the server says off (404), and asks /class-link once", async () => {
    off();
    const { container } = render(<ClassLinkCard />);
    await flush();
    expect(container.innerHTML).toBe("");
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith("/class-link");
  });

  it("draws nothing for an empty list or a malformed answer", async () => {
    on({ classes: [], reportHref: null });
    const a = render(<ClassLinkCard />);
    await flush();
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    on({ classes: [{ ...C1, sendHref: "javascript:alert(1)" }] });
    const b = render(<ClassLinkCard />);
    await flush();
    expect(b.container.innerHTML).toBe("");
  });
});

describe("ClassLinkCard: the class link on", () => {
  it("shows Class 3 A, its link, Send to class group (the server's wa.me href, new tab) and Copy", async () => {
    on({ classes: [C1], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByRole("region", { name: EN.title })).toBeTruthy();
    expect(screen.getByText("Class 3 A")).toBeTruthy();
    expect(screen.getByText(EN.body)).toBeTruthy();
    expect(screen.getByTestId("class-link-url").textContent).toBe("quiz.example.org/j/K7QM2XR9TB");
    const send = screen.getByRole("link", { name: EN.send });
    expect(send.getAttribute("href")).toBe(wa(URL1));
    expect(send.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("button", { name: EN.copy })).toBeTruthy();
    expect(screen.queryByTestId("class-link-round")).toBeNull();
  });

  it("a class with no section is 'Class 5'; two classes, two blocks, the sentence once", async () => {
    on({ classes: [C1, C2], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getAllByTestId("class-link-class")).toHaveLength(2);
    expect(screen.getByText("Class 5")).toBeTruthy();
    expect(screen.getAllByText(EN.body)).toHaveLength(1);
  });

  it("Send tells the server (tap forward) and folds the class to one row: Class link sent · Send again", async () => {
    on({ classes: [C1], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    fireEvent.click(screen.getByRole("link", { name: EN.send }));
    await flush();
    expect(http.post).toHaveBeenCalledWith("/class-link/tap", { classId: "c1", how: "forward" });
    expect(screen.getByTestId("class-link-sent").textContent).toContain(EN.sent);
    const again = screen.getByRole("link", { name: EN.sendAgain });
    expect(again.getAttribute("href")).toBe(wa(URL1));
    expect(screen.queryByRole("button", { name: EN.copy })).toBeNull();
  });

  it("Copy puts the whole link on the clipboard, says Copied, and tells the server (tap copy)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    on({ classes: [C1], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: EN.copy }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(URL1);
    expect(screen.getByRole("button", { name: EN.copied })).toBeTruthy();
    expect(http.post).toHaveBeenCalledWith("/class-link/tap", { classId: "c1", how: "copy" });
  });

  it("already sent this term (server): the one row from the start", async () => {
    on({ classes: [{ ...C1, sent: true }], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByTestId("class-link-sent").textContent).toBe(`Class 3 A${EN.sent}`);
    expect(screen.queryByTestId("class-link-url")).toBeNull();
    expect(screen.queryByText(EN.body)).toBeNull();
  });

  it("every target is 56px or more", async () => {
    on({ classes: [C1, { ...C2, sent: true, round: { lesson: null, played: 3 } }], reportHref: REPORT });
    const { container } = render(<ClassLinkCard />);
    await flush();
    expect(tapProblems(container)).toEqual([]);
  });
});

describe("ClassLinkCard: tonight's evening round", () => {
  it("a ready round: the line with the lesson title, nothing to send; no report link", async () => {
    on({ classes: [{ ...C1, sent: true, round: { lesson: "Adding two-digit numbers", played: 0 } }], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByTestId("class-link-round").textContent).toBe(EN.ready("Adding two-digit numbers"));
    expect(screen.getByTestId("class-link-round").textContent).toBe(
      "Tonight's class quiz is ready, from today's lesson: Adding two-digit numbers. It is on your class link: nothing to send.",
    );
    expect(screen.queryByTestId("class-link-report")).toBeNull();
  });

  it("a ready round with no lesson title: the line without one", async () => {
    on({ classes: [{ ...C1, round: { lesson: null, played: 0 } }], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByTestId("class-link-round").textContent).toBe(EN.readyNoLesson);
  });

  it("children played: the count and the report's Evening rounds link (new tab); no name anywhere", async () => {
    on({ classes: [{ ...C1, sent: true, round: { lesson: "Adding two-digit numbers", played: 14 } }], reportHref: REPORT });
    const { container } = render(<ClassLinkCard />);
    await flush();
    expect(screen.getByText("14 children played tonight's quiz")).toBeTruthy();
    const link = screen.getByRole("link", { name: EN.seeRounds });
    expect(link.getAttribute("href")).toBe(REPORT);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(container.textContent).not.toMatch(/Zara|Ali/);
    expect(EN.played(1)).toBe("1 child played tonight's quiz");
  });
});

describe("ClassLinkCard: Urdu", () => {
  it("speaks Urdu when the page is in Urdu: «کلاس 3 A» (Western digits, the teacher app's rule), Send, Copy, the round line", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    on({ classes: [{ ...C1, round: { lesson: "جمع کے سوال", played: 0 } }], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByRole("region", { name: UR.title })).toBeTruthy();
    expect(UR.classLabel(3, "A")).toBe("کلاس 3 A");
    expect(screen.getByRole("link", { name: UR.send })).toBeTruthy();
    expect(screen.getByRole("button", { name: UR.copy })).toBeTruthy();
    expect(screen.getByTestId("class-link-round").textContent).toBe(UR.ready("جمع کے سوال"));
    expect(UR.ready("X")).toContain("⁨X⁩");
  });
});
