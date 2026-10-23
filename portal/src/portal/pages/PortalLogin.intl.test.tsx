import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A coach whose mobile is not Pakistani could not sign in on this page: anything that was not a PK mobile got "Check
 * the number", though the server takes 10-15 digit international numbers. Behind portal_login_intl_numbers (off by
 * default) such a number, written with its country code, goes through to the server. Off, the page is unchanged.
 */
const login = vi.fn();
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ login, user: null, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const getConfig = vi.fn();
vi.mock("../services/api", () => ({ portal: { getConfig: () => getConfig() } }));

import PortalLogin from "./PortalLogin";

async function signIn(number: string) {
  render(<MemoryRouter><PortalLogin /></MemoryRouter>);
  await waitFor(() => expect(getConfig).toHaveBeenCalled());
  await Promise.resolve();
  fireEvent.change(document.getElementById("phoneNumber")!, { target: { value: number } });
  fireEvent.change(document.getElementById("password")!, { target: { value: "secret123" } });
  fireEvent.submit(document.querySelector("form")!);
}

describe("the teacher sign-in takes an international number behind its switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    login.mockResolvedValue({ success: false, status: 401 });
  });

  it("switch on: a +254 number is sent to the server", async () => {
    getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, loginIntlNumbers: true } });
    await signIn("+254 700 000 001");
    await waitFor(() => expect(login).toHaveBeenCalledWith("+254 700 000 001", "secret123"));
  });

  it("switch off: the same number is held with 'Check the number', as before", async () => {
    getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null } });
    await signIn("+254 700 000 001");
    expect(await screen.findByText("Check the number")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("switch on: a PK number with a dropped digit is still held", async () => {
    getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, loginIntlNumbers: true } });
    await signIn("0300 123456");
    expect(await screen.findByText("Check the number")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });
});
