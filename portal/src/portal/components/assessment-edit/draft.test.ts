import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyDraft, isDirty, toggleRemove, isRemovedNow, setEdit, addQuestion, dropAdded,
  toChanges, saveDraft, loadDraft, clearDraft,
} from './draft';

beforeEach(() => localStorage.clear());

describe('draft', () => {
  it('starts clean', () => expect(isDirty(emptyDraft('p1'))).toBe(false));

  it('remove then remove again is back to clean', () => {
    let d = toggleRemove(emptyDraft('p1'), 'a.0', false);
    expect(isRemovedNow(d, 'a.0', false)).toBe(true);
    d = toggleRemove(d, 'a.0', false);
    expect(isRemovedNow(d, 'a.0', false)).toBe(false);
    expect(isDirty(d)).toBe(false);
  });

  it('restoring an originally removed question goes in restored', () => {
    const d = toggleRemove(emptyDraft('p1'), 'a.1', true);
    expect(toChanges(d)).toEqual({ edits: [], removed: [], restored: ['a.1'], added: [] });
  });

  it('a later edit of the same question replaces the earlier one; sub edits carry subIndex', () => {
    let d = setEdit(emptyDraft('p1'), 'a.0', { edit: { marks: '2' }, marks: 2, text: 'x' });
    d = setEdit(d, 'a.0', { edit: { marks: '3' }, marks: 3, text: 'x' });
    d = setEdit(d, 'c.0#1', { edit: { subIndex: 1, question: 'q' }, marks: 1, text: 'q' });
    expect(toChanges(d).edits).toEqual([
      { id: 'a.0', edit: { marks: '3' } },
      { id: 'c.0', edit: { subIndex: 1, question: 'q' } },
    ]);
  });

  it('adds and drops new questions', () => {
    let d = addQuestion(emptyDraft('p1'), { kind: 'short', edit: { question: 'q', answer: 'a' }, marks: 2, text: 'q' });
    expect(toChanges(d).added).toEqual([{ kind: 'short', edit: { question: 'q', answer: 'a' } }]);
    d = dropAdded(d, 0);
    expect(isDirty(d)).toBe(false);
  });

  it('survives a reload per parent, and clears', () => {
    const d = toggleRemove(emptyDraft('p1'), 'a.0', false);
    saveDraft(d);
    expect(loadDraft('p1')).toEqual(d);
    expect(loadDraft('p2')).toBeNull();
    clearDraft('p1');
    expect(loadDraft('p1')).toBeNull();
  });

  it('storage that throws is ignored', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    expect(() => saveDraft(emptyDraft('p1'))).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
