import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";

/**
 * bd-t5tow — the Assessment Generator page gets two tabs, "Create paper" and "My papers", and a
 * paper being made is visible in both. Every button and state in the approved design has a test
 * here, driven through the real generator form, the real papers list and the real toaster.
 */
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentPapers: vi.fn(),
  },
}));
// The real toast store, with `toast` spied so failure toasts can be asserted.
const toastSpy = vi.hoisted(() => ({ fn: null as null | ReturnType<typeof vi.fn> }));
vi.mock("@/hooks/use-toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/use-toast")>();
  const toast = vi.fn(real.toast);
  toastSpy.fn = toast;
  return { ...real, toast, useToast: () => ({ ...real.useToast(), toast }) };
});

import { portal } from "../services/api";
import ClassicAssessment from "./ClassicAssessment";
import { JOBS_STORAGE_KEY } from "../components/assessment-jobs/usePaperJobs";

const api = vi.mocked(portal);
const LABEL = "Grade 4 Science · Plants · 15 questions";

type Paper = Record<string, unknown> & { paper_id: string };
const paper = (id: string, chapter: number): Paper => ({
  paper_id: id, grade: 4, subject_key: "science", subject: "Science", chapter_number: chapter,
  question_count: 15, total_marks: 30, ready_at: "2026-10-06T09:00:00Z", has_answer_key: true,
  version: 1, version_count: 1,
});
let papers: Paper[] = [];

beforeAll(() => {
  // What jsdom lacks for Radix Select (as in PortalCurriculum.tab.test.tsx).
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  sessionStorage.clear();
  papers = [paper("p-old-1", 1), paper("p-old-2", 3), paper("p-old-3", 5)];
  api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentEditing: false } } as never);
  api.getAssessmentOptions.mockImplementation(async () => ({
    success: true, grades: [4], subjects: [{ subject_key: "science", subject: "Science" }],
    types: [], maxQuestions: 25, defaultQuestions: 15,
  }) as never);
  api.getAssessmentChapters.mockResolvedValue({
    success: true, chapters: [{ chapter_number: 2, chapter_title: "Plants", page_start: 10, page_end: 20, page_count: 11 }],
  } as never);
  api.generateAssessment.mockResolvedValue({ success: true, requestId: "r1" });
  api.getAssessmentStatus.mockResolvedValue({ success: true, status: "generating" });
  api.getAssessmentDownload.mockResolvedValue({ success: true, available: true, url: "https://files/x.pdf" });
  api.getAssessmentPapers.mockImplementation(async () => ({
    success: true, papers: [...papers], total: papers.length, page: 1, pageSize: 10,
  }) as never);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

let go: ReturnType<typeof useNavigate> = () => {};
const Where = () => { const l = useLocation(); return <output data-testid="where">{l.search}</output>; };
const Navigator = () => { go = useNavigate(); return null; };

function renderPage(path = "/portal/assessment") {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <Where />
      <ClassicAssessment />
      <Toaster />
    </MemoryRouter>,
  );
  return user;
}

const where = () => screen.getByTestId("where").textContent;
const createTab = () => screen.getByRole("tab", { name: /Create paper/ });
const papersTab = () => screen.getByRole("tab", { name: /My papers/ });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function makePaper(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("combobox", { name: "Class" }));
  await user.click(await screen.findByRole("option", { name: "Grade 4" }));
  await user.click(screen.getByRole("combobox", { name: "Subject" }));
  await user.click(await screen.findByRole("option", { name: "Science" }));
  await waitFor(() => expect(api.getAssessmentChapters).toHaveBeenCalled());
  await user.click(screen.getByRole("combobox", { name: "Chapter" }));
  await user.click(await screen.findByRole("option", { name: "2 · Plants" }));
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Writing your paper" });
}

/** The next poll answers ready: 4 s away normally, 30 s once the job is slow. */
async function becomesReady(paperId = "p-new", nextPollMs = 4000) {
  papers = [paper(paperId, 2), ...papers];
  api.getAssessmentStatus.mockResolvedValue({ success: true, status: "ready", paperId });
  await advance(nextPollMs);
}
/** The Create tab's card (the label also appears in the hidden Being made row). */
const card = (heading: string) => screen.getByRole("heading", { name: heading }).parentElement!;

describe("ClassicAssessment tabs", () => {
  it("opens on Create paper by default", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Generate" });
    expect(createTab()).toHaveAttribute("aria-selected", "true");
    expect(papersTab()).toHaveAttribute("aria-selected", "false");
  });

  it("?tab=papers opens My papers", async () => {
    renderPage("/portal/assessment?tab=papers");
    await screen.findByText(/Grade 4 Science · Chapter 1/);
    expect(papersTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
  });

  it("an unknown tab value falls back to Create paper", async () => {
    renderPage("/portal/assessment?tab=nonsense");
    await screen.findByRole("button", { name: "Generate" });
    expect(createTab()).toHaveAttribute("aria-selected", "true");
  });

  it("clicking the tabs updates the URL, and browser Back returns to the previous tab", async () => {
    const user = renderPage();
    await screen.findByRole("button", { name: "Generate" });
    await user.click(papersTab());
    expect(where()).toBe("?tab=papers");
    expect(papersTab()).toHaveAttribute("aria-selected", "true");
    await user.click(createTab());
    expect(where()).toBe("");
    act(() => go(-1));
    await waitFor(() => expect(papersTab()).toHaveAttribute("aria-selected", "true"));
    expect(where()).toBe("?tab=papers");
  });

  it("badge: the paper count, then '1 being made' while writing, then '1 new' after ready, cleared once My papers is opened", async () => {
    const user = renderPage();
    await waitFor(() => expect(within(papersTab()).getByText("3")).toBeInTheDocument());
    await makePaper(user);
    expect(within(papersTab()).getByText("1 being made")).toBeInTheDocument();
    await becomesReady();
    await waitFor(() => expect(within(papersTab()).getByText("1 new")).toBeInTheDocument());
    expect(within(papersTab()).queryByText("1 being made")).toBeNull();
    await user.click(papersTab());
    await user.click(createTab());
    expect(within(papersTab()).queryByText("1 new")).toBeNull();
    await waitFor(() => expect(within(papersTab()).getByText("4")).toBeInTheDocument());
  });

  it("writing card: label and copy; Go to My papers switches tab", async () => {
    const user = renderPage();
    await makePaper(user);
    expect(within(card("Writing your paper")).getByText(LABEL)).toBeInTheDocument();
    expect(screen.getByText(
      "This takes about a minute. You can switch to My papers or leave this page; your paper keeps being made and will be waiting in My papers.",
    )).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to My papers" }));
    expect(where()).toBe("?tab=papers");
    expect(papersTab()).toHaveAttribute("aria-selected", "true");
  });

  it("writing card: Make another returns to the form while the job continues in Being made", async () => {
    const user = renderPage();
    await makePaper(user);
    await user.click(screen.getByRole("button", { name: "Make another" }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Writing your paper" })).toBeNull();
    expect(within(papersTab()).getByText("1 being made")).toBeInTheDocument();
    const polls = api.getAssessmentStatus.mock.calls.length;
    await advance(4000);
    expect(api.getAssessmentStatus.mock.calls.length).toBeGreaterThan(polls);
    await user.click(papersTab());
    const section = screen.getByRole("region", { name: "Being made" });
    expect(within(section).getByText(LABEL)).toBeInTheDocument();
    expect(within(section).getByText("Writing…")).toBeInTheDocument();
    expect(within(section).getByText(/^Started \d{2}:\d{2} · about a minute$/)).toBeInTheDocument();
  });

  it("writing row turns slow after five minutes and keeps checking", async () => {
    const user = renderPage("/portal/assessment");
    await makePaper(user);
    await user.click(screen.getByRole("button", { name: "Go to My papers" }));
    await advance(5 * 60 * 1000 + 4000);
    const section = screen.getByRole("region", { name: "Being made" });
    expect(within(section).getByText("Taking longer than usual · we'll keep checking")).toBeInTheDocument();
    const polls = api.getAssessmentStatus.mock.calls.length;
    await advance(30_000);
    expect(api.getAssessmentStatus.mock.calls.length).toBe(polls + 1);
  });

  it("ready card: Download and Answer key fetch the paper and the key", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = renderPage();
    await makePaper(user);
    await becomesReady("p-new");
    await screen.findByRole("heading", { name: "Your paper is ready" });
    expect(within(card("Your paper is ready").parentElement!).getByText(LABEL)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(api.getAssessmentDownload).toHaveBeenLastCalledWith("p-new", "paper");
    await user.click(screen.getByRole("button", { name: "Answer key" }));
    expect(api.getAssessmentDownload).toHaveBeenLastCalledWith("p-new", "answer_key");
    expect(open).toHaveBeenCalledWith("https://files/x.pdf", "_blank", "noopener,noreferrer");
  });

  it("ready card: See in My papers switches tab and the new paper wears a New chip for that visit", async () => {
    const user = renderPage();
    await makePaper(user);
    await becomesReady("p-new");
    await screen.findByRole("heading", { name: "Your paper is ready" });
    await user.click(screen.getByRole("button", { name: "See in My papers" }));
    expect(where()).toBe("?tab=papers");
    const newRow = (await screen.findByText(/Grade 4 Science · Chapter 2/)).closest("li")!;
    expect(within(newRow).getByText("New")).toBeInTheDocument();
    const oldRow = screen.getByText(/Grade 4 Science · Chapter 1/).closest("li")!;
    expect(within(oldRow).queryByText("New")).toBeNull();
    // Leaving My papers ends the visit; coming back, nothing is New any more.
    await user.click(createTab());
    await user.click(papersTab());
    const again = screen.getByText(/Grade 4 Science · Chapter 2/).closest("li")!;
    expect(within(again).queryByText("New")).toBeNull();
  });

  it("ready card: Make another returns to the form", async () => {
    const user = renderPage();
    await makePaper(user);
    await becomesReady();
    await screen.findByRole("heading", { name: "Your paper is ready" });
    await user.click(screen.getByRole("button", { name: "Make another" }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your paper is ready" })).toBeNull();
  });

  it("a ready paper refreshes My papers", async () => {
    const user = renderPage();
    await waitFor(() => expect(api.getAssessmentPapers).toHaveBeenCalled());
    const before = api.getAssessmentPapers.mock.calls.length;
    await makePaper(user);
    await becomesReady();
    await waitFor(() => expect(api.getAssessmentPapers.mock.calls.length).toBeGreaterThan(before));
  });

  it("ready toast: 'Your paper is ready' with the label; View switches to My papers", async () => {
    const user = renderPage();
    await makePaper(user);
    await user.click(screen.getByRole("button", { name: "Make another" })); // she is on the form, not the card
    await becomesReady();
    expect(toastSpy.fn).toHaveBeenCalledWith(expect.objectContaining({ title: "Your paper is ready", description: LABEL }));
    await user.click(await screen.findByRole("button", { name: "View" }));
    expect(where()).toBe("?tab=papers");
    expect(papersTab()).toHaveAttribute("aria-selected", "true");
  });

  it("the ready card is gone after visiting My papers and coming back", async () => {
    const user = renderPage();
    await makePaper(user);
    await becomesReady();
    await screen.findByRole("heading", { name: "Your paper is ready" });
    await user.click(papersTab());
    await user.click(createTab());
    expect(screen.queryByRole("heading", { name: "Your paper is ready" })).toBeNull();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("no card is removed on a timer (ten minutes later both cards are still there)", async () => {
    const user = renderPage();
    await makePaper(user);
    await advance(10 * 60 * 1000);
    expect(screen.getByRole("heading", { name: "Writing your paper" })).toBeInTheDocument();
    await becomesReady("p-new", 30_000);
    await screen.findByRole("heading", { name: "Your paper is ready" });
    await advance(10 * 60 * 1000);
    expect(screen.getByRole("heading", { name: "Your paper is ready" })).toBeInTheDocument();
  });

  it("failed: back to the form with the failure toast, and a Not made row in My papers", async () => {
    const user = renderPage();
    await makePaper(user);
    api.getAssessmentStatus.mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    await advance(4000);
    await screen.findByRole("button", { name: "Generate" });
    expect(toastSpy.fn).toHaveBeenCalledWith(expect.objectContaining({
      title: "We could not make your paper",
      description: "We don't have the text for that chapter yet — please try another chapter.",
    }));
    await user.click(papersTab());
    const section = screen.getByRole("region", { name: "Being made" });
    expect(within(section).getByText(LABEL)).toBeInTheDocument();
    expect(within(section).getByText("Not made")).toBeInTheDocument();
    expect(within(section).getByText("We don't have the text for that chapter yet — please try another chapter.")).toBeInTheDocument();
  });

  it("failed row: Try again re-sends the same request and the row goes back to writing", async () => {
    const user = renderPage();
    await makePaper(user);
    const sent = api.generateAssessment.mock.calls[0][0];
    api.getAssessmentStatus.mockResolvedValue({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    await advance(4000);
    await user.click(papersTab());
    api.generateAssessment.mockResolvedValue({ success: true, requestId: "r2" });
    api.getAssessmentStatus.mockResolvedValue({ success: true, status: "generating" });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.generateAssessment).toHaveBeenCalledTimes(2);
    expect(api.generateAssessment.mock.calls[1][0]).toEqual(sent);
    const section = screen.getByRole("region", { name: "Being made" });
    await waitFor(() => expect(within(section).getByText("Writing…")).toBeInTheDocument());
    expect(within(section).queryByText("Not made")).toBeNull();
    expect(within(papersTab()).getByText("1 being made")).toBeInTheDocument();
  });

  it("failed row: Dismiss removes it, and the Being made section with it", async () => {
    const user = renderPage();
    await makePaper(user);
    api.getAssessmentStatus.mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    await advance(4000);
    await user.click(papersTab());
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("after a refresh a still-writing paper shows in Being made, not as a Create card", async () => {
    sessionStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([{
      requestId: "r9", spec: { grade: 4, subject: "science", questionCount: 15 }, label: LABEL,
      startedAt: Date.now(), status: "writing",
    }]));
    const user = renderPage();
    await screen.findByRole("button", { name: "Generate" });
    expect(screen.queryByRole("heading", { name: "Writing your paper" })).toBeNull();
    expect(within(papersTab()).getByText("1 being made")).toBeInTheDocument();
    await user.click(papersTab());
    expect(within(screen.getByRole("region", { name: "Being made" })).getByText(LABEL)).toBeInTheDocument();
    expect(api.getAssessmentStatus).toHaveBeenCalledWith("r9");
  });

  it("generator off: the coming-soon message and no tabs", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: "Being prepared" } } as never);
    renderPage();
    expect(await screen.findByText("Being prepared")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
