import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.15 — the notices on a real teacher screen: the strip of what is being made, the ready banner, the
 * failed banner. The host is mounted by the shell (PortalLayout) on every page, so it sits here beside a probe
 * that shows where she is. Mocked at the network boundary only.
 */
vi.mock("../../services/api", () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    portal: {
      getAssessmentStatus: async (id: string) => (await get(`/assessment/status/${id}`)).data,
      generateAssessment: async (spec: unknown) => (await post("/assessment/generate", spec)).data,
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import api from "../../services/api";
import { NoticeHost } from "./NoticeHost";
import { noticeTracker } from "./tracker";
import { itemId, type NewNotice } from "./model";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const USER = "923001234567";
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const paper = (ref = "req1", over: Partial<NewNotice> = {}): NewNotice => ({
  kind: "paper", ref, title: "Plants and food", grade: 4, subject: "Science", questions: 15,
  waitHref: `/portal/teacher/assessment/request/${ref}`, spec: { grade: 4, subject: "science", questionCount: 15 }, ...over,
});
const lesson = (ref = "rend1", over: Partial<NewNotice> = {}): NewNotice => ({
  kind: "lesson", ref, title: "Transport of Water", grade: 7, subject: "Science", questions: null,
  waitHref: `/portal/teacher/lessons/preparing?grade=7&subject=Science&render=${ref}`, lessonId: "seg1", lang: "en",
  at: { grade: 7, subject: "Science", lesson: "seg1", render: ref }, ...over,
});

let paperStatus: Record<string, unknown>;
let lessonStatus: Record<string, unknown>;

function Probe() {
  const l = useLocation();
  return <span data-testid="at">{l.pathname}{l.search}</span>;
}
const mount = (at = "/portal/teacher/training", props: { bare?: boolean } = {}) => render(
  <MemoryRouter initialEntries={[at]}>
    <NoticeHost userKey={USER} {...props} />
    <Probe />
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  document.documentElement.style.removeProperty("--notice-h");
  paperStatus = {};
  lessonStatus = {};
  http.get.mockImplementation(async (url: string) => {
    const id = url.split("/").pop() as string;
    if (url.startsWith("/assessment/status/")) return { data: { success: true, status: "generating", ...(paperStatus[id] as object) } };
    if (url.startsWith("/lp612/status/")) return { data: { success: true, state: "authoring", ...(lessonStatus[id] as object) } };
    throw new Error(`unmocked ${url}`);
  });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); noticeTracker.reset(); });

describe("the strip: Being made, on any screen", () => {
  it("nothing being made, nothing on screen", () => {
    mount();
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("a paper being made shows on Training, a screen of neither feature; tapping it goes to its waiting page", () => {
    noticeTracker.track(paper());
    mount();
    const row = within(screen.getByRole("region", { name: "Being made" })).getByRole("link");
    expect(row).toHaveTextContent("Paper · Grade 4 · Science");
    fireEvent.click(row);
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/assessment/request/req1");
  });

  it("its own waiting page does not repeat it", () => {
    noticeTracker.track(paper());
    mount("/portal/teacher/assessment/request/req1");
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("a lesson plan's own page is told from another's by its render", () => {
    noticeTracker.track(lesson("rend1"));
    mount("/portal/teacher/lessons/preparing?grade=7&subject=Science&render=rend2");
    expect(screen.getByRole("region", { name: "Being made" })).toBeInTheDocument();
  });

  it("two rows, then '+N more' opening the list with every item", () => {
    ["a", "b", "c", "d"].forEach((r, i) => { vi.setSystemTime(Date.now() + i * 1000); noticeTracker.track(paper(r, { title: `Paper ${r}` })); });
    mount();
    expect(within(screen.getByRole("region", { name: "Being made" })).getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/ }));
    const dialog = screen.getByRole("dialog", { name: /Being made/ });
    expect(dialog).toHaveTextContent("We'll tell you here when each one is ready.");
    expect(within(dialog).getAllByRole("link")).toHaveLength(4);
  });

  it("the page keeps its last row above the strip (a CSS variable the page docks read), and lets go of it when the strip goes", async () => {
    noticeTracker.track(paper());
    const { unmount } = mount();
    expect(parseInt(document.documentElement.style.getPropertyValue("--notice-h"), 10)).toBeGreaterThanOrEqual(64);
    unmount();
    expect(document.documentElement.style.getPropertyValue("--notice-h")).toBe("");
  });

  it("not on a screen with no menu (recording): nothing is drawn, and nothing is lost — it shows on the next screen", () => {
    noticeTracker.track(paper());
    const { container } = mount("/portal/teacher/coaching/record", { bare: true });
    expect(container.querySelector("[role=region]")).toBeNull();
    expect(noticeTracker.getItems()).toHaveLength(1);
  });

  it("it is followed from the shell: the paper turns ready while she is elsewhere", async () => {
    noticeTracker.track(paper());
    mount();
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    await tick(4000);
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Paper ready");
  });
});

describe("the ready banner", () => {
  async function readyPaper(over: Partial<NewNotice> = {}) {
    noticeTracker.track(paper("req1", over));
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    mount();
    await tick(4000);
  }

  it("Open goes to the paper and the item is gone (opened)", async () => {
    await readyPaper();
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: /Open/ }));
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/assessment/paper/p9");
    expect(noticeTracker.getItems()).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a ready lesson plan opens in the plan viewer, with what Start DC observation prefills", async () => {
    noticeTracker.track(lesson());
    lessonStatus = { rend1: { state: "ready", url: "https://r2/x" } };
    mount();
    await tick(4000);
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: /Open/ }));
    await tick(0);
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/lessons/plan");
    expect(noticeTracker.getItems()).toEqual([]);
  });

  it("✕ counts as seen: it closes and the item does not come back", async () => {
    await readyPaper();
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(noticeTracker.getItems()).toEqual([]);
    await tick(60_000);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("left alone it stays 10 seconds and then goes", async () => {
    await readyPaper();
    await tick(9000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await tick(1500);
    expect(screen.queryByRole("status")).toBeNull();
    expect(noticeTracker.getItems()).toEqual([]);
  });

  it("two ready at once are ONE banner", async () => {
    noticeTracker.track(paper("req1"));
    noticeTracker.track(lesson("rend1"));
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    lessonStatus = { rend1: { state: "ready" } };
    mount();
    await tick(4000);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("2 ready");
  });

  it("never on the item's own page: there the page shows it, and the item is settled", async () => {
    noticeTracker.track(paper("req1"));
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    mount("/portal/teacher/assessment/request/req1");
    await tick(4000);
    expect(screen.queryByRole("status")).toBeNull();
    expect(noticeTracker.getItems()).toEqual([]);
  });

  it("not on a screen with no menu; it waits for the next screen", async () => {
    noticeTracker.track(paper("req1"));
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    mount("/portal/teacher/coaching/record", { bare: true });
    await tick(30_000);
    expect(screen.queryByRole("status")).toBeNull();
    expect(noticeTracker.getItems()[0]).toMatchObject({ state: "ready", announced: false });
  });
});

describe("a failure: in the app only", () => {
  async function failedPaper() {
    noticeTracker.track(paper("req1"));
    paperStatus = { req1: { status: "failed", errorCode: "TRUNCATED" } };
    mount();
    await tick(4000);
  }

  it("a red banner with the real reason and Try again", async () => {
    await failedPaper();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't make it");
    expect(alert).toHaveTextContent("Plants and food");
    expect(alert).toHaveTextContent("Too many questions");
    expect(within(alert).getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("after its 10 seconds the row stays in the strip, red, until she taps it — then it is gone", async () => {
    await failedPaper();
    await tick(10_500);
    expect(screen.queryByRole("alert")).toBeNull();
    const strip = screen.getByRole("region", { name: "Being made" });
    const row = within(strip).getByRole("link");
    expect(row).toHaveTextContent("Couldn't make it");
    fireEvent.click(row);
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/assessment/request/req1");
    expect(noticeTracker.getItems()).toEqual([]);
  });

  it("Try again from the banner sends the same request and follows the new one", async () => {
    await failedPaper();
    http.post.mockResolvedValue({ data: { success: true, requestId: "req2" } });
    await act(async () => { fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: /Try again/ })); });
    expect(http.post).toHaveBeenCalledWith("/assessment/generate", { grade: 4, subject: "science", questionCount: 15 });
    expect(noticeTracker.getItems().map((i) => i.id)).toEqual([itemId("paper", "req2")]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("it never sends anything to WhatsApp: the app makes no such call", async () => {
    await failedPaper();
    await tick(60_000);
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe("Urdu", () => {
  it("the strip and the banner follow her language", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    noticeTracker.track(paper("req1"));
    noticeTracker.track(lesson("rend1"));
    mount();
    expect(screen.getByRole("region", { name: "تیار ہو رہا ہے" })).toBeInTheDocument();
    paperStatus = { req1: { status: "ready", paperId: "p9" } };
    await tick(4000);
    expect(screen.getByRole("status")).toHaveTextContent("پرچہ تیار ہے");
  });
});
