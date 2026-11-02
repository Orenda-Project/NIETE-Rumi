import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-pw1ccr.26 — the teacher Home's "Make my paper" card: drawn only while her topic-end nudge is held (GET
 * /me/topic-paper says {held}); its 404 (switch off, or not group B) or an error draws nothing. The tap goes to
 * Class with ?by=topics&grade=&subject=&chapter= and tells the server (POST /me/topic-paper/opened {topicId}).
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { TopicPaperCard } from "./TopicPaperCard";
import { TOPIC_PAPER, TOPIC_PAPER_COPY } from "../topicpaper/copy";
import { untranslated } from "../i18n";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const HELD = { topicId: "t-42", topicName: "Nouns", grade: 3, subject: "english", chapter: 4 };
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const draw = async () => { render(<MemoryRouter><TopicPaperCard /></MemoryRouter>); await flush(); };

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockResolvedValue({ data: { success: true, held: HELD } });
  http.post.mockResolvedValue({ data: { success: true, skipped: 1 } });
});

describe("TopicPaperCard", () => {
  it("asks the server for her held nudge", async () => {
    await draw();
    expect(http.get).toHaveBeenCalledWith("/me/topic-paper");
  });

  it("draws nothing when nothing is held", async () => {
    http.get.mockResolvedValue({ data: { success: true, held: null } });
    await draw();
    expect(screen.queryByTestId("topic-paper-card")).toBeNull();
  });

  it("draws nothing when the switch is off (404) or the call fails", async () => {
    http.get.mockRejectedValue(Object.assign(new Error("nf"), { response: { status: 404 } }));
    await draw();
    expect(screen.queryByTestId("topic-paper-card")).toBeNull();
  });

  it("names the topic and chapter, and links to Topics on that chapter", async () => {
    await draw();
    const card = screen.getByTestId("topic-paper-card");
    expect(card.textContent).toContain("Nouns");
    expect(card.textContent).toContain("4");
    const link = screen.getByRole("link", { name: TOPIC_PAPER_COPY.cta });
    expect(link.getAttribute("href")).toBe("/portal/teacher/assessment/new/class?by=topics&grade=3&subject=english&chapter=4");
  });

  it("without a topic name, still names the chapter", async () => {
    http.get.mockResolvedValue({ data: { success: true, held: { ...HELD, topicName: null } } });
    await draw();
    expect(screen.getByTestId("topic-paper-card").textContent).toContain("4");
  });

  it("the tap tells the server, so the WhatsApp retry stops", async () => {
    await draw();
    fireEvent.click(screen.getByRole("link", { name: TOPIC_PAPER_COPY.cta }));
    await flush();
    expect(http.post).toHaveBeenCalledWith("/me/topic-paper/opened", { topicId: "t-42" });
  });

  it("speaks Urdu, Western digits as the bot, the topic isolated", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    await draw();
    const text = screen.getByTestId("topic-paper-card").textContent || "";
    expect(text).toContain(TOPIC_PAPER.ur.cta);
    expect(text).toContain("باب 4");
    expect(text).toContain("⁨Nouns⁩");
  });

  it("has every Urdu word", () => {
    expect(untranslated(TOPIC_PAPER)).toEqual([]);
  });
});
