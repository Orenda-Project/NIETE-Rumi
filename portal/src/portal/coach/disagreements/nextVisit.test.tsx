import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { list: vi.fn() },
  readDisagreementsOn: vi.fn(),
}));
import { disagreements, readDisagreementsOn } from "./api";
import { NextVisit } from "./nextVisit";

/**
 * bd-tbprit.16 — the coach Home's "For your next visit": the To-do requests she added to her next visit (bd-tbprit.11),
 * each opening its card. Nothing unless the disagreement flag is on and at least one is marked.
 */
const D = vi.mocked(disagreements);
const on = vi.mocked(readDisagreementsOn);
const ROW = (id: string, teacher: string, nextVisit: boolean) => ({
  id, teacher, school: "IMSG I-8/1", emis: null, opened: true, reasons: ["score" as const], status: "sent", done: false,
  createdAt: "2026-10-20T09:00:00Z", visitedAt: null, sessionDate: null, pct: 52, hasNote: false, tags: [], nextVisit,
});

const show = () => render(<MemoryRouter><NextVisit /></MemoryRouter>);
const lang = async (l: "en" | "ur") => { await act(async () => { await i18n.changeLanguage(l); }); };

describe("NextVisit (coach Home)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await lang("en");
    on.mockResolvedValue(true);
    D.list.mockResolvedValue({ success: true, todo: [ROW("r1", "Sadia Bibi", true), ROW("r2", "Hina Tariq", false)], done: [] } as any);
  });

  it("lists only the marked To-do requests, each opening its card", async () => {
    show();
    const box = await screen.findByTestId("next-visit");
    expect(box).toHaveTextContent("For your next visit");
    const link = within(box).getByRole("link", { name: /Sadia Bibi/ });
    expect(link).toHaveAttribute("href", "/portal/coach/disagreements/r1");
    expect(link).toHaveTextContent("IMSG I-8/1");
    expect(within(box).queryByText("Hina Tariq")).toBeNull();
  });

  it("Urdu heading", async () => {
    await lang("ur");
    show();
    expect(await screen.findByTestId("next-visit")).toHaveTextContent("اگلے دورے");
  });

  it("nothing when the flag is off — and the list is never fetched", async () => {
    on.mockResolvedValue(false);
    show();
    await act(async () => {});
    expect(screen.queryByTestId("next-visit")).toBeNull();
    expect(D.list).not.toHaveBeenCalled();
  });

  it("nothing when no request is marked, or the list fails", async () => {
    D.list.mockResolvedValue({ success: true, todo: [ROW("r2", "Hina Tariq", false)], done: [] } as any);
    const first = show();
    await act(async () => {});
    expect(screen.queryByTestId("next-visit")).toBeNull();
    first.unmount();
    D.list.mockRejectedValue(new Error("500"));
    show();
    await act(async () => {});
    expect(screen.queryByTestId("next-visit")).toBeNull();
  });
});
