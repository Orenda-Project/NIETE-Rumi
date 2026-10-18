import type { Clip, ClipRole, FlnItemLike, FlnMediaLike, FlnPlanLike, FlnSectionLike } from './types';

/**
 * Clips from a plan (contracts/player.md v2). One clip per distinct file: two steps that play the same `src` share the
 * clip (and its prefetched bytes), while each step keeps its own control. Order is first appearance, the teaching order.
 */

const BOLD = /\*\*(.+?)\*\*/;

export function clipIdOf(m: FlnMediaLike): string {
  return m.sha8 || m.src;
}

/** The first **bold** run of the step, with the quotes and trailing punctuation a phonics step wraps it in removed. */
export function boldRun(text: string | undefined): string | undefined {
  const hit = text ? BOLD.exec(text) : null;
  if (!hit) return undefined;
  const run = hit[1].replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»:،.,!؟?]+$/g, '').trim();
  return run || undefined;
}

/** `…/e0fba701-…_ck.mp3` → `ck`; `…/Apple.mp3` → `Apple`. The last resort: the bundle validator forbids reaching it. */
export function fileStem(src: string): string {
  let name = src.split('?')[0].split('/').pop() || src;
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  name = name.replace(/\.[a-z0-9]{2,4}$/i, '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i;
  return name.replace(uuid, '') || name;
}

function roleOf(m: FlnMediaLike): ClipRole {
  return m.role === 'word' || m.role === 'narration' ? m.role : 'sound';
}

function toClip(m: FlnMediaLike, item: FlnItemLike, lang: string | undefined): Clip {
  const urdu = lang === 'ur';
  const label = (urdu ? m.label_ur ?? m.label_en : m.label_en ?? m.label_ur) ?? boldRun(item.text) ?? fileStem(m.src);
  const caption = urdu ? m.caption_ur ?? m.caption_en : m.caption_en ?? m.caption_ur;
  return {
    id: clipIdOf(m),
    src: m.src,
    orig: m.orig || m.src,
    label,
    ...(caption ? { caption } : {}),
    role: roleOf(m),
    ...(m.duration_s != null ? { duration_s: m.duration_s } : {}),
    ...(m.bytes != null ? { bytes: m.bytes } : {}),
  };
}

function audioOf(item: FlnItemLike): FlnMediaLike[] {
  return (item.media || []).filter((m) => m && m.kind === 'audio' && typeof m.src === 'string' && m.src.length > 0);
}

/** The clips of ONE step, in its own order, repeats kept (a drill step may play the same clip twice). */
export function itemClips(item: FlnItemLike, lang?: string): Clip[] {
  return audioOf(item).map((m) => toClip(m, item, lang));
}

function sectionItems(section: FlnSectionLike): FlnItemLike[] {
  return (section.groups || []).flatMap((g) => g.items || []);
}

function allItems(plan: FlnPlanLike): FlnItemLike[] {
  return [
    ...(plan.setup || []),
    ...(plan.sections || []).flatMap(sectionItems),
    ...(plan.homework || []),
    ...(plan.summary || []),
  ];
}

function distinct(clips: Clip[]): Clip[] {
  const seen = new Set<string>();
  return clips.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** Every distinct clip of the plan, first-appearance order. What `useFlnPlayer` registers. */
export function planClips(plan: FlnPlanLike): Clip[] {
  return distinct(allItems(plan).flatMap((it) => itemClips(it, plan.lang)));
}

/** The grid: distinct by clip, sounds and words in first-appearance order, narrations last (no letter re-sort). */
export function gridClips(plan: FlnPlanLike): Clip[] {
  const all = planClips(plan);
  return [...all.filter((c) => c.role !== 'narration'), ...all.filter((c) => c.role === 'narration')];
}

/** The ids a section warms when it expands. */
export function sectionClipIds(section: FlnSectionLike): string[] {
  return distinct(sectionItems(section).flatMap((it) => itemClips(it))).map((c) => c.id);
}
