import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * bd-rj6w0n.14.2 — the one-time ICT-or-GB choice, on the Lesson Plans page she already opens (no WhatsApp
 * question: every message costs money).
 *
 *   GET  /teacher/region  → { region, ask, sectors: string[], schools: [{ id, name }] }   ask only when nothing names her region
 *   POST /teacher/region  { region: 'ict', sector } | { region: 'gb', schoolId? }          saved once, never asked again
 *
 * ICT asks her sector (the region registry's ICT names, so users.region is spelt as the registry spells it).
 *
 * Nothing shows unless ask is true (flag off is a 404, a known region is ask false, a failed read is nothing).
 * GB opens the school picker; Save posts once and the card goes away.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { RegionCard } from "./RegionCard";
import { LESSONS_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const SECTORS = ["B.K", "Sihala", "Tarnol"];
const SCHOOLS = [{ id: "s-1", name: "GBPS Alpha" }, { id: "s-2", name: "GBPS Zeta" }];

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: { success: true, region: "unknown", ask: true, sectors: SECTORS, schools: SCHOOLS } });
  http.post.mockResolvedValue({ data: { success: true, region: "gb", saved: true } });
});

const empty = async (container: HTMLElement) => {
  await waitFor(() => expect(http.get).toHaveBeenCalledWith("/teacher/region"));
  await Promise.resolve();
  expect(container.innerHTML).toBe("");
};

describe("RegionCard", () => {
  it("unknown: the two choices, no school list yet", async () => {
    render(<RegionCard />);
    expect(await screen.findByRole("button", { name: C.region.ict })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.region.gb })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it.each([
    ["known region", { data: { success: true, region: "ict", ask: false, schools: [] } }],
    ["an odd answer", { data: {} }],
  ])("%s: nothing", async (_n, answer) => {
    http.get.mockResolvedValue(answer);
    const { container } = render(<RegionCard />);
    await empty(container);
  });

  it("a failed read (flag off is a 404): nothing, no error", async () => {
    http.get.mockRejectedValue(new Error("404"));
    const { container } = render(<RegionCard />);
    await empty(container);
  });

  it("ICT: the sector picker; no Save until a sector; Save posts it once and the card goes", async () => {
    const { container } = render(<RegionCard />);
    fireEvent.click(await screen.findByRole("button", { name: C.region.ict }));
    const picker = screen.getByRole("combobox", { name: C.region.sector });
    expect(Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([C.region.pick, ...SECTORS]);
    expect((screen.getByRole("button", { name: C.region.save }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(picker, { target: { value: "Sihala" } });
    fireEvent.click(screen.getByRole("button", { name: C.region.save }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith("/teacher/region", { region: "ict", sector: "Sihala" });
  });

  it("GB: the school picker; Save posts the school", async () => {
    const { container } = render(<RegionCard />);
    fireEvent.click(await screen.findByRole("button", { name: C.region.gb }));
    const picker = screen.getByRole("combobox", { name: C.region.school });
    expect(Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([C.region.notListed, "GBPS Alpha", "GBPS Zeta"]);
    fireEvent.change(picker, { target: { value: "s-2" } });
    fireEvent.click(screen.getByRole("button", { name: C.region.save }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(http.post).toHaveBeenCalledWith("/teacher/region", { region: "gb", schoolId: "s-2" });
  });

  it("GB, school not listed: the region alone", async () => {
    render(<RegionCard />);
    fireEvent.click(await screen.findByRole("button", { name: C.region.gb }));
    fireEvent.click(screen.getByRole("button", { name: C.region.save }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/teacher/region", { region: "gb" }));
  });

  it("no Save until she picks a region", async () => {
    render(<RegionCard />);
    await screen.findByRole("button", { name: C.region.ict });
    expect((screen.getByRole("button", { name: C.region.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed save: the card goes anyway, never an error", async () => {
    http.post.mockRejectedValue(new Error("502"));
    const { container } = render(<RegionCard />);
    fireEvent.click(await screen.findByRole("button", { name: C.region.gb }));
    fireEvent.click(screen.getByRole("button", { name: C.region.save }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("is on the Lesson Plans page for teachers, not leaders", async () => {
    const src = (await import("./LessonsHome.tsx?raw")).default as string;
    expect(src).toMatch(/leader \? null : <RegionCard \/>/);
  });
});
