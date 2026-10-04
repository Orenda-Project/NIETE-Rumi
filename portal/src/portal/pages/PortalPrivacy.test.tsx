/**
 * bd-nvnf2 — the NIETE privacy policy, at a public URL on the portal.
 *
 * Google Play rejected the NIETE app (pk.edu.niete) with "Invalid Privacy
 * policy — App or developer details don't match": the policy it linked,
 * taleemabad.com/privacy-policy/, never names the app or the developer on the
 * store listing. Play compares the policy against the listing literally, so the
 * page has to name the app ("NIETE"), the developer name ("NIETE") and the
 * legal entity on the developer account ("ORENDA PRIVATE LIMITED", from Play
 * Console > Developer account > About you).
 *
 * Like the deletion page, every test mounts the app's REAL route table at the
 * URL: a policy that is not routed, or is routed behind PortalLayout (which
 * bounces a signed-out visitor to the login form), fails Play's check too.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";

import App from "@/App";
import { portal } from "../services/api";

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

const PATH = "/portal/privacy";
const HEADING = "NIETE Privacy Policy";

function renderAppAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

async function policyPage() {
  await screen.findByRole("heading", { level: 1, name: HEADING });
  return document.body;
}

let getDashboard: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getDashboard = vi
    .spyOn(portal, "getDashboard")
    .mockRejectedValue(Object.assign(new Error("unauthorised"), { response: { status: 401 } }));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("bd-nvnf2 — /portal/privacy is public", () => {
  it("renders for a signed-out visitor, at its own URL, with no login form", async () => {
    renderAppAt(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: HEADING })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(PATH));
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /log in/i })).toBeNull();
  });

  it("never asks the server who is signed in", async () => {
    renderAppAt(PATH);
    await policyPage();
    expect(getDashboard).not.toHaveBeenCalled();
  });
});

describe("bd-nvnf2 — it names the app, developer and legal entity on the Play listing", () => {
  it("says which app, package, developer name and legal entity it covers, up top", async () => {
    renderAppAt(PATH);
    await policyPage();
    const identity = screen.getByTestId("privacy-identity");
    expect(identity).toHaveTextContent(/NIETE app/);
    expect(identity).toHaveTextContent("pk.edu.niete");
    expect(identity).toHaveTextContent(/developer name\W+NIETE/i);
    expect(identity).toHaveTextContent("ORENDA PRIVATE LIMITED");
    expect(identity).toHaveTextContent("134, Street 7, PMCHS, E-11/2, Islamabad 44000, Pakistan");
    expect(identity).toHaveTextContent("National Institute of Excellence in Teacher Education");
  });

  it("shows when it was last updated", async () => {
    renderAppAt(PATH);
    await policyPage();
    expect(screen.getByTestId("privacy-updated")).toHaveTextContent(/Last updated: \d{1,2} \w+ 20\d\d/);
  });
});

describe("bd-nvnf2 — what the policy covers", () => {
  const SECTIONS = [
    "What we collect",
    "How we use it",
    "Who processes it for us",
    "Who can see it",
    "App permissions",
    "How we protect it",
    "How long we keep it, and deleting it",
    "Children",
    "Changes to this policy",
    "Contact us",
  ];

  it.each(SECTIONS)("has a '%s' section", async (title) => {
    renderAppAt(PATH);
    await policyPage();
    expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
  });

  it("points deletion at the public deletion page, with the same mailbox and timeline", async () => {
    renderAppAt(PATH);
    await policyPage();
    const deletion = screen.getByTestId("privacy-deletion");
    const link = within(deletion).getByRole("link", { name: /delete your niete account/i });
    expect(link).toHaveAttribute("href", "/portal/delete-account");
    expect(link).not.toHaveAttribute("target");
    expect(deletion).toHaveTextContent("info@taleemabad.com");
    expect(deletion).toHaveTextContent("30 days");
  });

  it("gives a contact that names the legal entity and an email", async () => {
    renderAppAt(PATH);
    await policyPage();
    const contact = screen.getByTestId("privacy-contact");
    expect(contact).toHaveTextContent("ORENDA PRIVATE LIMITED");
    expect(within(contact).getByRole("link", { name: "info@taleemabad.com" })).toHaveAttribute(
      "href",
      "mailto:info@taleemabad.com",
    );
  });

  it("says plainly that we do not sell data or show ads", async () => {
    renderAppAt(PATH);
    await policyPage();
    expect(document.body).toHaveTextContent(/we do not sell/i);
    expect(document.body).toHaveTextContent(/no advertising|no ads/i);
  });
});
