import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlignLeft, BookOpen, ListChecks, Plus, Shuffle, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { ClassPicker, NumberField, type ClassPick, type GradeSubjectPair } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { catalogueOnce, loadChapters, loadTypes, subjectName } from './api';
import {
  MAX_TOTAL_MARKS, checkPages, toSpec, typesStatus, unseenTarget, type Picks, type Source,
} from './model';
import { pagesMessage, stepReason } from './reasons';
import { ASSESSMENT_V2_BASE, newPaperPath, requestPath } from './paths';
import { usePicks } from './store';
import { useJobs } from './useJobs';
import {
  CheckRow, Chip, Choice, Label, ListCard, LoadState, StepFrame, Stepper, SwitchRow, Tabs,
} from './ui';

/**
 * bd-fmf24g.6 — the teacher v2 New paper, six steps (v28 canvas AssessmentNew … AssessConfirm), each its
 * own route so Back and a reload work; the choices live in ./store. Every option the WhatsApp Flow
 * offers, Word aside (its flag is off in production):
 *
 *   1 Class       the kit's ClassPicker (bd-fmf24g.14): any grade and subject of the live /assessment/options
 *                 catalogue, her classes (GET /me/grade-subjects?feature=assessment) starred, one the
 *                 catalogue cannot make shown and off; a pick goes on to step 2
 *   2 Cover       chapters (several) | page ranges
 *   3 Questions   how many (the bot's cap) · from the book / new / a mix, and on a mix how many from the book
 *   4 Types       Auto mix | her types and how many of each, adding up to the new questions
 *   5 Extras      a total-marks budget or none · answer lines
 *   6 Check       every choice with Edit, then Make paper → the request page
 */

const backTo = (step: Parameters<typeof newPaperPath>[0]) => newPaperPath(step);

/** No class yet → back to step 1 (a deep link, a cleared tab). */
function needsClassOf(p: Picks) {
  return p.grade === null || !p.subject;
}

const changeClass = (p: Picks, grade: number, subject: string | null, name: string | null): Partial<Picks> => {
  const same = p.grade === grade && p.subject === subject;
  // A new class has other chapters and other types: what she picked for the old one goes.
  return same ? { subjectName: name } : { grade, subject, subjectName: name, chapters: [], ranges: [], typeCounts: {}, typeMode: 'auto' };
};

/* ── 1 Class ─────────────────────────────────────────────────────────────── */

export function ClassStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const navigate = useNavigate();
  const [combos, retryCombos] = useLoad(() => loadGradeSubjects('assessment'), 'gs:assessment');
  const [cat, retryCat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const catalogue = dataOf(cat);
  const mine = useMemo(() => (dataOf(combos) ?? []).filter((c) => c.grade !== null), [combos]);

  const byGradeNames = useMemo(() => (catalogue
    ? Object.fromEntries(Object.entries(catalogue.byGrade).map(([g, list]) => [g, list.map((s) => s.name)]))
    : undefined), [catalogue]);

  const onPick = (v: GradeSubjectPair, pick: ClassPick) => {
    const own = pick.combo && typeof pick.combo.featureKey === 'string' ? pick.combo.featureKey : null;
    const key = own ?? catalogue?.byGrade[v.grade]?.find((s) => s.name === v.subject)?.key ?? null;
    if (!key) return;
    set((cur) => changeClass(cur, v.grade, key, subjectName(catalogue, v.grade, key) || v.subject));
    navigate(newPaperPath('cover'));
  };

  const value = p.grade !== null && p.subject ? { grade: p.grade, subject: subjectName(catalogue, p.grade, p.subject) || p.subjectName || p.subject } : null;

  return (
    <StepFrame
      step="class"
      backTo={ASSESSMENT_V2_BASE}
      next={{ label: C.next, why: stepReason('class', p, catalogue?.maxQuestions ?? 50, C), to: newPaperPath('cover') }}
    >
      {combos.status !== 'ok'
        ? <LoadState status={combos.status} onRetry={retryCombos} />
        : cat.status !== 'ok' || !catalogue
          ? <LoadState status={cat.status} onRetry={retryCat} />
          : (
            <ClassPicker
              label={C.selectGradeSubject}
              feature="assessment"
              combos={mine}
              subjectsByGrade={byGradeNames}
              grades={catalogue.grades}
              value={value}
              onChange={onPick}
            />
          )}
    </StepFrame>
  );
}

/* ── 2 Chapters or pages ─────────────────────────────────────────────────── */

export function CoverStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const needsClass = needsClassOf(p);
  const [chapters, retry] = useLoad(
    needsClass ? null : () => loadChapters(p.grade as number, p.subject as string),
    `chapters:${p.grade}:${p.subject}`,
  );
  const list = dataOf(chapters) ?? [];
  const lastPage = list.reduce((m, c) => Math.max(m, c.page_end ?? 0), 0) || null;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;

  const toggle = (n: number) => set((cur) => ({
    chapters: cur.chapters.includes(n) ? cur.chapters.filter((x) => x !== n) : [...cur.chapters, n],
  }));
  const check = checkPages(from, to, lastPage);
  const note = pagesMessage(check, C);

  return (
    <StepFrame step="cover" backTo={backTo('class')} next={{ label: C.next, why: stepReason('cover', p, 50, C), to: newPaperPath('questions') }}>
      <Tabs
        label={C.steps.cover}
        value={p.coverBy}
        onChange={(k) => set({ coverBy: k })}
        options={[{ key: 'chapters', label: C.chapters }, { key: 'pages', label: C.pages }]}
      />
      {p.coverBy === 'chapters' && (
        <>
          <Label chip={<Chip tone="indigo">{C.picked(p.chapters.length)}</Chip>}>{C.chapters}</Label>
          {chapters.status !== 'ok'
            ? <LoadState status={chapters.status} onRetry={retry} />
            : list.length === 0
              ? <LoadState status="ok" empty onRetry={retry} />
              : (
                <ListCard label={C.chapters}>
                  {list.map((c, i) => (
                    <CheckRow
                      key={c.chapter_number}
                      first={i === 0}
                      checked={p.chapters.includes(c.chapter_number)}
                      onToggle={() => toggle(c.chapter_number)}
                      label={(
                        <>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[15px] font-bold text-[#33374a]">{c.chapter_number}</span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-[16px] font-semibold leading-snug">{c.chapter_title}</span>
                            {c.page_start != null && <span className="text-[13px] text-[#6b7280]">{C.pagesSpan(c.page_start, c.page_end)}</span>}
                          </span>
                        </>
                      )}
                    />
                  ))}
                </ListCard>
              )}
        </>
      )}
      {p.coverBy === 'pages' && (
        <>
          <Label chip={lastPage ? <Chip>{C.bookPages(lastPage)}</Chip> : undefined}>{C.pages}</Label>
          {p.ranges.length > 0 && (
            <ListCard label={C.pages}>
              {p.ranges.map(([a, b], i) => (
                <div key={`${a}-${b}-${i}`} className={cn('flex min-h-[64px] items-center gap-3 ps-3.5', i > 0 && 'border-t border-[#f0f1f3]')}>
                  <BookOpen className="h-5 w-5 text-[#33374a]" aria-hidden="true" />
                  <span className="flex-1 text-[17px] font-semibold">{C.pageRange(a, b)}</span>
                  <button
                    type="button"
                    aria-label={C.removePages}
                    onClick={() => set((cur) => ({ ranges: cur.ranges.filter((_, j) => j !== i) }))}
                    className={cn('flex h-14 w-14 items-center justify-center text-[#6b7280]', FOCUS)}
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </ListCard>
          )}
          <div className="flex gap-2.5">
            <NumberField label={C.fromPage} value={from} onChange={setFrom} error={!!note && note.tone === 'error'} describedBy="pages-note" testId="pages-from" />
            <NumberField label={C.toPage} value={to} onChange={setTo} error={!!note && note.tone === 'error'} describedBy="pages-note" testId="pages-to" />
          </div>
          <p
            id="pages-note"
            role="status"
            data-testid="pages-note"
            className={cn('min-h-[24px] px-1.5 text-[15px] font-semibold', note?.tone === 'error' ? 'text-[#c8331f]' : 'text-[#6b7280]')}
          >
            {note?.text ?? ''}
          </p>
          <button
            type="button"
            disabled={!check.ok}
            aria-describedby="pages-note"
            onClick={() => {
              if (!check.ok) return;
              set((cur) => ({ ranges: [...cur.ranges, [check.from, check.to] as [number, number]] }));
              setFrom('');
              setTo('');
            }}
            className={cn(
              'flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] text-[16px] font-semibold',
              check.ok ? 'border-dashed border-[#c7cad6] bg-white text-[#33374a]' : 'cursor-not-allowed border-[#e5e7eb] bg-[#e5e7eb] text-[#9ca3af]',
              FOCUS,
            )}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            {C.addPages}
          </button>
        </>
      )}
    </StepFrame>
  );
}

/* ── 3 Questions ─────────────────────────────────────────────────────────── */

const SOURCE_ICON: Record<Source, JSX.Element> = {
  seen: <BookOpen className="h-6 w-6" aria-hidden="true" />,
  unseen: <Sparkles className="h-6 w-6" aria-hidden="true" />,
  both: <Shuffle className="h-6 w-6" aria-hidden="true" />,
};

export function QuestionsStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const [cat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const max = dataOf(cat)?.maxQuestions ?? 50;
  if (needsClassOf(p)) return <Navigate to={newPaperPath('class')} replace />;

  const setCount = (n: number) => set((cur) => {
    const count = Math.max(1, Math.min(max, n));
    return { count, seen: Math.max(1, Math.min(cur.seen, count - 1)) };
  });
  const quick = [10, 15, 20, 25, 30].filter((n) => n <= max);
  const pct = Math.round((p.seen / Math.max(1, p.count)) * 100);

  return (
    <StepFrame step="questions" backTo={backTo('cover')} next={{ label: C.next, why: stepReason('questions', p, max, C), to: newPaperPath('types') }}>
      <Label chip={<Chip>{C.upTo(max)}</Chip>}>{C.howMany}</Label>
      <div role="radiogroup" aria-label={C.howMany} className="flex gap-2">
        {quick.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={p.count === n}
            onClick={() => setCount(n)}
            className={cn(
              'flex min-h-[56px] flex-1 items-center justify-center rounded-[14px] border text-[18px] font-bold tabular-nums',
              p.count === n ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white',
              FOCUS,
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <Stepper value={p.count} sub={C.questions} lessLabel={C.fewer} moreLabel={C.more}
        canLess={p.count > 1} canMore={p.count < max}
        onLess={() => setCount(p.count - 1)} onMore={() => setCount(p.count + 1)} />

      <Label>{C.fromWhere}</Label>
      <div role="radiogroup" aria-label={C.fromWhere} className="flex flex-col gap-2.5">
        {(['seen', 'unseen', 'both'] as Source[]).map((s) => (
          <Choice
            key={s}
            picked={p.source === s}
            onPick={() => set((cur) => ({ source: s, seen: Math.max(1, Math.min(cur.seen, cur.count - 1)) }))}
            icon={SOURCE_ICON[s]}
            name={C.sources[s].name}
            sub={C.sources[s].sub}
          />
        ))}
      </div>

      {p.source === 'both' && (
        <>
          <Label>{C.fromBook}</Label>
          <Stepper value={p.seen} sub={C.ofCount(p.count)} lessLabel={C.fewer} moreLabel={C.more}
            canLess={p.seen > 1} canMore={p.seen < p.count - 1}
            onLess={() => set((cur) => ({ seen: Math.max(1, cur.seen - 1) }))}
            onMore={() => set((cur) => ({ seen: Math.min(cur.count - 1, cur.seen + 1) }))} />
          <div className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white p-3" aria-hidden="true">
            <div className="flex h-3 overflow-hidden rounded-full bg-[#e5e7eb]">
              <span className="bg-[#33374a]" style={{ width: `${pct}%` }} />
              <span className="bg-[#8b90a6]" style={{ width: `${100 - pct}%` }} />
            </div>
            <div className="flex justify-between text-[13px] font-semibold text-[#374151]">
              <span>{C.bookShort(p.seen)}</span>
              <span>{C.newShort(p.count - p.seen)}</span>
            </div>
          </div>
        </>
      )}
    </StepFrame>
  );
}

/* ── 4 Question types ────────────────────────────────────────────────────── */

export function TypesStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const needsClass = needsClassOf(p);
  const [types, retry] = useLoad(
    needsClass || p.source === 'seen' ? null : () => loadTypes(p.grade as number, p.subject as string),
    `types:${p.grade}:${p.subject}`,
  );
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;
  const status = typesStatus(p);
  const { total, target } = status;
  const all = dataOf(types) ?? [];
  const setCount = (id: string, n: number) => set((cur) => {
    const next = { ...cur.typeCounts };
    if (n <= 0) delete next[id]; else next[id] = n;
    return { typeCounts: next };
  });

  const group = (category: 'objective' | 'subjective', name: string) => {
    const rows = all.filter((t) => t.category === category);
    if (rows.length === 0) return null;
    return (
      <>
        <p className="mx-1.5 mt-2 text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{name}</p>
        <ListCard label={name}>
          {rows.map((t, i) => {
            const n = p.typeCounts[t.id] ?? 0;
            return (
              <div key={t.id} className={cn('flex min-h-[72px] items-center gap-3 px-3 py-2', i > 0 && 'border-t border-[#f0f1f3]', n > 0 && 'bg-[#f4f5f8]')}>
                <NumberField
                  size="row"
                  value={String(n)}
                  dim={n === 0}
                  maxLength={3}
                  ariaLabel={C.typeCount(t.id)}
                  describedBy="types-total"
                  error={status.kind === 'over' && n > 0}
                  onChange={(d) => setCount(t.id, Number(d || '0'))}
                  testId={`type-count-${t.id}`}
                />
                <span className="min-w-0 flex-1 text-[16px] font-semibold">{t.id}</span>
              </div>
            );
          })}
        </ListCard>
      </>
    );
  };

  return (
    <StepFrame step="types" backTo={backTo('questions')} next={{ label: C.next, why: stepReason('types', p, 50, C), to: newPaperPath('extras') }}>
      {p.source === 'seen' ? (
        <div className={cn('flex items-center gap-3.5 p-4', CARD)}>
          <BookOpen className="h-6 w-6 text-[#33374a]" aria-hidden="true" />
          <span className="text-[16px] font-semibold">{C.bookOnly}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-1 text-[14px] font-semibold text-[#374151]">
            {C.newCount}<Chip>{target}</Chip>
            {p.source === 'both' && <>{C.bookCount}<Chip>{p.seen}</Chip></>}
          </div>
          <div role="radiogroup" aria-label={C.steps.types} className="flex flex-col gap-2.5">
            <Choice picked={p.typeMode === 'auto'} onPick={() => set({ typeMode: 'auto' })}
              icon={<Sparkles className="h-6 w-6" aria-hidden="true" />} name={C.autoMix} />
            <Choice picked={p.typeMode === 'pick'} onPick={() => set({ typeMode: 'pick' })}
              icon={<ListChecks className="h-6 w-6" aria-hidden="true" />} name={C.chooseTypes} />
          </div>
          {p.typeMode === 'pick' && (
            types.status !== 'ok'
              ? <LoadState status={types.status} onRetry={retry} />
              : (
                <>
                  <Label>{C.howManyEach}</Label>
                  <div
                    id="types-total"
                    role="status"
                    data-testid="types-total"
                    className={cn(
                      'flex flex-col gap-1 rounded-2xl border p-3.5',
                      status.kind === 'over' ? 'border-[#f5b5ad] bg-[#fff8f7]' : status.kind === 'ok' ? 'border-[#e5e7eb] bg-white' : 'border-[#fde68a] bg-[#fffbeb]',
                    )}
                  >
                    <b className="text-[24px] font-bold tabular-nums text-[#1d2025]">{C.why.totalOf(total, target)}</b>
                    <span className={cn('text-[15px] font-semibold', status.kind === 'over' ? 'text-[#c8331f]' : status.kind === 'ok' ? 'text-[#2f7a52]' : 'text-[#b45309]')}>
                      {status.kind === 'none' ? C.why.typesNone : status.kind === 'over' ? C.why.over(status.diff) : status.kind === 'under' ? C.why.under(-status.diff) : C.why.allAdded(target)}
                    </span>
                  </div>
                  {group('objective', C.objective)}
                  {group('subjective', C.written)}
                </>
              )
          )}
        </>
      )}
    </StepFrame>
  );
}

/* ── 5 Marks and lines ───────────────────────────────────────────────────── */

export function ExtrasStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  if (needsClassOf(p)) return <Navigate to={newPaperPath('class')} replace />;
  const marks = p.marks;
  return (
    <StepFrame step="extras" backTo={backTo('types')} next={{ label: C.next, why: stepReason('extras', p, 50, C), to: newPaperPath('check') }}>
      <Label chip={<Chip>{C.optional}</Chip>}>{C.totalMarks}</Label>
      <Tabs
        label={C.totalMarks}
        value={marks === null ? 'none' : 'set'}
        onChange={(k) => set({ marks: k === 'none' ? null : Math.min(MAX_TOTAL_MARKS, Math.max(5, p.count * 2)) })}
        options={[{ key: 'none', label: C.noLimit }, { key: 'set', label: C.setTotal }]}
      />
      {marks !== null && (
        <Stepper value={marks} sub={C.marks} lessLabel={C.fewer} moreLabel={C.more}
          canLess={marks > 1} canMore={marks < MAX_TOTAL_MARKS}
          onLess={() => set({ marks: Math.max(1, marks - 5) })}
          onMore={() => set({ marks: Math.min(MAX_TOTAL_MARKS, marks + 5) })} />
      )}
      <Label>{C.onPaper}</Label>
      <SwitchRow on={p.answerLines} onFlip={() => set({ answerLines: !p.answerLines })}
        icon={<AlignLeft className="h-6 w-6" aria-hidden="true" />} name={C.answerLines} />
    </StepFrame>
  );
}

/* ── 6 Check and make ────────────────────────────────────────────────────── */

export function CheckStep() {
  const C = useCopy(ASSESSMENT);
  const [p] = usePicks();
  const navigate = useNavigate();
  const { start } = useJobs();
  const needsClass = needsClassOf(p);
  const [chapters] = useLoad(
    needsClass || p.coverBy !== 'chapters' ? null : () => loadChapters(p.grade as number, p.subject as string),
    `chapters:${p.grade}:${p.subject}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;

  const titles = (dataOf(chapters) ?? []).filter((c) => p.chapters.includes(c.chapter_number))
    .sort((a, b) => a.chapter_number - b.chapter_number);
  const cover = p.coverBy === 'chapters'
    ? titles.map((c) => `${c.chapter_number} ${c.chapter_title}`)
    : p.ranges.map(([a, b]) => C.pageRange(a, b));
  const coverName = p.coverBy === 'chapters'
    ? (titles.length ? `${titles[0].chapter_title}${titles.length > 1 ? ` +${titles.length - 1}` : ''}` : C.chapters)
    : (p.ranges.length ? C.pageRange(p.ranges[0][0], p.ranges[0][1]) : C.pages);
  const typesLine = p.source === 'seen' ? C.bookOnly
    : p.typeMode === 'auto' ? C.autoMix
      : Object.entries(p.typeCounts).filter(([, n]) => n > 0).map(([id, n]) => `${id} ${n}`).join(' · ');
  const questionsLine = p.source === 'both'
    ? C.join(C.questionsCount(p.count), C.bookShort(p.seen), C.newShort(p.count - p.seen))
    : C.join(C.questionsCount(p.count), C.sources[p.source].name);

  const rows: Array<{ k: string; v: ReactNode; to?: string }> = [
    { k: C.steps.class, v: C.gradeSubject(p.grade as number, p.subjectName ?? p.subject ?? ''), to: newPaperPath('class') },
    { k: p.coverBy === 'chapters' ? C.chapters : C.pages, v: cover.map((c) => <span key={c} className="block">{c}</span>), to: newPaperPath('cover') },
    { k: C.steps.questions, v: questionsLine, to: newPaperPath('questions') },
    { k: C.steps.types, v: typesLine, to: newPaperPath('types') },
    { k: C.totalMarks, v: p.marks === null ? C.noLimit : C.marksCount(p.marks), to: newPaperPath('extras') },
    { k: C.answerLines, v: p.answerLines ? C.on : C.off, to: newPaperPath('extras') },
    { k: C.file, v: C.pdfWithKey },
  ];

  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await start(toSpec(p), coverName, p.subjectName ?? p.subject);
    setBusy(false);
    if ('job' in res) navigate(requestPath(res.job.requestId), { replace: true });
    else setError(res.error);
  };

  return (
    <StepFrame step="check" backTo={backTo('extras')} next={{ label: busy ? C.making : C.makePaper, why: stepReason('check', p, 50, C), onPress: make, busy }}>
      <ListCard label={C.steps.check}>
        {rows.map((r, i) => (
          <div key={r.k} className={cn('flex min-h-[72px] items-center gap-3 py-2 ps-3.5 pe-1.5', i > 0 && 'border-t border-[#f0f1f3]')}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-[#6b7280]">{r.k}</span>
              <span className="text-[16px] font-semibold leading-snug">{r.v}</span>
            </span>
            {r.to
              ? <Link to={r.to} className={cn('flex min-h-[56px] min-w-[72px] items-center justify-center rounded-[14px] px-3 text-[15px] font-semibold text-[#33374a]', FOCUS)}>{C.edit}</Link>
              : <span className="pe-3 text-[13px] font-semibold text-[#6b7280]">{C.fixed}</span>}
          </div>
        ))}
      </ListCard>
      {error && <p role="alert" className="rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">{error}</p>}
    </StepFrame>
  );
}
