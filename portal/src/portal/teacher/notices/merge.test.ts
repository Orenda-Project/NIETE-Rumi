import { describe, it, expect } from "vitest";
import { BANNER_FRESH_MS, mergeServer, type NoticeItem, type ServerItem } from "./model";

/**
 * bd-fmf24g.15 — folding the server's list into what this device follows (the pure rule behind the strip and
 * Home surviving a refresh or a new device).
 */
const NOW = Date.UTC(2026, 9, 8, 7, 0, 0);
const min = (n: number) => n * 60_000;

const srv = (over: Partial<ServerItem> = {}): ServerItem => ({
  id: "paper:r1", kind: "paper", state: "making", title: "", grade: 4, subject: "Science", questions: 15, chapterNumber: 2,
  startedAt: NOW - min(1), readyAt: null, seenAt: null, openedAt: null, homeUntil: null, paperId: null, renderId: null,
  lessonId: null, lang: null, errorCode: null, waitHref: "/portal/teacher/assessment/request/r1", ...over,
});
const local = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  id: "paper:r1", kind: "paper", state: "making", title: "Plants", grade: 4, subject: "Science", questions: 15,
  startedAt: NOW - min(1), readyAt: null, waitHref: "/portal/teacher/assessment/request/r1", announced: false,
  requestId: "r1", spec: {}, paperId: null, ...over,
});
const ready = (over: Partial<ServerItem> = {}) => srv({
  state: "ready", paperId: "p1", readyAt: NOW - min(2), homeUntil: NOW + 20 * 3_600_000, ...over,
});

describe("mergeServer: an item this device has never heard of", () => {
  it("one being made is followed here", () => {
    const { items } = mergeServer([], [srv()], NOW);
    expect(items).toEqual([expect.objectContaining({
      id: "paper:r1", state: "making", title: "", chapterNumber: 2, requestId: "r1", waitHref: "/portal/teacher/assessment/request/r1", announced: false,
    })]);
  });

  it("a lesson plan keeps what its viewer and Start DC observation need", () => {
    const at = { grade: 9, subject: "Physics", lesson: "phy9.c02.p010", render: "R9" };
    const { items } = mergeServer([], [srv({
      id: "lesson:R9", kind: "lesson", title: "Speed", grade: 9, subject: "Physics", lessonId: "phy9.c02.p010", renderId: "R9", lang: "en", at,
      waitHref: "/portal/teacher/lessons/preparing?render=R9",
    })], NOW);
    expect(items[0]).toMatchObject({ kind: "lesson", renderId: "R9", lessonId: "phy9.c02.p010", lang: "en", at, title: "Speed" });
  });

  it("a ready one that is news (unseen, minutes old) is a ready item here: the banner tells her", () => {
    const { items, home } = mergeServer([], [ready()], NOW);
    expect(items).toEqual([expect.objectContaining({ state: "ready", paperId: "p1", announced: false })]);
    expect(home.map((h) => h.id)).toEqual(["paper:r1"]);
  });

  it("a ready one seen elsewhere is not announced again, but Home keeps it", () => {
    const { items, home } = mergeServer([], [ready({ seenAt: NOW - min(1) })], NOW);
    expect(items).toEqual([]);
    expect(home).toHaveLength(1);
  });

  it("a ready one whose banner already ran on this device is not announced again after a refresh, but Home keeps it", () => {
    const { items, home } = mergeServer([], [ready()], NOW, new Set(["paper:r1"]));
    expect(items).toEqual([]);
    expect(home).toHaveLength(1);
  });

  it("a ready one she is only now hearing of, hours late, goes straight to Home with no banner", () => {
    const { items, home } = mergeServer([], [ready({ readyAt: NOW - BANNER_FRESH_MS - 1 })], NOW);
    expect(items).toEqual([]);
    expect(home).toHaveLength(1);
  });

  it("a failed one is followed; its banner is for a failure that is news, not one from the morning", () => {
    expect(mergeServer([], [srv({ state: "failed", errorCode: "TRUNCATED" })], NOW).items[0]).toMatchObject({ state: "failed", errorCode: "TRUNCATED", announced: false });
    expect(mergeServer([], [srv({ state: "failed", errorCode: "X", startedAt: NOW - min(90) })], NOW).items[0].announced).toBe(true);
  });

  it("one she has opened is not followed and not on Home", () => {
    const { items, home } = mergeServer([], [ready({ openedAt: NOW - min(1), seenAt: NOW - min(1) })], NOW);
    expect(items).toEqual([]);
    expect(home).toEqual([]);
  });

  it("Home lets go of one past its 24 weekday hours, whatever else is true of it", () => {
    expect(mergeServer([], [ready({ seenAt: NOW - min(1), homeUntil: NOW - 1 })], NOW).home).toEqual([]);
  });
});

describe("mergeServer: an item this device already follows", () => {
  it("the server saying it is ready is a ready item here (another device's poll got there first)", () => {
    const { items } = mergeServer([local()], [ready()], NOW);
    expect(items[0]).toMatchObject({ state: "ready", paperId: "p1", title: "Plants" });
  });

  it("the server saying she opened it removes it here", () => {
    expect(mergeServer([local({ state: "ready" })], [ready({ openedAt: NOW })], NOW).items).toEqual([]);
  });

  it("ready here and already seen on another device: the banner has run, so it goes", () => {
    expect(mergeServer([local({ state: "ready", paperId: "p1" })], [ready({ seenAt: NOW - min(1) })], NOW).items).toEqual([]);
  });

  it("failed on the server: failed here, with its code", () => {
    expect(mergeServer([local()], [srv({ state: "failed", errorCode: "NO_CONTENT" })], NOW).items[0]).toMatchObject({ state: "failed", errorCode: "NO_CONTENT" });
  });

  it("local items the server does not list are kept: its list is a recent window, and a job just started may not be in it", () => {
    expect(mergeServer([local({ id: "paper:fresh", requestId: "fresh" })], [], NOW).items.map((i) => i.id)).toEqual(["paper:fresh"]);
  });

  it("Home is newest first", () => {
    const { home } = mergeServer([], [
      ready({ id: "paper:a", seenAt: 1, readyAt: NOW - min(50) }), ready({ id: "paper:b", seenAt: 1, readyAt: NOW - min(5) }),
    ], NOW);
    expect(home.map((h) => h.id)).toEqual(["paper:b", "paper:a"]);
  });
});
