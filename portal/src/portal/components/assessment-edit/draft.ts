import type { EditChanges } from '../../services/api';

/**
 * Her unsaved changes to one version — a LIST OF CHANGES, never a rebuilt paper.
 * The bot applies it with its own rules (bd-hb8qs); nothing here knows a question shape.
 */
export type Draft = {
  parentId: string;
  edits: Record<string, { edit: Record<string, unknown>; marks: number; text: string }>;
  removed: string[];
  restored: string[];
  added: { kind: string; section?: 'objective' | 'subjective'; edit: Record<string, unknown>; marks: number; text: string }[];
};

const KEY = (parentId: string) => `assessment-edit-draft:${parentId}`;

export const emptyDraft = (parentId: string): Draft => ({ parentId, edits: {}, removed: [], restored: [], added: [] });

export const isDirty = (d: Draft) =>
  Object.keys(d.edits).length > 0 || d.removed.length > 0 || d.restored.length > 0 || d.added.length > 0;

const without = (list: string[], id: string) => list.filter((x) => x !== id);

export function isRemovedNow(d: Draft, id: string, originallyRemoved: boolean): boolean {
  return originallyRemoved ? !d.restored.includes(id) : d.removed.includes(id);
}

export function toggleRemove(d: Draft, id: string, originallyRemoved: boolean): Draft {
  if (originallyRemoved) {
    return { ...d, restored: d.restored.includes(id) ? without(d.restored, id) : [...d.restored, id] };
  }
  return { ...d, removed: d.removed.includes(id) ? without(d.removed, id) : [...d.removed, id] };
}

export const setEdit = (d: Draft, key: string, value: Draft['edits'][string]): Draft =>
  ({ ...d, edits: { ...d.edits, [key]: value } });

export const addQuestion = (d: Draft, q: Draft['added'][number]): Draft => ({ ...d, added: [...d.added, q] });

export const dropAdded = (d: Draft, index: number): Draft => ({ ...d, added: d.added.filter((_, i) => i !== index) });

export function toChanges(d: Draft): EditChanges {
  return {
    edits: Object.entries(d.edits).map(([key, v]) => ({ id: key.split('#')[0], edit: v.edit })),
    removed: d.removed,
    restored: d.restored,
    added: d.added.map(({ kind, edit }) => ({ kind, edit })),
  };
}

export function saveDraft(d: Draft): void {
  try { localStorage.setItem(KEY(d.parentId), JSON.stringify(d)); } catch { /* private window: draft lives in memory only */ }
}

export function loadDraft(parentId: string): Draft | null {
  try {
    const raw = localStorage.getItem(KEY(parentId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    const plain = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const ok = d && d.parentId === parentId && plain(d.edits)
      && Array.isArray(d.removed) && Array.isArray(d.restored) && Array.isArray(d.added);
    return ok ? d : null;
  } catch { return null; }
}

export function clearDraft(parentId: string): void {
  try { localStorage.removeItem(KEY(parentId)); } catch { /* nothing to clear */ }
}
