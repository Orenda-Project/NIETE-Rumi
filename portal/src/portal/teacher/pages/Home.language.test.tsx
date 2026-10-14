import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("i18next", () => {
  const handlers: Array<() => void> = [];
  const i18n = {
    language: "en",
    on: (_e: string, h: () => void) => { handlers.push(h); },
    off: () => {},
    changeLanguage: vi.fn(async (lng: string) => { i18n.language = lng; handlers.forEach((h) => h()); }),
  };
  return { default: i18n };
});
import i18n from "i18next";
import api, { language } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import Home from "./Home";

/**
 * The English | اردو switch at the top of Home (operator, 14 Oct 2026: design doc option B). It is More's own
 * Language toggle (the kit Tabs, the same single writer, the same "Not saved"), placed full width in the NIETE
 * band under the date and her school. More keeps its row.
 */
function renderHome() {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Ayesha Bibi", lastName: null, role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
}

describe("teacher v2 Home: the language switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (i18n as unknown as { language: string }).language = "en";
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, items: [] } } as never);
    vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
    vi.mocked(language.set).mockResolvedValue(undefined);
  });

  it("sits in the band under the date and school: English | اردو, the current one picked", () => {
    renderHome();
    const band = screen.getByTestId("home-greeting");
    const tabs = within(band).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["English", "اردو"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    const school = within(band).getByTestId("home-school");
    expect(school.compareDocumentPosition(within(band).getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("picking اردو saves through the one writer, then switches the page", async () => {
    renderHome();
    await userEvent.setup().click(within(screen.getByTestId("home-greeting")).getByRole("tab", { name: "اردو" }));
    await waitFor(() => expect(language.set).toHaveBeenCalledWith("ur"));
    await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalledWith("ur"));
  });

  it("picking the language already shown writes nothing", async () => {
    renderHome();
    await userEvent.setup().click(within(screen.getByTestId("home-greeting")).getByRole("tab", { name: "English" }));
    expect(language.set).not.toHaveBeenCalled();
  });

  it("a failed save keeps the page's language and says Not saved, in the band", async () => {
    vi.mocked(language.set).mockRejectedValue(new Error("400"));
    renderHome();
    await userEvent.setup().click(within(screen.getByTestId("home-greeting")).getByRole("tab", { name: "اردو" }));
    await waitFor(() => expect(language.set).toHaveBeenCalled());
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(await within(screen.getByTestId("home-greeting")).findByText("Not saved")).toBeInTheDocument();
  });

  it("the tiles still climb into the band (the switch is inside it, not between the band and the tiles)", () => {
    renderHome();
    const tiles = screen.getByTestId("feature-tiles");
    expect(tiles.className).toMatch(/\bfirst:-mt-10\b/);
    expect(tiles.parentElement?.firstElementChild).toBe(tiles);
  });
});
