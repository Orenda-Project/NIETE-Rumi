import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-4n7p4 — the old UI's Assessment Generator is its own page (it was a tab of Curriculum).
 * Same content as the tab: the generator, "My papers" under it, or the coming-soon message when
 * the feature is off; nothing at all while /config is still loading.
 */
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
const papersPanel = vi.hoisted(() => vi.fn());
vi.mock("../components/AssessmentGeneratorPanel", () => ({
  default: ({ onPaperReady }: { onPaperReady: () => void }) => <button onClick={onPaperReady}>generator form</button>,
}));
vi.mock("../components/AssessmentPapersPanel", () => ({
  default: (props: { refreshKey: number; editing: boolean }) => { papersPanel(props); return <p>papers panel</p>; },
}));
vi.mock("../components/AssessmentGeneratorComingSoon", () => ({
  default: ({ message }: { message: string | null }) => <p>coming soon: {message}</p>,
}));

import { portal } from "../services/api";
import ClassicAssessment from "./ClassicAssessment";

const config = (features: Record<string, unknown>) =>
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
const renderPage = () => render(<MemoryRouter><ClassicAssessment /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe("ClassicAssessment", () => {
  it("generator on: heading, the form, My papers and the papers panel", async () => {
    config({ assessmentGenerator: true, assessmentEditing: false });
    renderPage();
    expect(await screen.findByText("generator form")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Assessment Generator" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My papers" })).toBeInTheDocument();
    expect(screen.getByText("papers panel")).toBeInTheDocument();
  });

  it("the papers panel gets `editing` from /config", async () => {
    config({ assessmentGenerator: true, assessmentEditing: true });
    renderPage();
    await screen.findByText("papers panel");
    expect(papersPanel).toHaveBeenLastCalledWith(expect.objectContaining({ editing: true }));
  });

  it("a finished paper bumps the papers refresh key", async () => {
    config({ assessmentGenerator: true });
    renderPage();
    const form = await screen.findByText("generator form");
    const before = papersPanel.mock.calls.at(-1)![0].refreshKey;
    form.click();
    await waitFor(() => expect(papersPanel.mock.calls.at(-1)![0].refreshKey).toBe(before + 1));
  });

  it("generator off: the coming-soon message, no form", async () => {
    config({ assessmentGenerator: false, assessmentGeneratorMessage: "Being prepared" });
    renderPage();
    expect(await screen.findByText("coming soon: Being prepared")).toBeInTheDocument();
    expect(screen.queryByText("generator form")).toBeNull();
    expect(screen.queryByText("papers panel")).toBeNull();
  });

  it("while /config is loading: nothing under the heading (no flash of a form that is off)", async () => {
    vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Assessment Generator" })).toBeInTheDocument();
    expect(screen.queryByText("generator form")).toBeNull();
    expect(screen.queryByText(/coming soon/)).toBeNull();
  });
});
