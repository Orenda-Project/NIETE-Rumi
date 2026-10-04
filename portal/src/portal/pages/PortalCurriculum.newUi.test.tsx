import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";

/**
 * bd-5rz1v.14 — which page /portal/curriculum is. With `portal_new_ui` on, a teacher's "Lessons"
 * is the new Lesson Plans (newui/lessons). The Assessment tab (?tab=assessment, the menu's
 * Assessment item until it has its own page) stays the old page, as does a leader's visit.
 * Flag off is pinned byte for byte in PortalCurriculum.flagOff.test.tsx.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(async (url: string) => ({ data: url.endsWith("/grades") ? { grades: [{ grade: 4 }] } : { lessons: [] } })), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
vi.mock("../newui/lessons/NewLessonPlans", () => ({ default: () => <h1>new Lesson Plans</h1> }));

import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalCurriculum from "./PortalCurriculum";

function signIn(role: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u-1", firstName: "Ayesha", role, phoneNumber: `92300000${role.length}` },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderAt(path: string, newUi: boolean) {
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi } } as never);
  return render(<MemoryRouter initialEntries={[path]}><PortalCurriculum /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
});

describe("/portal/curriculum with the new UI on", () => {
  it("a teacher gets the new Lesson Plans", async () => {
    signIn("teacher");
    renderAt("/portal/curriculum", true);
    expect(await screen.findByRole("heading", { name: "new Lesson Plans" })).toBeInTheDocument();
    expect(screen.queryByText("Curriculum Library")).toBeNull();
  });

  it("?tab=assessment is still the old page's Assessment tab, untouched", async () => {
    signIn("teacher");
    renderAt("/portal/curriculum?tab=assessment", true);
    expect(await screen.findByRole("tab", { name: "Assessment Generator", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "new Lesson Plans" })).toBeNull();
  });

  it("a leader keeps the old page (as Home does)", async () => {
    signIn("principal");
    renderAt("/portal/curriculum", true);
    expect(await screen.findByText("Curriculum Library")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "new Lesson Plans" })).toBeNull();
  });
});
