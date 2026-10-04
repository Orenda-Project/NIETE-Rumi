import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-3wb0s — the login screen carries a small footer: "Privacy policy ·
 * Delete account". It is the one screen every user of the app sees, signed in
 * or not, and someone who no longer remembers her password still needs a way
 * to ask for her account to be deleted.
 *
 * Both are the portal's own public pages and open inside the app. bd-nvnf2:
 * the privacy policy used to be taleemabad.com's, which Play rejected for not
 * naming the app or its developer.
 */

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: vi.fn(), user: null, loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PortalLogin from "./PortalLogin";

describe("bd-3wb0s — the login screen's legal footer", () => {
  it("links the NIETE privacy policy inside the app", () => {
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    const footer = screen.getByTestId("login-legal-footer");
    const link = within(footer).getByRole("link", { name: "Privacy policy" });
    expect(link).toHaveAttribute("href", "/portal/privacy");
    expect(link).not.toHaveAttribute("target");
  });

  it("links the account-deletion page inside the app", () => {
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    const footer = screen.getByTestId("login-legal-footer");
    const link = within(footer).getByRole("link", { name: "Delete account" });
    expect(link).toHaveAttribute("href", "/portal/delete-account");
    expect(link).not.toHaveAttribute("target");
  });

  it("reads 'Privacy policy · Delete account'", () => {
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    expect(screen.getByTestId("login-legal-footer")).toHaveTextContent("Privacy policy · Delete account");
  });
});
