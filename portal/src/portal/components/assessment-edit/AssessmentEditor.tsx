import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { portal, type AddKind, type EditError, type EditItem, type EditPaper } from '../../services/api';
import QuestionFields from './QuestionFields';
import {
  addQuestion, clearDraft, dropAdded, emptyDraft, isDirty, isRemovedNow, loadDraft, saveDraft,
  setEdit, toChanges, toggleRemove, type Draft,
} from './draft';

type Props = { paperId: string; open: boolean; onClose: () => void; onSaved: (r: { paperId: string; version: number }) => void };

const SAVE_MESSAGE: Record<string, string> = {
  EMPTY_SELECTION: 'Keep at least one question.',
  NOT_FOUND: "We couldn't find that paper.",
  NOT_READY: 'That paper is still being made.',
  RENDER_FAILED: "We couldn't make the file. Please try again.",
  UPLOAD_FAILED: "We couldn't save your paper. Please try again.",
  EDITING_DISABLED: 'Editing is not available right now.',
};
const UNREACHABLE = "We couldn't reach the paper service — your changes are kept. Please try again.";

type Editing = { key: string; id?: string; subIndex?: number; kind?: AddKind['kind']; section?: 'objective' | 'subjective' } | null;

function messageOf(err: unknown): { status?: number; data?: { error?: string; code?: string; errors?: EditError[] } } {
  const r = (err as { response?: { status?: number; data?: never } })?.response;
  return r ? { status: r.status, data: r.data } : {};
}

const newFields = (k: AddKind) => ({
  shape: k.needsOptions ? 'options' : 'standard', question: '', marks: String(k.marks), answer: '',
  lines: String(k.lines), lines_default: k.lines, lines_options: [], show_lines: false,
  ...(k.needsOptions ? { slots: ['', '', '', '', '', ''], correct: 'none', msq: false, show_correct: true } : {}),
}) as EditItem['fields'];

const AssessmentEditor = ({ paperId, open, onClose, onSaved }: Props) => {
  const [paper, setPaper] = useState<EditPaper | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [kinds, setKinds] = useState<AddKind[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft(paperId));
  const [offerDraft, setOfferDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [picking, setPicking] = useState<'objective' | 'subjective' | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPaper(null); setDraft(emptyDraft(paperId)); setLoadError(null);
    Promise.all([portal.getAssessmentEditQuestions(paperId), portal.getAssessmentAddKinds(paperId)])
      .then(([q, k]) => {
        if (cancelled) return;
        setPaper(q.paper); setItems(q.items); setKinds(k.kinds);
        const saved = loadDraft(paperId);
        if (saved && isDirty(saved)) setOfferDraft(saved);
      })
      .catch((err) => { if (!cancelled) setLoadError(SAVE_MESSAGE[messageOf(err).data?.code || ''] || UNREACHABLE); });
    return () => { cancelled = true; };
  }, [open, paperId]);

  useEffect(() => { if (paper) saveDraft(draft); }, [draft, paper]);

  const visible = useMemo(() => items.map((it) => ({
    it,
    removed: isRemovedNow(draft, it.id, it.removed),
    edited: Object.keys(draft.edits).some((k) => k.split('#')[0] === it.id),
    marks: draft.edits[it.id]?.marks ?? it.marks,
    text: draft.edits[it.id]?.text ?? it.text,
  })), [items, draft]);

  const kept = visible.filter((v) => !v.removed);
  const count = kept.length + draft.added.length;
  const marks = kept.reduce((s, v) => s + v.marks, 0) + draft.added.reduce((s, a) => s + a.marks, 0);
  const canSave = isDirty(draft) && count > 0 && !busy && !editing;

  const done = async (edit: Record<string, unknown>) => {
    if (!editing) return;
    setBusy(true); setFieldError(null);
    try {
      const body = editing.kind ? { kind: editing.kind, edit } : { id: editing.id, edit: editing.subIndex != null ? { ...edit, subIndex: editing.subIndex } : edit };
      const r = await portal.validateAssessmentEdit(paperId, body);
      if (editing.kind) setDraft((d) => addQuestion(d, { kind: editing.kind!, edit, marks: r.marks, text: r.text }));
      else setDraft((d) => setEdit(d, editing.key, { edit: body.edit as Record<string, unknown>, marks: r.marks, text: r.text }));
      setItemErrors((e) => { const n = { ...e }; delete n[editing.key]; return n; });
      setEditing(null);
    } catch (err) {
      const m = messageOf(err);
      setFieldError(m.status === 400 && m.data?.error ? m.data.error : UNREACHABLE);
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setSaveError(null); setItemErrors({});
    try {
      const r = await portal.saveAssessmentVersion(paperId, toChanges(draft));
      clearDraft(paperId);
      onSaved({ paperId: r.paperId, version: r.version });
    } catch (err) {
      const m = messageOf(err);
      if (m.data?.code === 'INVALID_CHANGES' && m.data.errors) {
        const byKey: Record<string, string> = {};
        for (const e of m.data.errors) byKey[e.id ?? `added#${e.addedIndex}`] = e.message;
        setItemErrors(byKey);
        setSaveError('Some questions need fixing — see below.');
      } else {
        setSaveError(SAVE_MESSAGE[m.data?.code || ''] || UNREACHABLE);
      }
    } finally { setBusy(false); }
  };

  const requestClose = () => (isDirty(draft) ? setConfirmClose(true) : onClose());

  const section = (name: 'objective' | 'subjective', title: string) => (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">{title}</h3>
      {visible.filter((v) => v.it.section === name).map(({ it, removed, edited, marks: m, text }) => (
        <div key={it.id} data-question={it.id} dir={paper?.rtl ? 'rtl' : 'ltr'}
          className={`rounded-lg border p-3 ${removed ? 'opacity-50' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">{it.type} · {m} marks
                {edited && <span className="ml-2 rounded bg-amber-100 px-1 text-amber-800">Edited</span>}
                {removed && <span className="ml-2 rounded bg-muted px-1">Removed</span>}</div>
              <div>{text}</div>
            </div>
            <div className="flex shrink-0 gap-1" dir="ltr">
              {removed ? (
                <Button size="sm" variant="outline" onClick={() => setDraft((d) => toggleRemove(d, it.id, it.removed))}>Restore</Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" disabled={!!editing} onClick={() => { setFieldError(null); setEditing({ key: it.id, id: it.id }); }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft((d) => toggleRemove(d, it.id, it.removed))}>Remove</Button>
                </>
              )}
            </div>
          </div>
          {itemErrors[it.id] && <p className="mt-2 text-sm text-destructive">{itemErrors[it.id]}</p>}
          {editing?.key === it.id && (
            <div className="mt-3"><QuestionFields key={editing.key} fields={it.fields} rtl={!!paper?.rtl} error={fieldError} busy={busy} onDone={done} onCancel={() => setEditing(null)} /></div>
          )}
          {!removed && it.subs && it.subs.map((s) => (
            <div key={s.index} className="ml-4 mt-2 border-l pl-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{draft.edits[`${it.id}#${s.index}`]?.text ?? s.fields.question}</span>
                <Button size="sm" variant="ghost" disabled={!!editing} onClick={() => { setFieldError(null); setEditing({ key: `${it.id}#${s.index}`, id: it.id, subIndex: s.index }); }}>Edit</Button>
              </div>
              {editing?.key === `${it.id}#${s.index}` && (
                <QuestionFields key={editing.key} fields={s.fields} rtl={!!paper?.rtl} error={fieldError} busy={busy} onDone={done} onCancel={() => setEditing(null)} />
              )}
            </div>
          ))}
        </div>
      ))}
      {draft.added.map((a, i) => ({ a, i })).filter(({ a }) => (a.kind === 'mcq' || a.kind === 'fill' ? 'objective' : 'subjective') === name).map(({ a, i }) => (
        <div key={`added-${i}`} data-question={`added-${i}`} dir={paper?.rtl ? 'rtl' : 'ltr'} className="rounded-lg border border-dashed p-3 text-sm">
          <div className="text-xs text-muted-foreground">{a.marks} marks <span className="ml-2 rounded bg-emerald-100 px-1 text-emerald-800">New</span></div>
          <div className="flex items-center justify-between gap-2"><span>{a.text}</span>
            <Button size="sm" variant="ghost" onClick={() => setDraft((d) => dropAdded(d, i))}>Remove</Button></div>
          {itemErrors[`added#${i}`] && <p className="mt-2 text-destructive">{itemErrors[`added#${i}`]}</p>}
        </div>
      ))}
      {picking === name ? (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <Button key={k.kind} size="sm" variant="outline"
              onClick={() => { setPicking(null); setFieldError(null); setEditing({ key: `new-${name}`, kind: k.kind, section: name }); }}>{k.label}</Button>
          ))}
        </div>
      ) : (
        <Button size="sm" variant="ghost" disabled={!!editing} onClick={() => setPicking(name)}><Plus className="mr-1 h-4 w-4" />Add a question</Button>
      )}
      {editing?.key === `new-${name}` && editing.kind && (
        <div className="rounded-lg border border-dashed p-3">
          <QuestionFields key={`${editing.key}-${editing.kind}`} fields={newFields(kinds.find((k) => k.kind === editing.kind)!)} rtl={!!paper?.rtl}
            error={fieldError} busy={busy} onDone={done} onCancel={() => setEditing(null)} />
        </div>
      )}
    </section>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{paper ? `Grade ${paper.grade} · ${paper.subject}${paper.chapterNumber ? ` · Chapter ${paper.chapterNumber}` : ''}` : 'Edit paper'}</SheetTitle>
          <SheetDescription>{paper ? `Editing version ${paper.version} · ${count} questions · ${marks} marks` : 'Loading your paper'}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto py-4">
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {!paper && !loadError && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {offerDraft && (
            <div className="rounded-md bg-muted p-3 text-sm">
              You have unsaved changes from before.
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => { setDraft(offerDraft); setOfferDraft(null); }}>Keep them</Button>
                <Button size="sm" variant="ghost" onClick={() => { clearDraft(paperId); setOfferDraft(null); }}>Start fresh</Button>
              </div>
            </div>
          )}
          {paper && section('objective', 'Objective')}
          {paper && section('subjective', 'Subjective')}
        </div>

        <div className="border-t pt-3">
          {saveError && <p className="mb-2 text-sm text-destructive">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={requestClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={!canSave}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Make my paper</Button>
          </div>
        </div>

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
              <AlertDialogDescription>Your edits to this paper will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={() => { clearDraft(paperId); setConfirmClose(false); onClose(); }}>Discard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
};

export default AssessmentEditor;
