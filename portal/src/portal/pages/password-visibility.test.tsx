import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-2668: password fields get a show/hide (eye) toggle.
//
// Login and Setup were the two screens still typing blind. Setup is the worse
// of the two — an 8-char-plus-a-digit password, typed twice, with no way to
// see either attempt; "Passwords do not match" is all the feedback you get,
// and it cannot tell you WHICH one you fat-fingered. On a phone keyboard that
// is a real dead end.
//
// PortalPasswordResetVerify already had this toggle, so the pattern here is
// copied from it rather than invented: the input type flips between
// 'password' and 'text', and the button sits absolutely inside a relative
// wrapper. The assertions below are on the input's TYPE attribute, which is
// what actually determines whether the characters are masked — asserting on
// the icon would pass even if the wiring were broken.
//
// Setup gets ONE toggle driving both fields, matching the reset screen: the
// point is to compare the two entries against each other, which a per-field
// toggle makes harder, not easier.

// bd-2569 gates PortalLogin on the session: it renders nothing at all while
// the session is resolving, and redirects if there IS one. So the form only
// exists for a resolved-and-signed-out visitor — which is exactly who needs
// to type a password.
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: vi.fn(), user: null, loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  auth: {
    validateToken: vi.fn().mockResolvedValue({
      success: true,
      user: { firstName: "Ayesha", lastName: "Khan", phoneNumber: "923001234567" },
    }),
    setup: vi.fn(),
  },
}));

import PortalLogin from "./PortalLogin";
import PortalSetup from "./PortalSetup";

const renderAt = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("PortalLogin — password visibility toggle (bd-2668)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("masks the password by default", () => {
    renderAt(<PortalLogin />);
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
  });

  it("reveals the password when the toggle is pressed, and re-masks on a second press", async () => {
    const user = userEvent.setup();
    renderAt(<PortalLogin />);
    const input = screen.getByLabelText(/^password$/i);
    const toggle = screen.getByRole("button", { name: /show password/i });

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");

    // The accessible name has to flip too — a button that still announces
    // "Show password" while the password is visible misleads a screen reader.
    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps whatever was typed when visibility flips", async () => {
    const user = userEvent.setup();
    renderAt(<PortalLogin />);
    const input = screen.getByLabelText(/^password$/i) as HTMLInputElement;

    await user.type(input, "secret123");
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(input.value).toBe("secret123");
  });

  it("does not submit the form — the toggle is type=button", async () => {
    // A bare <button> inside a <form> defaults to type=submit, which would
    // fire a login attempt every time someone peeked at their password.
    renderAt(<PortalLogin />);
    expect(screen.getByRole("button", { name: /show password/i })).toHaveAttribute("type", "button");
  });
});

describe("PortalSetup — password visibility toggle (bd-2668)", () => {
  beforeEach(() => vi.clearAllMocks());

  // Setup reads its token from the URL and validates it before rendering the
  // form at all, so this has to mount at a real :token route — a bare render
  // leaves token undefined, which bounces straight to /portal/login and there
  // is never a password field to test. The fields appear only once that
  // validation promise resolves.
  const renderSetup = async () => {
    render(
      <MemoryRouter initialEntries={["/portal/setup/tok-123"]}>
        <Routes>
          <Route path="/portal/setup/:token" element={<PortalSetup />} />
        </Routes>
      </MemoryRouter>,
    );
    return screen.findByLabelText(/^password$/i);
  };

  it("masks both fields by default", async () => {
    await renderSetup();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("type", "password");
  });

  it("reveals BOTH fields from the one toggle", async () => {
    // Both, deliberately: the failure this fixes is "these two don't match and
    // I can't see why", which needs them visible at the same time.
    const user = userEvent.setup();
    await renderSetup();

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "text");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("type", "password");
  });

  it("does not submit the form — the toggle is type=button", async () => {
    await renderSetup();
    expect(screen.getByRole("button", { name: /show password/i })).toHaveAttribute("type", "button");
  });
});
