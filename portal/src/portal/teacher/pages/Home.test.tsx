import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getAssessmentStatus: vi.fn(), generateAssessment: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api from "../../services/api";
import { noticeTracker } from "../notices/tracker";
import { useAuth } from "../../hooks/useAuth";
import Home from "./Home";
import { teacherPath } from "../routes";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main): "Salaam, <full name>!", the date and
 * her school as chips, then one big centred tile per feature — 2 × 3 plus a wide
 * My Classes. No numbers on the tiles (operator: "remove the pills").
 */
function renderHome(user: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
}

const AYESHA = { firstName: "Ayesha Bibi", lastName: null, role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" };

describe("teacher v2 Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, items: [] } } as never);
  });

  it("greets her by her full name, with an exclamation mark", () => {
    renderHome(AYESHA);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Ayesha Bibi!");
  });

  it("joins first and last name when the API splits them", () => {
    renderHome({ ...AYESHA, firstName: "Ayesha", lastName: "Bibi" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Ayesha Bibi!");
  });

  it("no name: just Salaam!", () => {
    renderHome({ ...AYESHA, firstName: "", lastName: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Salaam!$/);
  });

  it("her school is plain text in the band; an unknown school shows nothing (no pill either way)", () => {
    const { unmount } = renderHome(AYESHA);
    expect(screen.getByTestId("home-school")).toHaveTextContent("IMSG I-10/1");
    expect(screen.getByTestId("home-school").className).not.toMatch(/rounded-full|border/);
    unmount();
    renderHome({ ...AYESHA, schoolName: null });
    expect(screen.queryByTestId("home-school")).toBeNull();
  });

  it("the top of Home is option C: the NIETE band with her name, today's date in the long form, and the mark (bd-fmf24g.22)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    try {
      renderHome(AYESHA);
      expect(screen.getByTestId("home-date")).toHaveTextContent("Thursday 8 October");
      expect(screen.getByAltText("NIETE logo")).toBeTruthy();
      expect(screen.getByTestId("home-greeting")).toHaveTextContent("NIETE");
      expect(screen.getByTestId("home-greeting").className).toMatch(/bg-\[#333748\]/);
    } finally { vi.useRealTimers(); }
  });

  it("the band comes first and the tiles climb into it (nothing after it overlaps it by accident)", () => {
    renderHome(AYESHA);
    const band = screen.getByTestId("home-greeting");
    const tiles = screen.getByTestId("feature-tiles");
    expect(band.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tiles.className).toMatch(/\bfirst:-mt-10\b/); // only when nothing sits between the band and them
    expect(tiles.className).toMatch(/\brelative\b/);
    expect(tiles.parentElement?.firstElementChild).toBe(tiles); // nothing finished: the tiles ARE the first thing under the band
  });

  it("seven feature tiles, in the operator's order, each going to its feature", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    expect(tiles.map((a) => a.textContent)).toEqual([
      "Lesson Plans", "Digital Coaching", "Observations", "Training", "Assessment", "Attendance", "My Classes",
    ]);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual([
      teacherPath("lessons"), teacherPath("coaching"), teacherPath("observations"), teacherPath("training"),
      teacherPath("assessment"), teacherPath("attendance"), teacherPath("classes"),
    ]);
  });

  it("My Classes is the wide tile; every tile is a big target with no number on it", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    expect(tiles[6].className).toMatch(/col-span-2/);
    for (const t of tiles) {
      expect(t.className).toMatch(/min-h-\[(176|132)px\]/);
      expect(t.textContent).not.toMatch(/\d/);
    }
  });
  it("each tile shows the kit's D2 illustration (Digital Coaching is the phone), not a stand-in", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    const features = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes"];
    tiles.forEach((t, i) => {
      expect(t.querySelector(`svg[data-feature-art="${features[i]}"]`), features[i]).not.toBeNull();
      expect(t.querySelector("svg.lucide"), `${features[i]} still a lucide stand-in`).toBeNull();
    });
  });

  it("the seven icons play together on arrival and share one timer (bd-fmf24g.18)", () => {
    vi.useFakeTimers();
    try {
      renderHome(AYESHA);
      const nav = screen.getByTestId("feature-tiles");
      const svgs = Array.from(nav.querySelectorAll("svg[data-feature-art]"));
      expect(svgs).toHaveLength(7);
      expect(svgs.map((s) => s.getAttribute("data-motion"))).toEqual(Array(7).fill("arrive"));
      expect(vi.getTimerCount()).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("'Ready for you' stands above the feature tiles when she has finished things she has not opened (bd-fmf24g.15)", async () => {
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, items: [{
      id: "paper:a", kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", chapterNumber: 2, questions: 15,
      startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(3_600_000),
      paperId: "pp-a", renderId: null, lessonId: null, lang: null, errorCode: null,
    }] } } as never);
    renderHome(AYESHA);
    const card = await screen.findByRole("region", { name: "Ready for you" });
    const tiles = screen.getByTestId("feature-tiles");
    expect(card.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/notices");
  });

  it("with 'Ready for you' above them the tiles are not first, so they do not climb (its heading never lands on the navy)", async () => {
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, items: [{
      id: "paper:b", kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", chapterNumber: 2, questions: 15,
      startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(3_600_000),
      paperId: "pp-b", renderId: null, lessonId: null, lang: null, errorCode: null,
    }] } } as never);
    renderHome(AYESHA);
    const card = await screen.findByRole("region", { name: "Ready for you" });
    const tiles = screen.getByTestId("feature-tiles");
    expect(tiles.parentElement?.firstElementChild).toBe(card);
    expect(card.className).not.toMatch(/-mt-/);
  });

  it("and nothing extra when there is nothing finished", async () => {
    renderHome(AYESHA);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/notices"));
    expect(screen.queryByRole("region", { name: "Ready for you" })).toBeNull();
  });
});
