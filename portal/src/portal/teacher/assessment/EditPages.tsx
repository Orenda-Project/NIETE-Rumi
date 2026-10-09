import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, Loader2, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { portal, type EditFields, type EditItem } from '../../services/api';
import {
  addQuestion, clearDraft, dropAdded, emptyDraft, isDirty, isRemovedNow, loadDraft, saveDraft, setEdit, toChanges,
  toggleRemove, type Draft,
} from '../../components/assessment-edit/draft';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { Tray } from '../ui';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { addedEdit, blankValues, existingEdit, valuesFromFields, type FormValues } from './editForm';
import { addQuestionPath, editPath, editQuestionPath, paperPath } from './paths';
import { QuestionForm } from './QuestionForm';
import { Chip, ListCard, LoadState, OFF, OUTLINE, PRIMARY } from './ui';

/**
 * bd-fmf24g.6 — editing a finished paper (v28 canvas AssessEdit / AssessEditQuestion), over today's routes
 * (GET /assessment/edit/:id/questions, /add-kinds, POST /validate, /save): keep or remove each question,
 * change one, add one; Save makes a NEW version (the bot re-renders it; the old one stays). Her unsaved
 * changes are today's draft (components/assessment-edit/draft: a list of changes kept per version in
 * localStorage), so a question page and the paper page share them and a reload keeps them.
 */

const errorOf = (e: unknown): string | null => {
  const data = (e as { response?: { data?: { error?: string; errors?: Array<{ message?: string }> } } })?.response?.data;
  const listed = (data?.errors ?? []).map((x) => x?.message).filter(Boolean) as string[];
  return listed.length ? listed.join(' ') : (data?.error ?? null);
};

/** A question's boxes with her earlier (unsaved) edit laid over them (today's editor's withStoredEdit). */
function overlay(fields: EditFields, stored?: { edit: Record<string, unknown> }): EditFields {
  if (!stored) return fields;
  const e = stored.edit;
  const out: Record<string, unknown> = { ...fields };
  for (const k of ['question', 'marks', 'answer', 'slots', 'correct', 'pairs', 'passage', 'lines'] as const) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  if (e.linesDefault !== undefined) out.lines_default = e.linesDefault;
  return out as EditFields;
}

function useDraft(paperId: string): [Draft, (d: Draft) => void] {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(paperId) ?? emptyDraft(paperId));
  const update = (d: Draft) => {
    setDraft(d);
    if (isDirty(d)) saveDraft(d); else clearDraft(paperId);
  };
  return [draft, update];
}

/* ── Edit paper ──────────────────────────────────────────────────────────── */

export function EditPaperPage() {
  const C = useCopy(ASSESSMENT);
  const { paperId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, retry] = useLoad(() => portal.getAssessmentEditQuestions(paperId), `edit:${paperId}`);
  const [draft, setDraft] = useDraft(paperId);
  const [tray, setTray] = useState(false);
  const [kinds, retryKinds] = useLoad(tray ? () => portal.getAssessmentAddKinds(paperId) : null, `kinds:${paperId}:${tray}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = dataOf(data);
  const items = useMemo(() => (d?.items ?? []).map((it: EditItem) => ({
    it,
    removed: isRemovedNow(draft, it.id, it.removed),
    text: draft.edits[it.id]?.text ?? it.text,
    marks: (draft.edits[it.id]?.marks ?? it.marks) + (it.subs ?? []).reduce((sum, s) => {
      const e = draft.edits[`${it.id}#${s.index}`];
      return e && e.edit.marks != null ? sum + (Number(e.edit.marks) - Number(s.fields.marks || 0)) : sum;
    }, 0),
  })), [d, draft]);

  if (data.status !== 'ok' || !d) {
    return (
      <TeacherPage crumb={C.title} title={C.editPaper} backTo={paperPath(paperId)}>
        <LoadState status={data.status} onRetry={retry} />
      </TeacherPage>
    );
  }

  const kept = items.filter((v) => !v.removed);
  const count = kept.length + draft.added.length;
  const marks = kept.reduce((s, v) => s + v.marks, 0) + draft.added.reduce((s, a) => s + a.marks, 0);
  const removedN = items.filter((v) => v.removed).length;
  const canSave = isDirty(draft) && count > 0 && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await portal.saveAssessmentVersion(paperId, toChanges(draft));
      clearDraft(paperId);
      toast({ title: C.saved });
      navigate(paperPath(r.paperId), { replace: true });
    } catch (e) {
      setError(errorOf(e) ?? C.notSaved);
    } finally {
      setBusy(false);
    }
  };

  const section = (which: 'objective' | 'subjective', name: string) => {
    const rows = items.filter((v) => v.it.section === which);
    if (!rows.length) return null;
    return (
      <>
        <p className="mx-1.5 mt-2 text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{name}</p>
        <ListCard label={name}>
          {rows.map(({ it, removed, text, marks: m }, i) => (
            <div key={it.id} className={cn(i > 0 && 'border-t border-[#f0f1f3]', removed && 'bg-[#f9fafb]')}>
              <div className="flex items-center gap-1 pe-0.5">
                {removed ? (
                  <div className="flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 ps-2.5">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[#f3f4f6] text-[13px] font-bold text-[#9ca3af]">{it.number ?? ''}</span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-[14px] text-[#9ca3af] line-through" dir={d.paper.rtl ? 'rtl' : 'ltr'}>{text}</span>
                  </div>
                ) : (
                  <Link to={editQuestionPath(paperId, it.id)} className={cn('flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 ps-2.5', FOCUS)}>
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[#f3f4f6] text-[13px] font-bold text-[#33374a]">{it.number ?? ''}</span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium leading-snug" dir={d.paper.rtl ? 'rtl' : 'ltr'}>{text}</span>
                    {draft.edits[it.id] && <Chip tone="warn">{C.edit}</Chip>}
                  </Link>
                )}
                <span className="min-w-[22px] text-center text-[12px] font-bold text-[#6b7280]">{m}</span>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!removed}
                  aria-label={removed ? C.keepQuestion(it.number ?? '') : C.removeQuestion(it.number ?? '')}
                  onClick={() => setDraft(toggleRemove(draft, it.id, it.removed))}
                  className={cn('flex h-14 w-14 shrink-0 items-center justify-center', FOCUS)}
                >
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-[8px] border-2 text-white', !removed ? 'border-[#33374a] bg-[#33374a]' : 'border-[#c7cad6]')}>
                    {!removed && <Check className="h-4 w-4" strokeWidth={3.2} aria-hidden="true" />}
                  </span>
                </button>
              </div>
              {!removed && (it.subs ?? []).map((s) => (
                <Link
                  key={s.index}
                  to={editQuestionPath(paperId, `${it.id}#${s.index}`)}
                  className={cn('flex min-h-[56px] items-center gap-2.5 border-t border-[#f6f7f8] pe-3 ps-12 text-[14px] text-[#374151]', FOCUS)}
                >
                  <span className="line-clamp-2 min-w-0 flex-1">{draft.edits[`${it.id}#${s.index}`]?.text ?? s.fields.question}</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
                </Link>
              ))}
            </div>
          ))}
        </ListCard>
      </>
    );
  };

  const dock = (
    <>
      <Link to={paperPath(paperId)} className={cn(OUTLINE, 'max-w-[132px]', FOCUS)}>{C.cancel}</Link>
      <button type="button" disabled={!canSave} onClick={save} className={cn(canSave ? PRIMARY : OFF, FOCUS)}>
        {busy ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
        {busy ? C.saving : C.saveAs(d.paper.version + 1)}
      </button>
    </>
  );

  return (
    <TeacherPage
      crumb={C.join(C.title, C.version(d.paper.version))}
      title={C.editPaper}
      backTo={paperPath(paperId)}
      chips={(
        <>
          <Chip>{C.kept(count)}</Chip>
          <Chip>{C.marksCount(marks)}</Chip>
          {removedN > 0 && <Chip tone="warn">{C.removed(removedN)}</Chip>}
          {draft.added.length > 0 && <Chip tone="done">{C.added(draft.added.length)}</Chip>}
        </>
      )}
      dock={dock}
      testId="assessment-edit"
    >
      {error && <p role="alert" className="rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">{error}</p>}
      {section('objective', C.objective)}
      {section('subjective', C.written)}

      {draft.added.length > 0 && (
        <ListCard label={C.newQuestion}>
          {draft.added.map((a, i) => (
            <div key={`added-${i}`} className={cn('flex items-center gap-2 ps-3', i > 0 && 'border-t border-[#f0f1f3]')}>
              <Chip tone="done">{C.newItem}</Chip>
              <span className="line-clamp-2 min-w-0 flex-1 py-3 text-[14px] font-medium" dir={d.paper.rtl ? 'rtl' : 'ltr'}>{a.text}</span>
              <span className="text-[12px] font-bold text-[#6b7280]">{a.marks}</span>
              <button type="button" aria-label={C.removeAdded(i + 1)} onClick={() => setDraft(dropAdded(draft, i))}
                className={cn('flex h-14 w-14 shrink-0 items-center justify-center text-[#6b7280]', FOCUS)}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </ListCard>
      )}

      <button type="button" onClick={() => setTray(true)}
        className={cn('mt-1 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#c7cad6] bg-white text-[16px] font-semibold text-[#33374a]', FOCUS)}>
        <Plus className="h-5 w-5" aria-hidden="true" />
        {C.addQuestion}
      </button>

      <Tray open={tray} title={C.newQuestion} onClose={() => setTray(false)} closeLabel={C.close}>
        {kinds.status !== 'ok'
          ? <LoadState status={kinds.status} onRetry={retryKinds} />
          : (
            <ListCard label={C.newQuestion}>
              {(dataOf(kinds)?.kinds ?? []).map((k, i) => (
                <Link key={k.kind} to={addQuestionPath(paperId, k.kind)}
                  className={cn('flex min-h-[64px] items-center gap-3 px-3.5', i > 0 && 'border-t border-[#f0f1f3]', FOCUS)}>
                  <span className="flex-1 text-[16px] font-semibold">{k.label}</span>
                  <ChevronRight className="h-5 w-5 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
                </Link>
              ))}
            </ListCard>
          )}
      </Tray>
    </TeacherPage>
  );
}

/* ── Edit a question / Add a question ────────────────────────────────────── */

export function EditQuestionPage({ mode }: { mode: 'edit' | 'add' }) {
  const C = useCopy(ASSESSMENT);
  const { paperId = '', key = '', kind: kindId = '' } = useParams();
  const navigate = useNavigate();
  const [data, retry] = useLoad(() => portal.getAssessmentEditQuestions(paperId), `edit:${paperId}`);
  const [kinds, retryKinds] = useLoad(mode === 'add' ? () => portal.getAssessmentAddKinds(paperId) : null, `kinds:${paperId}`);
  const [draft, setDraft] = useDraft(paperId);
  const [values, setValues] = useState<FormValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = dataOf(data);
  const [id, subRaw] = key.split('#');
  const sub = subRaw !== undefined ? Number(subRaw) : null;
  const item = d?.items.find((x) => x.id === id) ?? null;
  const baseFields = item ? (sub !== null ? item.subs?.find((s) => s.index === sub)?.fields : item.fields) ?? null : null;
  const fields = baseFields ? overlay(baseFields, draft.edits[key]) : null;
  const kind = mode === 'add' ? (dataOf(kinds)?.kinds ?? []).find((k) => k.kind === kindId) ?? null : null;
  const slotCap = dataOf(kinds)?.slotCap ?? 6;
  const ready = mode === 'edit' ? !!fields : !!kind;

  if (data.status !== 'ok' || (mode === 'add' && kinds.status !== 'ok')) {
    return (
      <TeacherPage crumb={C.editPaper} title={mode === 'add' ? C.newQuestion : C.question} backTo={editPath(paperId)}>
        <LoadState status={data.status !== 'ok' ? data.status : kinds.status} onRetry={data.status !== 'ok' ? retry : retryKinds} />
      </TeacherPage>
    );
  }
  if (!ready || !d) return <Navigate to={editPath(paperId)} replace />;

  const form = values ?? (mode === 'edit' ? valuesFromFields(fields as EditFields) : blankValues(kind!));

  const done = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'add' && kind) {
        const edit = addedEdit(kind, form);
        const r = await portal.validateAssessmentEdit(paperId, { kind: kind.kind, edit });
        setDraft(addQuestion(draft, { kind: kind.kind, section: kind.section, edit, marks: r.marks, text: r.text }));
      } else if (fields && item) {
        // A re-edit merges over the earlier one: the boxes send only what she changed this time.
        const edit = { ...(draft.edits[key]?.edit ?? {}), ...existingEdit(fields, form) };
        const body = { id: item.id, edit: sub !== null ? { ...edit, subIndex: sub } : edit };
        const r = await portal.validateAssessmentEdit(paperId, body);
        const text = sub !== null ? String(edit.question ?? fields.question ?? '') : r.text;
        setDraft(setEdit(draft, key, { edit: body.edit as Record<string, unknown>, marks: r.marks, text }));
      }
      navigate(editPath(paperId));
    } catch (e) {
      setError(errorOf(e) ?? C.notSaved);
    } finally {
      setBusy(false);
    }
  };

  const dock = (
    <button type="button" disabled={busy} onClick={done} className={cn(busy ? OFF : PRIMARY, FOCUS)}>
      {busy ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
      {busy ? C.checking : C.done}
    </button>
  );

  return (
    <TeacherPage
      crumb={C.join(C.editPaper, mode === 'add' ? kind?.label : item?.type)}
      title={mode === 'add' ? C.newQuestion : C.questionN(sub !== null ? `${item?.number ?? ''}.${sub + 1}` : (item?.number ?? ''))}
      backTo={editPath(paperId)}
      dock={dock}
      testId="assessment-edit-question"
    >
      <QuestionForm
        values={form}
        onChange={setValues}
        fields={mode === 'edit' ? (fields as EditFields) : undefined}
        kind={mode === 'add' ? kind ?? undefined : undefined}
        rtl={!!d.paper.rtl}
        slotCap={slotCap}
      />
      {error && <p role="alert" className="rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">{error}</p>}
      {mode === 'edit' && item && sub === null && (
        <button
          type="button"
          onClick={() => { setDraft(toggleRemove(draft, item.id, item.removed)); navigate(editPath(paperId)); }}
          className={cn(OUTLINE, 'w-full text-[#c8331f]', FOCUS)}
        >
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          {isRemovedNow(draft, item.id, item.removed) ? C.putBack : C.removeFromPaper}
        </button>
      )}
    </TeacherPage>
  );
}
