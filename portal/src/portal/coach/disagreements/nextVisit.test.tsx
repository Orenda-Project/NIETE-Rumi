import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { NextVisit } from "./nextVisit";

/**
 * bd-tbprit.16 — "For your next visit" on her disagreements list: the To-do requests she added to her next visit
 * (bd-tbprit.11), each opening its card. Nothing when none is marked.
 */
const ROW = (id: string, teacher: string, nextVisit: boolean) => ({
  id, teacher, school: "IMSG I-8/1", emis: null, opened: true, reasons: ["score" as const], status: "sent", done: false,
  createdAt: "2026-10-20T09:00:00Z", visitedAt: null, sessionDate: null, pct: 52, hasNote: false, tags: [], nextVisit,
});

const show = (todo: ReturnType<typeof ROW>[]) => render(<MemoryRouter><NextVisit todo={todo as any} /></MemoryRouter>);
const lang = async (l: "en" | "ur") => { await act(async () => { await i18n.changeLanguage(l); }); };

describe("NextVisit", () => {
  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await lang("en");
  });

  it("lists only the marked To-do requests, each opening its card", () => {
    show([ROW("r1", "Sadia Bibi", true), ROW("r2", "Hina Tariq", false)]);
    const box = screen.getByTestId("next-visit");
    expect(box).toHaveTextContent("For your next visit");
    const link = within(box).getByRole("link", { name: /Sadia Bibi/ });
    expect(link).toHaveAttribute("href", "/portal/coach/disagreements/r1");
    expect(link).toHaveTextContent("IMSG I-8/1");
    expect(within(box).queryByText("Hina Tariq")).toBeNull();
  });

  it("Urdu heading", async () => {
    await lang("ur");
    show([ROW("r1", "Sadia Bibi", true)]);
    expect(screen.getByTestId("next-visit")).toHaveTextContent("اگلے دورے");
  });

  it("nothing when no request is marked", () => {
    show([ROW("r2", "Hina Tariq", false)]);
    expect(screen.queryByTestId("next-visit")).toBeNull();
  });
});
