import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";

vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "H", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
const sw = vi.hoisted(() => ({ on: false }));
vi.mock("../../lib/lessonPlanSwitch", () => ({ useLessonPlanOpen: () => sw.on }));
vi.mock("../../components/LessonPlanSheet", () => ({
  default: ({ view }: any) => <div data-testid="lesson-plan-sheet">{JSON.stringify(view.source)}</div>,
}));
import { LessonPlanRow, LessonPlanOpen } from "./PlanState";

/**
 * bd-kijmb8 (queue #318) — the observation page's Lesson plan button: with the switch off every page is as it was (the flat,
 * untappable row for her own plan; nothing for a library plan); on, one button opens whichever plan is linked.
 */
const OWN = { source: "own", format: "jpg", state: "read", topic: "Place value", openable: true, fileKind: "image", title: null } as const;
const LIB = { source: "library", format: null, state: null, topic: null, openable: true, fileKind: "pdf", title: null } as const;

beforeEach(async () => {
  sw.on = false;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("switch off", () => {
  it("her own plan is the flat row, no button; a library plan shows nothing", () => {
    const { rerender } = render(<LessonPlanRow lp={OWN as any} sessionId="cs-1" />);
    expect(screen.getByTestId("lesson-plan-row")).toBeInTheDocument();
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
    rerender(<LessonPlanRow lp={LIB as any} sessionId="cs-1" />);
    expect(screen.queryByTestId("lesson-plan-row")).toBeNull();
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
  });
});

describe("switch on", () => {
  beforeEach(() => { sw.on = true; });
  it("a library plan: Lesson plan · NIETE plan · Open, opens the session's plan over the page", () => {
    render(<LessonPlanRow lp={LIB as any} sessionId="cs-1" />);
    const b = screen.getByTestId("lesson-plan-open");
    expect(b).toHaveTextContent("Lesson plan");
    expect(b).toHaveTextContent("NIETE plan");
    expect(b).toHaveTextContent("Open");
    fireEvent.click(b);
    expect(screen.getByTestId("lesson-plan-sheet")).toHaveTextContent('"lane":"session"');
    expect(screen.getByTestId("lesson-plan-sheet")).toHaveTextContent('"sessionId":"cs-1"');
  });
  it("her own plan (read): the button replaces the flat row, with her topic", () => {
    render(<LessonPlanRow lp={OWN as any} sessionId="cs-1" />);
    expect(screen.getByTestId("lesson-plan-open")).toHaveTextContent("Place value");
    expect(screen.getByTestId("lesson-plan-open")).toHaveTextContent("Teacher's own plan");
    expect(screen.queryByTestId("lesson-plan-row")).toBeNull();
  });
  it("her own plan not read yet: the button AND the reading state", () => {
    render(<LessonPlanRow lp={{ ...OWN, state: "unreadable", topic: null } as any} sessionId="cs-1" />);
    expect(screen.getByTestId("lesson-plan-open")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-plan-row")).toBeInTheDocument();
  });
  it("no plan linked, or not openable: no button", () => {
    const { rerender } = render(<LessonPlanOpen lp={{ source: "none", format: null, state: null, topic: null, openable: false } as any} sessionId="cs-1" />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
    rerender(<LessonPlanOpen lp={undefined} sessionId="cs-1" />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
    rerender(<LessonPlanOpen lp={{ ...LIB, openable: undefined } as any} sessionId="cs-1" />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
  });
  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<LessonPlanRow lp={LIB as any} sessionId="cs-1" />);
    expect(screen.getByTestId("lesson-plan-open")).toHaveTextContent("لیسن پلان");
    expect(screen.getByTestId("lesson-plan-open")).toHaveTextContent("کھولیں");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
