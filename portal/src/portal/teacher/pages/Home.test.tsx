import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../../hooks/useAuth";
import Home from "./Home";
import { teacherPath } from "../routes";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main): "Salaam, <full name>!", the date and
 * her school as chips, then one big centred tile per feature — 2 × 3 plus a wide
 * My Classes. No numbers on the tiles (operator: "remove the pills").
 */
function renderHome(user: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
}

const AYESHA = { firstName: "Ayesha Bibi", lastName: null, role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" };

describe("teacher v2 Home", () => {
  beforeEach(() => vi.clearAllMocks());

  it("greets her by her full name, with an exclamation mark", () => {
    renderHome(AYESHA);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Ayesha Bibi!");
  });

  it("joins first and last name when the API splits them", () => {
    renderHome({ ...AYESHA, firstName: "Ayesha", lastName: "Bibi" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Ayesha Bibi!");
  });

  it("no name: just Salaam!", () => {
    renderHome({ ...AYESHA, firstName: "", lastName: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Salaam!$/);
  });

  it("her school is a chip; an unknown school shows nothing", () => {
    const { unmount } = renderHome(AYESHA);
    expect(screen.getByTestId("home-school")).toHaveTextContent("IMSG I-10/1");
    unmount();
    renderHome({ ...AYESHA, schoolName: null });
    expect(screen.queryByTestId("home-school")).toBeNull();
  });

  it("seven feature tiles, in the operator's order, each going to its feature", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    expect(tiles.map((a) => a.textContent)).toEqual([
      "Lesson Plans", "Digital Coaching", "Observations", "Training", "Assessment", "Attendance", "My Classes",
    ]);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual([
      teacherPath("lessons"), teacherPath("coaching"), teacherPath("observations"), teacherPath("training"),
      teacherPath("assessment"), teacherPath("attendance"), teacherPath("classes"),
    ]);
  });

  it("My Classes is the wide tile; every tile is a big target with no number on it", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    expect(tiles[6].className).toMatch(/col-span-2/);
    for (const t of tiles) {
      expect(t.className).toMatch(/min-h-\[(176|132)px\]/);
      expect(t.textContent).not.toMatch(/\d/);
    }
  });
  it("each tile shows the kit's D2 illustration (Digital Coaching is the phone), not a stand-in", () => {
    renderHome(AYESHA);
    const tiles = within(screen.getByTestId("feature-tiles")).getAllByRole("link");
    const features = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes"];
    tiles.forEach((t, i) => {
      expect(t.querySelector(`svg[data-feature-art="${features[i]}"]`), features[i]).not.toBeNull();
      expect(t.querySelector("svg.lucide"), `${features[i]} still a lucide stand-in`).toBeNull();
    });
  });
});
