import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "C", role: "coach" }, loading: false, logout: vi.fn() }) }));
vi.mock("../../services/api", () => ({ coach: { reportIssue: vi.fn() } }));
import { coach } from "../../services/api";
import CoachReport from "./CoachReport";

/**
 * bd-whlsm0 — a coach reports an issue from More (operator, 30 Oct: "add a form they can fill on the issues ... collect
 * that feedback"). One question per screen: the kind of issue as four big buttons, then her message and Send.
 */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

async function renderReport(lang: "en" | "ur" = "en") {
  await act(async () => { await i18n.changeLanguage(lang); });
  return render(
    <MemoryRouter initialEntries={["/portal/coach/more/report"]}>
      <Routes>
        <Route path="/portal/coach/more/report" element={<CoachReport />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe("CoachReport", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  });

  it("the kind of issue first, as four big buttons; her message only after she picks one", async () => {
    await renderReport();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Report an issue");
    const kinds = screen.getAllByTestId("report-kind");
    expect(kinds.map((k) => k.textContent)).toEqual(["Something isn't working", "Numbers look wrong", "An idea", "Something else"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(kinds[1]);
    expect(screen.getByTestId("report-chosen")).toHaveTextContent("Numbers look wrong");
    expect(within(screen.getByTestId("report-chosen")).getByRole("button", { name: /^Change/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "   ");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("Send posts the kind and her words; then Sent, Thank you, and a way back to More", async () => {
    vi.mocked(coach.reportIssue).mockResolvedValue({ success: true });
    await renderReport();
    await userEvent.click(screen.getAllByTestId("report-kind")[1]);
    await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "8/21 does not match my visits");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(coach.reportIssue).toHaveBeenCalledTimes(1);
    expect(coach.reportIssue).toHaveBeenCalledWith({ kind: "numbers", message: "8/21 does not match my visits" });
    const sent = await screen.findByTestId("report-sent");
    expect(sent).toHaveTextContent("Sent");
    expect(sent).toHaveTextContent("Thank you");
    expect(within(sent).getByRole("link", { name: "More" })).toHaveAttribute("href", "/portal/coach/more");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a failed send keeps her words and offers Try again", async () => {
    vi.mocked(coach.reportIssue).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ success: true });
    await renderReport();
    await userEvent.click(screen.getAllByTestId("report-kind")[2]);
    await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "A Schools search");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByTestId("report-failed")).toHaveTextContent("Not sent");
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue("A Schools search");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("report-sent")).toBeInTheDocument();
    expect(coach.reportIssue).toHaveBeenCalledTimes(2);
    expect(coach.reportIssue).toHaveBeenLastCalledWith({ kind: "idea", message: "A Schools search" });
  });

  it("Change goes back to the kinds and keeps her message", async () => {
    await renderReport();
    await userEvent.click(screen.getAllByTestId("report-kind")[0]);
    await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "The report did not open");
    await userEvent.click(screen.getByRole("button", { name: /^Change/ }));
    expect(screen.getAllByTestId("report-kind")).toHaveLength(4);
    await userEvent.click(screen.getAllByTestId("report-kind")[3]);
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue("The report did not open");
  });

  it("in Urdu, every word is Urdu", async () => {
    await renderReport("ur");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("مسئلہ بتائیں");
    expect(screen.getAllByTestId("report-kind").map((k) => k.textContent)).toEqual(["کچھ خراب ہے", "اعداد غلط ہیں", "ایک تجویز", "کچھ اور"]);
  });
});
