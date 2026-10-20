import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf Atif", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn() } }));
vi.mock("../../lib/useChildTest", () => ({ useChildTest: vi.fn(() => false) }));
import { coach } from "../../services/api";
import CoachHome from "../pages/CoachHome";
import { useChildTest } from "../../lib/useChildTest";

/**
 * bd-4404s7.2 — coach Home on the kit (Coach_Home / Coach_HomeBusy / Coach_Home_Urdu): the NIETE band (no school row,
 * rounded bottom), the reports-waiting banner, today's visits with TimeStamps (the current one expanded with Take
 * observation), the four feature tiles with the kit's art, in English and Urdu.
 */
const HOME = {
  today: [
    { id: "v1", teacherName: "Mehwish Khan", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "09:00", status: "done", current: false },
    { id: "v2", teacherName: "Ayesha Bibi", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", current: true },
    { id: "v3", teacherName: "Rabia Saleem", schoolName: "IMCG F-7/2", scheduledFor: "2026-10-06", scheduledSlot: "14:00", status: "upcoming", current: false },
  ],
  counts: { week: 6, overdue: 1, waiting: 2, inProgress: 2, teachers: 24, schools: 12 },
};

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach"]}>
      <Routes><Route path="/portal/coach" element={<CoachHome />} /></Routes>
    </MemoryRouter>,
  );
}
const lang = async (l: "en" | "ur") => { await act(async () => { await i18n.changeLanguage(l); }); };

describe("CoachHome (kit)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await lang("en");
    (coach as any).getHome.mockResolvedValue({ success: true, home: HOME });
  });

  it("the NIETE band: her whole name with '!', no school row, rounded bottom corners", async () => {
    renderHome();
    const band = await screen.findByTestId("home-greeting");
    expect(within(band).getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Hataf Atif!");
    expect(within(band).getByTestId("home-date")).toBeInTheDocument();
    expect(screen.queryByTestId("home-school")).toBeNull();
    expect(band.className).toContain("rounded-b-[28px]");
  });

  it("reports waiting: one amber banner that opens Reports; none when nothing waits", async () => {
    const first = renderHome();
    const banner = await screen.findByTestId("reports-waiting");
    expect(banner).toHaveTextContent("2 reports waiting");
    expect(banner).toHaveAttribute("href", "/portal/coach/reports?show=waiting");
    first.unmount();
    (coach as any).getHome.mockResolvedValue({ success: true, home: { ...HOME, counts: { ...HOME.counts, waiting: 0 } } });
    renderHome();
    await screen.findByTestId("feature-tiles");
    expect(screen.queryByTestId("reports-waiting")).toBeNull();
  });

  it("today's visits: a count, TimeStamps, the current one expanded with Take observation", async () => {
    renderHome();
    const current = await screen.findByTestId("visit-current");
    expect(current).toHaveTextContent("Ayesha Bibi");
    expect(within(current).getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(within(current).getByRole("link", { name: /Take observation/ })).toHaveAttribute("href", "/portal/coach/visit/v2");
    expect(screen.getByTestId("todays-visits")).toHaveTextContent("3");
    const later = screen.getByText("Rabia Saleem").closest("a") as HTMLElement;
    expect(later).toHaveAttribute("href", "/portal/coach/visit/v3");
    expect(within(later).getByRole("img", { name: "2:00 PM" })).toBeInTheDocument();
    const done = screen.getByText("Mehwish Khan").closest("a") as HTMLElement;
    expect(within(done).getByRole("img", { name: "9:00 AM" })).toHaveAttribute("data-tone", "done");
    expect(done).toHaveTextContent("Done");
  });

  it("five kit tiles: Schedule rose, Observe, Schools teal, Training, Analytics (wide, bd-fmf24g.33); chips from the counts only", async () => {
    renderHome();
    const tiles = within(await screen.findByTestId("feature-tiles"));
    const art = (a: HTMLElement) => a.querySelector("svg[data-feature-art]")?.getAttribute("data-feature-art");
    const links = tiles.getAllByRole("link");
    expect(links.map(art)).toEqual(["schedule", "observations", "schools", "training", "reports"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/scheduling", "/portal/coach/observe", "/portal/coach/people", "/portal/training", "/portal/coach/analytics",
    ]);
    expect(links[4]).toHaveTextContent(/^Analytics$/);
    expect(links[4].className).toMatch(/col-span-2/);
    expect(links[0]).toHaveTextContent("6 this week");
    expect(links[1]).toHaveTextContent("2 waiting");
    expect(links[2]).toHaveTextContent("24 teachers");
    expect(links[3]).toHaveTextContent(/^Training$/);
  });

  it("the child test, off by default, is a row under the tiles when her flag is on (it left More)", async () => {
    const first = renderHome();
    await screen.findByTestId("feature-tiles");
    expect(screen.queryByTestId("more-row-child-test")).toBeNull();
    first.unmount();
    vi.mocked(useChildTest).mockReturnValue(true);
    renderHome();
    expect(await screen.findByTestId("more-row-child-test")).toHaveAttribute("href", "/portal/leader/child-test");
  });

  it("no visits today: tiles still show and the count is a quiet 0", async () => {
    (coach as any).getHome.mockResolvedValue({ success: true, home: { ...HOME, today: [] } });
    renderHome();
    expect(await screen.findByTestId("feature-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("todays-visits")).toHaveTextContent("0");
    expect(screen.getByText("No visits")).toBeInTheDocument();
  });

  it("Urdu: the band, banner, headings, tiles and chips follow the language", async () => {
    await lang("ur");
    renderHome();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("السلام علیکم، Hataf Atif!");
    expect(screen.getByTestId("reports-waiting")).toHaveTextContent("2 رپورٹیں منتظر");
    expect(screen.getByText("آج کے دورے")).toBeInTheDocument();
    expect(screen.getByText("مشاہدہ لیں")).toBeInTheDocument();
    const tiles = within(screen.getByTestId("feature-tiles"));
    // The kit isolates digits inside an Urdu chip (U+2066..2069); the words are what is asserted.
    const plain = (w: string) => (_: string, el: Element | null) => el?.children.length === 0 && (el.textContent ?? "").replace(/[\u2066-\u2069]/g, "") === w;
    for (const w of ["شیڈول", "مشاہدہ", "اسکول اور ٹیچرز", "ٹریننگ", "اس ہفتے 6", "2 منتظر", "24 ٹیچرز"]) {
      expect(tiles.getByText(plain(w))).toBeInTheDocument();
    }
    expect(screen.getAllByText("صبح").length).toBeGreaterThan(0);
  });
});
