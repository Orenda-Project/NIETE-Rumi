/**
 * bd-3wb0s — the public account-deletion page Google Play links to.
 *
 * Play rejected the NIETE app's Data safety form with "Invalid account deletion
 * link". Its rule: a PUBLIC web page where someone can ask for their account
 * and data to be deleted WITHOUT the app and WITHOUT logging in, naming the
 * app/developer ("NIETE"), with the steps shown prominently, and saying what is
 * kept afterwards and for how long.
 *
 * Every test here mounts the app's REAL route table (App.tsx) at the URL, not
 * the page component on its own. A page that renders perfectly but is not
 * routed — or is routed behind PortalLayout, which bounces a signed-out visitor
 * to /portal/login — fails Play's check just the same, and a test that renders
 * the component directly cannot see either mistake.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";

import App from "@/App";
import { portal } from "../services/api";

// jsdom has no matchMedia, and the app shell's toaster (sonner) reads it on
// mount. Stubbed here so the whole <App /> can mount, as it does in a browser.
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

const PATH = "/portal/delete-account";
const PRIVACY_URL = "https://taleemabad.com/privacy-policy/";

function renderAppAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

let getDashboard: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Signed out by default: the session check fails the way the server fails it.
  getDashboard = vi
    .spyOn(portal, "getDashboard")
    .mockRejectedValue(Object.assign(new Error("unauthorised"), { response: { status: 401 } }));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("bd-3wb0s — /portal/delete-account is public", () => {
  it("renders for a signed-out visitor, at its own URL, with no login form", async () => {
    renderAppAt(PATH);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" }),
    ).toBeInTheDocument();
    // Still here: not bounced to the login screen.
    await waitFor(() => expect(window.location.pathname).toBe(PATH));
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /log in/i })).toBeNull();
  });

  it("never asks the server who is signed in — it needs no session at all", async () => {
    renderAppAt(PATH);
    await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" });
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it("renders the same page for a signed-in user, without forwarding her to the dashboard", async () => {
    getDashboard.mockResolvedValue({
      user: { id: "u-1", firstName: "Ayesha", role: "teacher" },
    } as unknown as Awaited<ReturnType<typeof portal.getDashboard>>);
    renderAppAt(PATH);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(PATH));
  });
});

describe("bd-3wb0s — what the deletion page says", () => {
  it("names NIETE and the operator, Orenda Welfare Trust (Taleemabad)", async () => {
    renderAppAt(PATH);
    await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" });
    expect(document.body).toHaveTextContent("Orenda Welfare Trust (Taleemabad)");
    expect(document.body).toHaveTextContent("portal.niete.edu.pk");
  });

  it("shows the request steps: email, subject, registered phone number and name", async () => {
    renderAppAt(PATH);
    const steps = await screen.findByTestId("delete-account-steps");
    expect(steps).toHaveTextContent("info@taleemabad.com");
    expect(steps).toHaveTextContent("Delete my NIETE account");
    expect(steps).toHaveTextContent(/phone number/i);
    expect(steps).toHaveTextContent(/name/i);
  });

  it("offers a mailto button with the subject already filled in", async () => {
    renderAppAt(PATH);
    const button = await screen.findByTestId("delete-account-mailto");
    const href = button.getAttribute("href") || "";
    expect(href.startsWith("mailto:info@taleemabad.com?")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Delete my NIETE account");
  });

  it("lists what is deleted", async () => {
    renderAppAt(PATH);
    const deleted = await screen.findByTestId("delete-account-deleted");
    for (const thing of [/account/i, /recordings/i, /transcripts/i, /reports/i, /scores/i, /photos/i, /files/i, /training progress/i]) {
      expect(deleted).toHaveTextContent(thing);
    }
  });

  it("says what may be kept: anonymised totals with no name or phone number", async () => {
    renderAppAt(PATH);
    const kept = await screen.findByTestId("delete-account-kept");
    expect(kept).toHaveTextContent(/totals/i);
    expect(kept).toHaveTextContent(/no name or phone number/i);
  });

  it("gives the timeline: within 30 days, with a confirmation", async () => {
    renderAppAt(PATH);
    const when = await screen.findByTestId("delete-account-timeline");
    expect(when).toHaveTextContent(/within 30 days/i);
    expect(when).toHaveTextContent(/confirm/i);
  });

  it("links the privacy policy on taleemabad.com, opening outside the app", async () => {
    renderAppAt(PATH);
    await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" });
    const link = within(document.body).getByRole("link", { name: /privacy policy/i });
    expect(link).toHaveAttribute("href", PRIVACY_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
