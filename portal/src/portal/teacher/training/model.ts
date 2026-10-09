import nieteLogo from '@/assets/vendors/niete.png';
import isapsLogo from '@/assets/vendors/isaps.png';
import beaconhouseLogo from '@/assets/vendors/beaconhouse.png';
import oxbridgeLogo from '@/assets/vendors/oxbridge.png';
import { featurePath } from '../paths';
import {
  isLadder, percent, providerInitials, providerLabel, sortVendors, trainingPaths,
  type Level, type Vendor,
} from '../../newui/training/trainingApi';
import type { ContinueTarget } from '../../newui/training/continue';

/**
 * bd-fmf24g.5 — the teacher v2 Training screens' data, shaped from the reads the new UI's Training
 * already makes (GET /training/vendors, /levels, /certificates, /bands). No rule lives here: locks,
 * gates and pass marks stay the server's; continue.ts still decides where "Continue" goes. These
 * mappers only say what each card and node shows, from real fields — nothing is made up.
 */

/** Where the v2 Training screens live; every training page opened under it keeps it (trainingBase). */
export const TRAINING_V2_BASE = featurePath('training');

type Paths = ReturnType<typeof trainingPaths>;

/* ── providers' logos (the files PortalTrainingV2 shows) ─────────────────── */

const LOGOS: Record<string, string> = {
  TALEEMABAD: nieteLogo,
  ISAPS: isapsLogo,
  BEACONHOUSE: beaconhouseLogo,
  OXBRIDGE: oxbridgeLogo,
};

export function providerLogo(key: string | null | undefined): string | null {
  return LOGOS[String(key || '')] ?? null;
}

/* ── her teaching level (GET /training/bands, the band picker's route) ───── */

export type Bands = { options?: Array<{ id: string; title: string }>; selected?: string[] } | null | undefined;

/** "Primary (Grades 1-5)" → "Primary". A title in any other shape is shown whole (as My profile does). */
const shortLevel = (title: string) => {
  const m = title.match(/^(.*?)\s*\(\s*grades?\s*\d+\s*[-–]\s*\d+\s*\)\s*$/i);
  return m ? m[1] : title;
};

/** The bands she picked, named short, in the server's options order. */
export function teachingLevels(bands: Bands): string[] {
  const picked = new Set(bands?.selected || []);
  return (bands?.options || []).filter((o) => picked.has(o.id)).map((o) => shortLevel(o.title));
}

/* ── a provider's tile on the hub ─────────────────────────────────────────── */

export type TileSub = { kind: 'level'; n: number; of: number } | { kind: 'courses'; done: number; total: number } | null;

export type CourseTile = {
  key: string;
  label: string;
  initials: string;
  logo: string | null;
  /** Parts done over parts (the vendor's own counts). */
  pct: number;
  done: boolean;
  sub: TileSub;
  to: string;
};

export function courseTiles(vendors: Vendor[], levels: Level[], paths: Paths): CourseTile[] {
  return sortVendors(vendors).map((v) => {
    const own = levels.filter((l) => l.vendor_key === v.vendor_key).sort((a, b) => a.order_index - b.order_index);
    const pct = percent(v.completed_module_count, v.module_count);
    const done = pct >= 100;
    let sub: TileSub = null;
    if (!done && own.length > 1 && isLadder(own[0])) {
      const at = own.findIndex((l) => l.state !== 'certified' && l.state !== 'locked');
      if (at >= 0) sub = { kind: 'level', n: at + 1, of: own.length };
    } else if (!done && own.length === 1) {
      sub = { kind: 'courses', done: Math.min(own[0].courses_completed || 0, own[0].courses_total || 0), total: own[0].courses_total || 0 };
    }
    return {
      key: v.vendor_key,
      label: providerLabel(v.vendor_key, vendors),
      initials: providerInitials(v.vendor_key, v.vendor_name),
      logo: providerLogo(v.vendor_key),
      pct,
      done,
      sub,
      to: own.length === 1 ? paths.level(v.vendor_key, own[0].id) : paths.provider(v.vendor_key),
    };
  });
}

/* ── the certificates card ────────────────────────────────────────────────── */

export type CertLike = { vendor_key?: string | null; vendor_name?: string | null };
export type CertProvider = { key: string; label: string; initials: string; logo: string | null };
export type CertSummary = { count: number; providers: CertProvider[] };

/** Every certificate counts; each provider she earned one from shows once, in the page order. */
export function certificateSummary(certs: CertLike[] | null | undefined): CertSummary {
  const list = certs || [];
  const keys = new Map<string, string | null | undefined>();
  for (const c of list) if (c.vendor_key && !keys.has(c.vendor_key)) keys.set(c.vendor_key, c.vendor_name);
  const asVendors = [...keys.keys()].map((k) => ({ vendor_key: k } as Vendor));
  const providers = sortVendors(asVendors).map(({ vendor_key: key }) => ({
    key,
    label: providerLabel(key),
    initials: providerInitials(key, keys.get(key)),
    logo: providerLogo(key),
  }));
  return { count: list.length, providers };
}

/* ── the Continue card ────────────────────────────────────────────────────── */

export type ContinueCard = {
  vendorKey: string;
  provider: string;
  logo: string | null;
  initials: string;
  /** The level's number on a ladder; null for a set of subjects. */
  levelNumber: number | null;
  levelName: string | null;
  partsDone: number;
  partsTotal: number;
  pct: number;
  to: string;
};

export function continueCard(target: ContinueTarget | null | undefined, vendors: Vendor[], levels: Level[]): ContinueCard | null {
  if (!target) return null;
  const lvl = levels.find((l) => l.id === target.levelId) ?? null;
  const partsDone = Math.min(lvl?.completed_count || 0, lvl?.module_count || 0);
  const partsTotal = lvl?.module_count || 0;
  return {
    vendorKey: target.vendorKey,
    provider: providerLabel(target.vendorKey, vendors),
    logo: providerLogo(target.vendorKey),
    initials: providerInitials(target.vendorKey, vendors.find((v) => v.vendor_key === target.vendorKey)?.vendor_name),
    levelNumber: lvl && isLadder(lvl) ? lvl.order_index + 1 : null,
    levelName: lvl?.name ?? null,
    partsDone,
    partsTotal,
    pct: percent(partsDone, partsTotal),
    to: target.to,
  };
}

/* ── the level page's journey path (option A) ─────────────────────────────── */

export type JourneyState = 'done' | 'current' | 'open' | 'locked';

export type JourneyNode = {
  id: number;
  n: number;
  name: string;
  state: JourneyState;
  partsDone: number;
  partsTotal: number;
  pct: number;
  /** Where a tap goes: another level she may open. Null on the level she is on and on a locked one. */
  to: string | null;
};

/**
 * A provider's ladder, with the level she is looking at as current. Null when there is no path to
 * draw: one level only (I-SAPS, Oxbridge) or a set of subjects open in any order (Beacon House).
 * `fill` is how far along the line the green runs: up to the current node.
 */
export function journey(levels: Level[], vendorKey: string, levelId: number | string, paths: Paths): { nodes: JourneyNode[]; fill: number } | null {
  const own = levels.filter((l) => l.vendor_key === vendorKey).sort((a, b) => a.order_index - b.order_index);
  if (own.length < 2 || !isLadder(own[0])) return null;
  const nodes = own.map((l, i): JourneyNode => {
    const isCurrent = String(l.id) === String(levelId) && l.state !== 'locked';
    const state: JourneyState = isCurrent ? 'current' : l.state === 'locked' ? 'locked' : l.state === 'certified' ? 'done' : 'open';
    const partsDone = Math.min(l.completed_count || 0, l.module_count || 0);
    const partsTotal = l.module_count || 0;
    return {
      id: l.id,
      n: i + 1,
      name: l.name,
      state,
      partsDone,
      partsTotal,
      pct: percent(partsDone, partsTotal),
      to: state === 'done' || state === 'open' ? paths.level(vendorKey, l.id) : null,
    };
  });
  const at = nodes.findIndex((n) => n.state === 'current');
  return { nodes, fill: at > 0 ? at / (nodes.length - 1) : 0 };
}
