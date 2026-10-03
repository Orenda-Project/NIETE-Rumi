import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.13 — after Make assessment (deep-screens.html, Assessment 2 and 3):
 *
 *   Writing  an inner page: the light bar (crumb Assessment, "Science · Plants"), a Hero ring
 *            with the time so far and "Writing…", chips Grade 4 · Science · 15 Q. It asks
 *            /assessment/status every 4 s, as AssessmentGeneratorPanel did; a failed request
 *            in between is a blip, not an answer; after 5 minutes it stops asking.
 *   Ready    a green tick, "15 Q" and "30 marks", then Download (primary), Answer key and Make
 *            another (outline).
 *   Failed   the server's code as a short chip, then Try again and Change choices. No sentences.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    generateAssessment: vi.fn(),
  },
}));
import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import AssessmentRequest from "./AssessmentRequest";
import { ASSESSMENT_COPY } from "../copy";

const SPEC = {
  grade: 4, subject: "science", chapterNumber: 2, contentSource: "unseen", questionCount: 15,
  questionTypes: [], answerLines: true, outputFormat: "pdf",
};
const T0 = new Date("2026-10-03T06:00:00Z").getTime();
const STATE = { spec: SPEC, subjectName: "Science", chapterTitle: "Plants", startedAt: T0 };
const PAPERS = {
  success: true, total: 2, page: 1, pageSize: 10,
  papers: [
    { paper_id: "p-9", grade: 4, subject_key: "science", subject: "Science", chapter_number: 2, question_count: 15, total_marks: 30, ready_at: "2026-10-03T06:01:00Z", has_answer_key: true, version: 1 },
    { paper_id: "p-1", grade: 3, subject_key: "english", subject: "English", chapter_number: 1, question_count: 10, total_marks: 20, ready_at: "2026-10-01T06:01:00Z", has_answer_key: true, version: 1 },
  ],
};

function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</output>;
}

let clicks: Array<{ href: string; target: string }>;

function renderRequest(state: unknown = STATE, id = "r-1") {
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Hataf", role: "teacher" }, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/portal/assessment/request/${id}`, state }]}>
      <Routes>
        <Route path="/portal/assessment/request/:requestId" element={<><AssessmentRequest /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Let promises and due timers run, a second at a time: React commits (and starts the next
 * effect) at the end of each act(), as it would between real ticks.
 */
const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  for (let left = ms; left > 0; left -= 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, left)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0 + 40_000);
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, target: this.target });
  });
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "generating" });
  vi.mocked(portal.getAssessmentPapers).mockResolvedValue(PAPERS as never);
  vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: true, url: "https://r2.example/p-9.pdf" });
  vi.mocked(portal.generateAssessment).mockResolvedValue({ success: true, requestId: "r-2" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("Writing", () => {
  it("is an inner page: crumb Assessment, the subject and chapter as its title", async () => {
    renderRequest();
    await settle();
    expect(screen.getByTestId("newui-inner-bar")).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Assessment");
    expect(screen.getByRole("heading", { level: 1, name: "Science · Plants" })).toBeInTheDocument();
  });

  it("a ring with the time so far, 'Writing…', and chips Grade 4 · Science · 15 Q", async () => {
    renderRequest();
    await settle();
    const hero = screen.getByTestId("newui-hero");
    expect(within(hero).getByText("Writing…")).toBeInTheDocument();
    const ring = within(hero).getByRole("progressbar");
    expect(ring).toHaveAttribute("aria-valuetext", "0:40");
    expect(within(hero).getByText("Grade 4")).toBeInTheDocument();
    expect(within(hero).getByText("Science")).toBeInTheDocument();
    expect(within(hero).getByText("15 Q")).toBeInTheDocument();
    await settle(5_000);
    expect(within(hero).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "0:45");
  });

  it("asks for the status at once and then every 4 seconds", async () => {
    renderRequest();
    await settle();
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(1);
    expect(portal.getAssessmentStatus).toHaveBeenCalledWith("r-1");
    await settle(4_000);
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(2);
    await settle(4_000);
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(3);
  });

  it("a request that fails on the way is a blip: she keeps waiting and it keeps asking", async () => {
    vi.mocked(portal.getAssessmentStatus).mockRejectedValueOnce(new Error("network"));
    renderRequest();
    await settle();
    expect(screen.getByText("Writing…")).toBeInTheDocument();
    await settle(4_000);
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Writing…")).toBeInTheDocument();
  });

  it("after five minutes it stops asking: 'Still writing', and her list is one tap away", async () => {
    renderRequest();
    await settle();
    await settle(5 * 60_000);
    expect(screen.getByText("Still writing")).toBeInTheDocument();
    const calls = vi.mocked(portal.getAssessmentStatus).mock.calls.length;
    await settle(20_000);
    expect(vi.mocked(portal.getAssessmentStatus).mock.calls.length).toBe(calls);
    expect(screen.getByRole("link", { name: "My assessments" })).toHaveAttribute("href", "/portal/assessment/mine");
  });

  it("opened again with nothing in hand (a reload): the title falls back to Assessment", async () => {
    renderRequest(null);
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Assessment" })).toBeInTheDocument();
    expect(screen.getByText("Writing…")).toBeInTheDocument();
  });
});

describe("polling, then Ready", () => {
  beforeEach(() => {
    vi.mocked(portal.getAssessmentStatus)
      .mockResolvedValueOnce({ success: true, status: "queued" })
      .mockResolvedValueOnce({ success: true, status: "generating" })
      .mockResolvedValue({ success: true, status: "ready", paperId: "p-9" });
  });

  it("turns into Ready when the paper is made, and stops asking", async () => {
    renderRequest();
    await settle();
    expect(screen.getByText("Writing…")).toBeInTheDocument();
    await settle(4_000);
    expect(screen.getByText("Writing…")).toBeInTheDocument();
    await settle(4_000);
    const hero = screen.getByTestId("newui-hero");
    expect(within(hero).getByText("Ready")).toBeInTheDocument();
    expect(screen.getByTestId("newui-hero-icon").className).toMatch(/\bbg-nu-done-bg\b/);
    await settle(20_000);
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(3);
  });

  it("chips '15 Q' and '30 marks', from her papers", async () => {
    renderRequest();
    await settle(8_000);
    const hero = screen.getByTestId("newui-hero");
    expect(within(hero).getByText("15 Q")).toBeInTheDocument();
    expect(within(hero).getByText("30 marks")).toBeInTheDocument();
  });

  it("Download (primary), then Answer key and Make another (outline)", async () => {
    renderRequest();
    await settle(8_000);
    const actions = screen.getByTestId("newui-bottom-actions");
    const buttons = within(actions).getAllByRole("button").concat(within(actions).queryAllByRole("link"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Download", "Answer key", "Make another"]);
    expect(buttons[0].className).toMatch(/\bbg-nu-button\b/);
    expect(buttons[1].className).toMatch(/\bborder-nu-button-secondary-border\b/);
    expect(buttons[2].className).toMatch(/\bborder-nu-button-secondary-border\b/);
  });

  it("Download opens the paper in a new tab on the web", async () => {
    renderRequest();
    await settle(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settle();
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith("p-9", "paper");
    expect(clicks).toEqual([{ href: "https://r2.example/p-9.pdf", target: "_blank" }]);
  });

  it("in the Android app Download opens it without a new tab, and the page stays", async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    renderRequest();
    await settle(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settle();
    expect(clicks).toEqual([{ href: "https://r2.example/p-9.pdf", target: "" }]);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("Answer key asks for the key; when there is none, a 'No answer key' chip and nothing opens", async () => {
    vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: false });
    renderRequest();
    await settle(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Answer key" }));
    await settle();
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith("p-9", "answer_key");
    expect(screen.getByText("No answer key")).toBeInTheDocument();
    expect(clicks).toEqual([]);
  });

  it("a download that cannot be reached says 'Not opened'", async () => {
    vi.mocked(portal.getAssessmentDownload).mockRejectedValue(new Error("502"));
    renderRequest();
    await settle(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settle();
    expect(screen.getByText("Not opened")).toBeInTheDocument();
  });

  it("Make another goes back to the Assessment page", async () => {
    renderRequest();
    await settle(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Make another" }));
    await settle();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/);
  });

  it("every target on Ready is at least 56px, and no word on it is a sentence", async () => {
    renderRequest();
    await settle(8_000);
    expect(tapProblems(document.body)).toEqual([]);
    const texts = Array.from(document.body.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || "").trim()))
      .filter(Boolean);
    expect(texts.filter((t) => copyProblem(t))).toEqual([]);
  });

  it("opened after a reload: the title is read from the paper", async () => {
    renderRequest(null);
    await settle(8_000);
    expect(screen.getByRole("heading", { level: 1, name: "Science · Ch 2" })).toBeInTheDocument();
    expect(screen.getByText("15 Q")).toBeInTheDocument();
  });
});

describe("Failed", () => {
  it.each([
    "BOOK_NOT_FOUND", "CHAPTER_NOT_FOUND", "NO_CONTENT", "PAGE_OUT_OF_RANGE", "INVALID_PAGE_RANGE", "TRUNCATED",
    "MODEL_UNAVAILABLE", "BAD_JSON", "NO_QUESTIONS", "RENDER_FAILED", "UPLOAD_FAILED",
  ] as const)("%s: 'Not made', its short label as a red chip, Try again and Change choices", async (code) => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "failed", errorCode: code });
    renderRequest();
    await settle();
    const hero = screen.getByTestId("newui-hero");
    expect(within(hero).getByText("Not made")).toBeInTheDocument();
    const chip = within(hero).getByText(ASSESSMENT_COPY.failures[code]);
    expect(chip.closest("[data-chip]")?.className).toMatch(/\bbg-nu-chip-error-bg\b/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change choices" })).toBeInTheDocument();
    await settle(20_000);
    expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(1);
  });

  it("an unknown code: 'Something went wrong'", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "failed", errorCode: "UNKNOWN" });
    renderRequest();
    await settle();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("a request that is not hers or not there: 'Not found'", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "not_found" });
    renderRequest();
    await settle();
    expect(screen.getByText("Not made")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("Try again sends the same paper again and waits on the new request", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValueOnce({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    renderRequest();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(portal.generateAssessment).toHaveBeenCalledWith(SPEC);
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/assessment/request/r-2");
    expect(screen.getByText("Writing…")).toBeInTheDocument();
    expect(portal.getAssessmentStatus).toHaveBeenLastCalledWith("r-2");
  });

  it("Try again refused: 'Not started', still no sentence", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValueOnce({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    vi.mocked(portal.generateAssessment).mockRejectedValue(Object.assign(new Error("400"), { response: { data: { error: "A paper can hold up to 50 questions." } } }));
    renderRequest();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText(/can hold/)).toBeNull();
  });

  it("Change choices goes back to the Assessment page", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    renderRequest();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Change choices" }));
    await settle();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/);
  });

  it("without the paper in hand (a reload) only Change choices is offered", async () => {
    vi.mocked(portal.getAssessmentStatus).mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    renderRequest(null);
    await settle();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change choices" })).toBeInTheDocument();
  });
});

describe("the generator turned off", () => {
  it("goes back to the Assessment page (which says Coming soon) and asks nothing", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: true } } as never);
    renderRequest();
    await settle();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/);
    expect(portal.getAssessmentStatus).not.toHaveBeenCalled();
  });
});
