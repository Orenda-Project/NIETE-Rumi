/**
 * The Certificates panel on the Training page.
 *
 * Rendered, not grepped. The behaviour that changed with fetch-or-mint is the
 * one worth pinning: EVERY certificate is now downloadable. Before, a
 * certificate whose PDF had never been rendered showed "PDF not available" and
 * was a dead end — and that was every certificate in production, because all
 * 12,954 predate PDF generation. Now the download link points at the portal's
 * own route, which mints on first request.
 *
 * `has_pdf: false` therefore means "not rendered YET", not "not available".
 * The UI says so, so the teacher knows the first click may take a moment
 * rather than thinking it hung.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
// isNativeApp joined this module when the View/Download split landed
// (bd-2676); the mock was never widened, so every test in this file died on
// "No isNativeApp export". Web (false) is the branch these tests assert.
vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: vi.fn(() => "/api/portal"),
  isNativeApp: vi.fn(() => false),
}));
import api from "../services/api";
import { getApiBaseUrl } from "@/lib/runtime";
import CertificatesPanel from "./CertificatesPanel";

/** Point the component at a given API base, as runtime.ts would at build time. */
function mockApiBase(base: string) {
  (getApiBaseUrl as any).mockReturnValue(base);
}

const URL = "/training/certificates";

const RENDERED = {
  id: "cert-new",
  certificate_code: "PFX-20260802-NEW111",
  level_name: "Aspiring Teacher",
  teacher_name: "Amina Khan",
  issued_at: "2026-08-02T10:00:00Z",
  has_pdf: true,
  download_url: "/api/portal/training/certificates/PFX-20260802-NEW111/download",
};

const NOT_YET_RENDERED = {
  id: "cert-old",
  certificate_code: "PFX-L1-20260712-OLD222",
  level_name: "Teacher Leader",
  teacher_name: "Amina Khan",
  issued_at: "2026-07-12T09:00:00Z",
  has_pdf: false,
  download_url: "/api/portal/training/certificates/PFX-L1-20260712-OLD222/download",
};

function mockList(certificates: unknown[]) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === URL) return Promise.resolve({ data: { success: true, certificates } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CertificatesPanel", () => {
  it("shows a button and fetches nothing until it is clicked", () => {
    mockList([]);
    render(<CertificatesPanel />);
    expect(screen.getByTestId("certificates-toggle")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("lists the teacher's certificates on click", async () => {
    mockList([RENDERED, NOT_YET_RENDERED]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(URL));
    const rows = await screen.findAllByTestId("certificate-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("PFX-20260802-NEW111");
    expect(rows[0].textContent).toContain("Aspiring Teacher");
    expect(rows[1].textContent).toContain("PFX-L1-20260712-OLD222");
  });

  it("links the download at the portal route the API supplied", async () => {
    mockList([RENDERED]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const link = await screen.findByTestId("certificate-download");
    expect(link).toHaveAttribute("href", RENDERED.download_url);
  });

  it("EVERY certificate is downloadable, including one never rendered", async () => {
    // The regression this guards: an un-minted certificate used to render a
    // dead "PDF not available" label, which was every certificate in prod.
    mockList([NOT_YET_RENDERED]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const links = await screen.findAllByTestId("certificate-download");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", NOT_YET_RENDERED.download_url);
    expect(screen.queryByText(/not available/i)).toBeNull();
  });

  it("warns that a first download has to be prepared", async () => {
    mockList([NOT_YET_RENDERED]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const row = await screen.findByTestId("certificate-row");
    expect(row.textContent).toMatch(/will be prepared the first time/i);
  });

  it("says nothing about preparing when the PDF already exists", async () => {
    mockList([RENDERED]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const row = await screen.findByTestId("certificate-row");
    expect(row.textContent).not.toMatch(/will be prepared the first time/i);
  });

  it("shows an empty state when the teacher has none", async () => {
    mockList([]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));
    expect(await screen.findByTestId("certificates-empty")).toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    (api.get as any).mockRejectedValue(new Error("500"));
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));
    expect(await screen.findByTestId("certificates-error")).toBeInTheDocument();
  });

  it("collapses again on a second click without refetching", async () => {
    mockList([RENDERED]);
    render(<CertificatesPanel />);
    const toggle = screen.getByTestId("certificates-toggle");

    await userEvent.click(toggle);
    await screen.findAllByTestId("certificate-row");
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.queryAllByTestId("certificate-row")).toHaveLength(0));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  // bd-2397: in the Android app the WebView serves the bundle from
  // https://localhost, so a root-relative href resolves to an origin with no
  // server. The download link went to https://localhost/api/portal/... , the
  // SPA router caught the unknown path, and the teacher got the 404 page whose
  // only action is "Go to portal login" — indistinguishable from being logged
  // out, on a session that was perfectly valid.
  //
  // The server keeps sending a relative path (correct for web, same origin);
  // the anchor is responsible for resolving it against the API base the axios
  // client already uses.
  describe("native builds resolve the download against the API origin (bd-2397)", () => {
    it("makes the href absolute when running in the app", async () => {
      mockApiBase("https://portal.example.com/api/portal");
      mockList([RENDERED]);
      render(<CertificatesPanel />);
      await userEvent.click(screen.getByTestId("certificates-toggle"));

      const link = await screen.findByTestId("certificate-download");
      expect(link.getAttribute("href")).toBe(
        "https://portal.example.com/api/portal/training/certificates/PFX-20260802-NEW111/download"
      );
    });

    it("never points at the WebView origin", async () => {
      mockApiBase("https://portal.example.com/api/portal");
      mockList([RENDERED]);
      render(<CertificatesPanel />);
      await userEvent.click(screen.getByTestId("certificates-toggle"));

      const href = (await screen.findByTestId("certificate-download")).getAttribute("href") ?? "";
      expect(href.startsWith("/")).toBe(false);
      expect(href).not.toMatch(/localhost/);
    });

    it("leaves the web build's relative path alone", async () => {
      // On the web the portal and API share an origin: a relative path avoids
      // CORS and third-party cookies, so it must not be rewritten.
      mockApiBase("/api/portal");
      mockList([RENDERED]);
      render(<CertificatesPanel />);
      await userEvent.click(screen.getByTestId("certificates-toggle"));

      const link = await screen.findByTestId("certificate-download");
      expect(link.getAttribute("href")).toBe(
        "/api/portal/training/certificates/PFX-20260802-NEW111/download"
      );
    });

    it("does not double up the base when the server ever returns an absolute url", async () => {
      mockApiBase("https://portal.example.com/api/portal");
      mockList([{ ...RENDERED, download_url: "https://cdn.example.com/cert.pdf" }]);
      render(<CertificatesPanel />);
      await userEvent.click(screen.getByTestId("certificates-toggle"));

      const link = await screen.findByTestId("certificate-download");
      expect(link.getAttribute("href")).toBe("https://cdn.example.com/cert.pdf");
    });
  });
});
