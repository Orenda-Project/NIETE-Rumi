import api from '../../services/api';
import { requestPath } from '../assessment/paths';
import { lessonsUrl } from '../lessons/paths';
import type { ServerItem } from './model';

/**
 * bd-fmf24g.15 — the notices on the server (dashboard/routes/portal-teacher-notices.routes.js): her items as the
 * server knows them, and what she did with them. The server's times are ISO strings; here they are milliseconds,
 * and each item gets the address of its own waiting page.
 *
 * Reporting never costs her anything: it is told to the server on the side, and a failure is silent — the
 * only consequence is that another device (or the WhatsApp fallback, when it is on) may not know yet.
 */

type Raw = Record<string, unknown>;
const ms = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function item(r: Raw): ServerItem | null {
  const id = str(r.id);
  const kind = r.kind === 'paper' || r.kind === 'lesson' ? r.kind : null;
  const state = r.state === 'making' || r.state === 'ready' || r.state === 'failed' ? r.state : null;
  const startedAt = ms(r.startedAt);
  if (!id || !kind || !state || startedAt === null) return null;
  const grade = num(r.grade);
  const subject = str(r.subject);
  const renderId = str(r.renderId);
  const lessonId = str(r.lessonId);
  const at = kind === 'lesson' && grade && subject && lessonId && renderId
    ? { grade, subject, lesson: lessonId, render: renderId }
    : undefined;
  return {
    id, kind, state,
    title: str(r.title) ?? '',
    grade, subject,
    questions: num(r.questions),
    chapterNumber: num(r.chapterNumber),
    startedAt,
    readyAt: ms(r.readyAt),
    seenAt: ms(r.seenAt),
    openedAt: ms(r.openedAt),
    homeUntil: ms(r.homeUntil),
    paperId: str(r.paperId),
    renderId,
    lessonId,
    lang: str(r.lang),
    errorCode: str(r.errorCode),
    waitHref: kind === 'paper' ? requestPath(id.slice('paper:'.length)) : (at ? lessonsUrl('preparing', at) : ''),
    at,
  };
}

/** Her items, from the server. Throws on a transport failure (the caller keeps what it has). */
export async function fetchNotices(): Promise<ServerItem[]> {
  const { data } = await api.get('/me/notices');
  const raw = Array.isArray(data?.items) ? (data.items as Raw[]) : [];
  return raw.map(item).filter((i): i is ServerItem => i !== null && i.waitHref !== '');
}

/** She closed the banner (`seen`) / opened the item (`opened`). Fire-and-forget: resolves true when the server took it. */
export async function reportNotice(id: string, what: 'seen' | 'opened'): Promise<boolean> {
  try {
    await api.post(`/me/notices/${encodeURIComponent(id)}/${what}`);
    return true;
  } catch {
    return false;
  }
}
