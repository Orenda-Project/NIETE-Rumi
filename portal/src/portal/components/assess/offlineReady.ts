import { useEffect, useState } from 'react';
import { childTestSa } from '../../services/api';
import { pktDate } from '../../lib/assess/visitStore';
import type { SaList, SaSchool } from '../../types/childTestSa';

/**
 * Round 8 (the reviewer's 28 Oct list): the test must run with weak or no internet, and start fast. Three switches on
 * this page, each an app_settings row (true or a list of users.id), each OFF by default:
 *
 *   sa_r8_offline_first  before a child's Start, the child's whole battery (items, pictures, every clip) is on the
 *                        phone, with progress; the child's page then never needs the network, so "the voice is not
 *                        ready" cannot appear in the middle of a test.
 *   sa_r8_offline_prep   "Get ready for offline" on the schools screen: while online, the coach keeps the chosen
 *                        schools' lists and every battery they need (both languages) on the phone.
 *   sa_r8_fast_start     Start waits at most FAST_START_MS for the server's answer to Present, then opens the test; the
 *                        answer (or the queue, offline) finishes behind it.
 *
 * The files go through the engine's own worker (/sa/sw.js, dashboard/sa/sa-offline.js prepVisit / checkVisit), so the
 * child's page finds them where it looks. What this page keeps itself (localStorage, a convenience only):
 * `assess:r8:prep` (the last "ready for offline"), `assess:r8:schools` (the last schools list) and
 * `assess:r8:list:<school>:<grade>` (a prepared list, shown when the network fails and today's visit has none).
 */

/** known: the switches were read (false until then, and when the read failed). */
export type R8Switches = { offlineFirst: boolean; offlinePrep: boolean; fastStart: boolean; known?: boolean };
export const R8_OFF: R8Switches = { offlineFirst: false, offlinePrep: false, fastStart: false };

export const FAST_START_MS = 1500;

/** This page's round-8 switches (fail-closed: off until read, off when the read fails). */
export function useR8Switches(enabled: boolean | null): R8Switches {
  const [on, setOn] = useState<R8Switches>(R8_OFF);
  useEffect(() => {
    if (enabled !== true) return undefined;
    let live = true;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then((s) => {
        const r = (s || {}) as Record<string, unknown>;
        if (live) setOn({ offlineFirst: r.r8OfflineFirst === true, offlinePrep: r.r8OfflinePrep === true, fastStart: r.r8FastStart === true, known: true });
      })
      .catch(() => { /* off */ });
    return () => { live = false; };
  }, [enabled]);
  return on;
}

export type Lang = 'en' | 'ur';
export const LANGS: Lang[] = ['ur', 'en'];

/** The coach battery a child of this grade takes in this language (AssessEngineSlot's playUrl names the same form). */
export function formFor(grade: number, lang: Lang): string {
  return `sa.coach.G${grade}.A.${lang}`;
}

export function formsFor(grades: number[], langs: Lang[] = LANGS): string[] {
  const out: string[] = [];
  for (const g of grades) for (const l of langs) if (g >= 1 && g <= 9 && !out.includes(formFor(g, l))) out.push(formFor(g, l));
  return out;
}

export type Progress = { done: number; total: number; bytes: number };
export type PrepResult = { ok: boolean; total: number; cached: number; missing: number; bytes: number; why?: string };
export type CheckResult = { ready: boolean; total: number; cached: number; why?: string };

export type Part = { block: string; seed: string };

type SaeOffline = {
  prepVisit: (o: { forms: string[]; part?: Part; onProgress?: (p: Progress) => void }) => Promise<PrepResult>;
  checkVisit: (o: { forms: string[] }) => Promise<CheckResult>;
};

let engine: Promise<SaeOffline | null> | null = null;

/** The engine's offline helper (/sa/sa-offline.js), loaded once into this page. */
function offlineEngine(): Promise<SaeOffline | null> {
  const w = window as unknown as { SAE?: { offline?: Partial<SaeOffline> } };
  const have = () => (w.SAE?.offline?.prepVisit && w.SAE.offline.checkVisit ? (w.SAE.offline as SaeOffline) : null);
  if (have()) return Promise.resolve(have());
  if (!engine) {
    engine = new Promise((ok) => {
      const s = document.createElement('script');
      s.src = '/sa/sa-offline.js';
      s.async = true;
      s.onload = () => ok(have());
      s.onerror = () => { engine = null; ok(null); };
      document.head.appendChild(s);
    });
  }
  return engine;
}

/** Every listed battery and all its files on the phone (only one child's part when given); never throws. */
export async function prepForms(forms: string[], onProgress?: (p: Progress) => void, part?: Part): Promise<PrepResult> {
  try {
    const e = await offlineEngine();
    if (!e) return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, why: 'no_engine' };
    return await e.prepVisit({ forms, onProgress, ...(part ? { part } : {}) });
  } catch (err) {
    return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, why: String((err as Error)?.message || err) };
  }
}

/** Are the listed batteries and all their files on the phone (nothing fetched)? Never throws. */
export async function checkForms(forms: string[]): Promise<CheckResult> {
  try {
    const e = await offlineEngine();
    if (!e) return { ready: false, total: 0, cached: 0, why: 'no_engine' };
    return await e.checkVisit({ forms });
  } catch (err) {
    return { ready: false, total: 0, cached: 0, why: String((err as Error)?.message || err) };
  }
}

// ── The page itself, offline (public/assess-sw.js, scope /portal/leader/assess) ──

const PAGE_SW = '/assess-sw.js';
const PAGE_SCOPE = '/portal/leader/assess';
const API = '/api/portal';
const CTS = `${API}/leader/child-test/sa`;

/** The list read's URL as the API client sends it (services/api.ts childTestSa.getList). */
export function listUrl(schoolId: string, visitId?: string | null, grade?: number | null): string {
  const q = new URLSearchParams({ schoolId, ...(visitId ? { visitId } : {}), ...(grade ? { grade: String(grade) } : {}) });
  return `${CTS}/list?${q.toString()}`;
}

/** What the page needs to open with no signal: itself, its files, and the reads it makes on the way in. */
export function pageUrls(lists: string[]): string[] {
  const assets = new Set<string>();
  try {
    performance.getEntriesByType('resource').forEach((e) => {
      const u = new URL(e.name, location.href);
      if (u.origin === location.origin && u.pathname.startsWith('/assets/')) assets.add(u.pathname);
    });
    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((el) => {
      const u = new URL((el as HTMLScriptElement).src || (el as HTMLLinkElement).href, location.href);
      if (u.origin === location.origin && u.pathname.startsWith('/assets/')) assets.add(u.pathname);
    });
  } catch { /* no timing API: the page and the reads still go */ }
  return [PAGE_SCOPE, ...assets, `${API}/me`, `${API}/config`, `${CTS}/switches`, `${CTS}/schools`, ...lists];
}

function postAsk(w: ServiceWorker, msg: unknown, waitMs = 60_000): Promise<{ ok: boolean; cached: number; missing: string[] } | null> {
  return new Promise((ok) => {
    const ch = new MessageChannel();
    const t = window.setTimeout(() => ok(null), waitMs);
    ch.port1.onmessage = (e) => { window.clearTimeout(t); ok(e.data); };
    w.postMessage(msg, [ch.port2]);
  });
}

/** sa_r8_offline_prep: register the page's worker and keep the page, its files and these reads. Never throws. */
export async function keepPageOffline(lists: string[]): Promise<boolean> {
  try {
    const nav = navigator.serviceWorker;
    if (!nav) return false;
    const reg = await nav.register(PAGE_SW, { scope: PAGE_SCOPE });
    let w: ServiceWorker | null = reg.active;
    if (!w) {
      const next = reg.installing || reg.waiting;
      if (!next) return false;
      w = await new Promise<ServiceWorker | null>((ok) => {
        const t = window.setTimeout(() => ok(reg.active), 30_000);
        next.addEventListener('statechange', () => {
          if (next.state === 'activated') { window.clearTimeout(t); ok(next); }
          else if (next.state === 'redundant') { window.clearTimeout(t); ok(reg.active); }
        });
      });
    }
    if (!w) return false;
    const r = await postAsk(w, { type: 'warm', urls: pageUrls(lists) });
    return !!r?.ok;
  } catch { return false; }
}

/** The switch read as OFF: a page worker left from an earlier "Get ready" goes. Never throws. */
export async function dropPageOffline(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration(PAGE_SCOPE);
    if (reg && reg.active && /\/assess-sw\.js$/.test(reg.active.scriptURL)) await reg.unregister();
  } catch { /* nothing kept, or no worker API */ }
}

/** p's answer if it comes within ms, else { done: false } (p still runs). A rejection within ms rejects. */
export function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  return new Promise((ok, fail) => {
    const t = window.setTimeout(() => ok({ done: false }), ms);
    p.then((value) => { window.clearTimeout(t); ok({ done: true, value }); }, (err) => { window.clearTimeout(t); fail(err); });
  });
}

// ── What this page keeps (a convenience only: storage that throws or is empty changes nothing) ──

export type PrepRecord = {
  at: number;
  /** the PKT day it was made: a list drawn on an earlier day may not be today's */
  day: string;
  schools: Array<{ schoolId: string; name: string; grade: number | null; listed: boolean }>;
  forms: string[];
  ok: boolean;
  total: number;
  cached: number;
  bytes: number;
};

const PREP_KEY = 'assess:r8:prep';
const SCHOOLS_KEY = 'assess:r8:schools';
const listKey = (schoolId: string, grade: number | null | undefined) => `assess:r8:list:${schoolId}:${grade || 0}`;

function read<T>(key: string): T | null {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch { return null; }
}
function write(key: string, v: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or blocked: a convenience only */ }
}

export const readPrep = () => read<PrepRecord>(PREP_KEY);
export const writePrep = (r: PrepRecord) => write(PREP_KEY, r);
export const readSchools = () => read<SaSchool[]>(SCHOOLS_KEY);
export const writeSchools = (s: SaSchool[]) => write(SCHOOLS_KEY, s);
/** grade: the school's named grade (sa_all_grades) or none (today's rotation); both keys are written by a prep. */
export const readPreparedList = (schoolId: string, grade?: number | null) => read<SaList>(listKey(schoolId, grade));
export const writePreparedList = (schoolId: string, grade: number | null | undefined, l: SaList) => write(listKey(schoolId, grade), l);

export const today = () => pktDate();

/** Megabytes for the coach, one decimal. */
export function mb(bytes: number): string {
  return (Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1);
}
