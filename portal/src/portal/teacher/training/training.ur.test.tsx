import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — Training in Urdu: the v2 pages' own words (TRAINING) and the new UI's training words they
 * reuse (TRAINING_INNER — the same keys as newui TRAINING_COPY, translated on the v2 side so today's new-UI
 * pages are unchanged) follow the page's language. Provider, level and course names stay as the API sends
 * them. MACHINE-DRAFTED Urdu from the bot's (ٹریننگ، ماڈیول، امتحان، کوئز، جاری رکھیں، درجہ).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import api from "../../services/api";
import { TrainingHub } from "./TrainingHub";
import { LoadState } from "./TrainingFrame";
import { CertificateCardV2 } from "./parts";
import { TRAINING_V2_COPY_UR as U, TRAINING_INNER_UR as TU } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url.includes("vendors")) return { data: { vendors: [] } };
    if (url.includes("levels")) return { data: { levels: [] } };
    if (url.includes("certificates")) return { data: { certificates: [] } };
    return { data: {} };
  });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

describe("Training in Urdu", () => {
  it("the hub: its title and its empty state in Urdu", async () => {
    render(<MemoryRouter><TrainingHub /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.title);
    expect(await screen.findByText(U.nothingYet)).toBeTruthy();
    expect(screen.queryByText("No training yet")).toBeNull();
  });

  it("a failed load: the message and Try again in Urdu", () => {
    render(<MemoryRouter><LoadState loading={false} failed onRetry={() => {}} /></MemoryRouter>);
    expect(screen.getByText(U.loadFailed)).toBeTruthy();
    expect(screen.getByRole("button", { name: U.tryAgain })).toBeTruthy();
  });

  it("a reused new-UI word (the certificate's Download) in Urdu", () => {
    render(<MemoryRouter><CertificateCardV2 certificate={{ certificate_code: "C-1", level_name: "Aspiring" }} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: TU.download })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
});
