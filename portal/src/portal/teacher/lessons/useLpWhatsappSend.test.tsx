import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Send on WhatsApp on the plan screen follows GET /config features.lpWhatsappSend: a real `false` (her programme's
 * lesson-plan PDF is off on WhatsApp) hides the button. Anything else — true, no field (an older server), a failed
 * read — is today: the button shows, greyed until a template is configured. Open in another app is never touched.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: ({ view }: { view: { title: string } }) => <div data-testid="viewer">{view.title}</div>,
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import api, { portal } from "../../services/api";
import { forgetConfig } from "../../lib/useNewUi";
import { resetShareAvailability } from "../share/api";
import { useLpWhatsappSend } from "./useLpWhatsappSend";
import { ViewerPage } from "./ViewerPage";
import { LESSONS_VIEWER } from "./paths";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const getConfig = portal.getConfig as unknown as ReturnType<typeof vi.fn>;
const withFeatures = (features: Record<string, unknown>) => getConfig.mockResolvedValue({ success: true, features });

beforeEach(() => {
  vi.clearAllMocks();
  forgetConfig();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => (url === "/share/availability" ? { data: { kinds: { lesson: true } } } : { data: {} }));
});

describe("useLpWhatsappSend", () => {
  it("null while /config is read, then false only for a real false", async () => {
    withFeatures({ lpWhatsappSend: false });
    const { result } = renderHook(() => useLpWhatsappSend());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(false));
  });

  it.each([
    ["true", { lpWhatsappSend: true }],
    ["no field (an older server)", {}],
    ["a string", { lpWhatsappSend: "false" }],
  ])("%s → true (today)", async (_label, features) => {
    withFeatures(features);
    const { result } = renderHook(() => useLpWhatsappSend());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("a failed read → true (today)", async () => {
    getConfig.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useLpWhatsappSend());
    await waitFor(() => expect(result.current).toBe(true));
  });
});

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: LESSONS_VIEWER, state: { lessonPlan: { source: { lane: "g612", renderId: "R9" }, title: "Speed" } } }]}>
      <Routes>
        <Route path={LESSONS_VIEWER} element={<ViewerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the plan screen", () => {
  it("lpWhatsappSend false: no Send on WhatsApp; Open in another app stays", async () => {
    withFeatures({ teacherV2: true, lpWhatsappSend: false });
    renderViewer();
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("share-send")).toBeNull());
    expect(screen.getByTestId("share-open")).toBeTruthy();
  });

  it("lpWhatsappSend true: Send on WhatsApp as today", async () => {
    withFeatures({ teacherV2: true, lpWhatsappSend: true });
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("share-send")).not.toBeDisabled());
  });

  it("no field: Send on WhatsApp as today", async () => {
    withFeatures({ teacherV2: true });
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("share-send")).not.toBeDisabled());
  });
});
