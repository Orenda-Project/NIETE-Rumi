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
    // bd-x7aprz.3: the set-up page no longer sets a password; a dead link shows its own page.
    setupSignIn: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { response: { status: 400, data: {} } })),
  },
}));

import PortalLogin from "./PortalLogin";
import PortalSetup from "./PortalSetup";

const renderAt = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

// bd-x7aprz.3: the login opens on the WhatsApp code; its password field is behind "Use password instead".
const toPassword = () => userEvent.setup().click(screen.getByRole("button", { name: /use password instead/i }));

describe("PortalLogin — password visibility toggle (bd-2668)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("masks the password by default", async () => {
    renderAt(<PortalLogin />);
    await toPassword();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
  });

  it("reveals the password when the toggle is pressed, and re-masks on a second press", async () => {
    const user = userEvent.setup();
    renderAt(<PortalLogin />);
    await toPassword();
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
    await toPassword();
    const input = screen.getByLabelText(/^password$/i) as HTMLInputElement;

    await user.type(input, "secret123");
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(input.value).toBe("secret123");
  });

  it("does not submit the form — the toggle is type=button", async () => {
    // A bare <button> inside a <form> defaults to type=submit, which would
    // fire a login attempt every time someone peeked at their password.
    renderAt(<PortalLogin />);
    await toPassword();
    expect(screen.getByRole("button", { name: /show password/i })).toHaveAttribute("type", "button");
  });
});

// bd-x7aprz.3: the set-up page sets no password any more (an old link signs her in, or offers a new one), so its
// two-field toggle has nothing to toggle. What stays true: it shows no password field at all.
describe("PortalSetup — no password fields any more", () => {
  it("a dead set-up link shows no password or confirm field", async () => {
    render(
      <MemoryRouter initialEntries={["/portal/setup/tok-123"]}>
        <Routes>
          <Route path="/portal/setup/:token" element={<PortalSetup />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /link expired/i });
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
  });
});
