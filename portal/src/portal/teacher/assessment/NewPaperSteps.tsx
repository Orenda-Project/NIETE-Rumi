import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlignLeft, BookOpen, LayoutList, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { ClassPicker, NumberField, type ClassPick, type GradeSubjectPair } from '../ui';
import { Tray } from '../ui/Tray';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT, type AssessmentV2Copy } from './copy';
import { useCopy } from '../i18n';
import { catalogueOnce, loadChapters, loadTypes, patternFor, patternOffer, subjectName } from './api';
import {
  FDE_STEPS, MAX_TOTAL_MARKS, MAX_TYPES, STEPS, TOPIC_STEPS, checkPages, chosenTypes, defaultTypeCounts, isFde, questionTotal, toSpec,
  unseenTotal, type Picks,
} from './model';
import { FdeCheck } from './FdeCheck';
import { makeErrorText } from './failure';
import { pagesMessage, stepReason } from './reasons';
import { ASSESSMENT_V2_BASE, newPaperPath, requestPath } from './paths';
import { usePicks } from './store';
import { readLink, reportPicks } from './linkPicks';
import { clearTopics, topicsApply } from './topics';
import { useJobs } from './useJobs';
import {
  CheckRow, Chip, Choice, CountRow, Label, ListCard, LoadState, PRIMARY, StepFrame, SwitchRow, Tabs,
} from './ui';
import { portal, type AssessmentPattern } from '../../services/api';

/**
 * bd-fmf24g.6 — the teacher v2 New paper, four steps, each its own route so Back and a reload work; the choices live in
 * ./store. Every option the WhatsApp Flow offers, Word aside (its flag is off in production):
 *
 *   1 Class       the kit's ClassPicker (bd-fmf24g.14): any grade and subject of the live /assessment/options
 *                 catalogue, her classes (GET /me/grade-subjects?feature=assessment) starred, one the
 *                 catalogue cannot make shown and off; a pick goes on to step 2
 *   2 Cover       chapters (several) | page ranges
 *   3 Questions   one screen: the seen count, the unseen types she chose with a count each (Add a type for the rest),
 *                 an optional total marks; the paper is what they add up to
 *   4 Check       every choice with Edit, the Answer lines switch, then Make my paper → the request page
 *
 * The old Question types and Marks and lines steps (their URLs land on Questions; routes.tsx) were folded into 3 and 4.
 */

const backTo = (step: Parameters<typeof newPaperPath>[0]) => newPaperPath(step);

/** No class yet → back to step 1 (a deep link, a cleared tab). */
function needsClassOf(p: Picks) {
  return p.grade === null || !p.subject;
}

const changeClass = (p: Picks, grade: number, subject: string | null, name: string | null): Partial<Picks> => {
  const same = p.grade === grade && p.subject === subject;
  // A new class has other chapters and other types: what she picked for the old one goes.
  if (same) return { subjectName: name };
  const out: Partial<Picks> = { ...clearTopics(p), grade, subject, subjectName: name, chapters: [], ranges: [], typeCounts: {}, typesSeeded: false };
  // …and a board pattern picked for the old class (the side door) goes too; the FDE door's intent is decided by the pick.
  return p.style || p.coverBy === 'fde' ? { ...out, coverBy: 'chapters', style: null, pattern: null } : out;
};

/** The FDE door's pick: an eligible subject keeps the board pattern and goes to Check; any other falls back to today's. */
const doorPick = (pattern: string | null): Partial<Picks> => (pattern
  ? { coverBy: 'fde', style: 'fde', pattern, patternIntent: pattern, chapters: [], ranges: [] }
  : { coverBy: 'chapters', style: null, pattern: null, patternIntent: null });

/* ── 1 Class ─────────────────────────────────────────────────────────────── */

export function ClassStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const navigate = useNavigate();
  // The WhatsApp link for "a paper on topics I've taught" lands here with ?by=topics: remembered, so Topics opens on Select topics.
  const byTopics = useSearchParams()[0].get('by') === 'topics';
  useEffect(() => { if (byTopics && !p.byTopics) set({ byTopics: true }); }, [byTopics, p.byTopics, set]);
  const [combos, retryCombos] = useLoad(() => loadGradeSubjects('assessment'), 'gs:assessment');
  const [cat, retryCat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const catalogue = dataOf(cat);
  // bd-pw1ccr.2 — the A/B report button: ?origin=report tags the paper; its grade, subject and chapter, once the catalogue
  // offers them, start a fresh paper on that chapter and go on to Cover. Applied once per visit.
  const [query] = useSearchParams();
  const link = useMemo(() => readLink(query), [query]);
  const linkDone = useRef(false);
  useEffect(() => {
    if (!link.origin || linkDone.current) return;
    if (link.prefill && !catalogue) return;
    linkDone.current = true;
    const fresh = link.prefill && catalogue ? reportPicks(link.prefill, catalogue, catalogue.defaultQuestions) : null;
    if (fresh) {
      set(fresh);
      navigate(newPaperPath('cover'), { replace: true });
    } else set({ origin: link.origin });
  }, [link, catalogue, set, navigate]);
  const mine = useMemo(() => (dataOf(combos) ?? []).filter((c) => c.grade !== null), [combos]);

  const byGradeNames = useMemo(() => (catalogue
    ? Object.fromEntries(Object.entries(catalogue.byGrade).map(([g, list]) => [g, list.map((s) => s.name)]))
    : undefined), [catalogue]);

  // The FDE door (bd: the door sets patternIntent): the subjects it serves are read once, so a tap goes straight on.
  const door = !!p.patternIntent;
  // Islamiat is held by policy (DESIGN §4.2), not by the server's answer: dim from first paint, and the probe below may only
  // un-hold it, the day the server offers a pattern for it.
  const [held, setHeld] = useState<string[]>(['islamiat']);
  const doorGrades = catalogue?.patternGrades;
  // The door's intent outlives the switch (sessionStorage): when the catalogue offers no board pattern any more, Class is
  // today's Class, with today's eyebrow and steps (as Cover's `gone` reset does).
  const switchedOff = door && cat.status === 'ok' && !!catalogue && !doorGrades?.length;
  useEffect(() => {
    if (switchedOff) set({ patternIntent: null, style: null, pattern: null, coverBy: 'chapters' });
  }, [switchedOff, set]);
  useEffect(() => {
    if (!door || !catalogue || !doorGrades?.length) return undefined;
    let live = true;
    const pairs = doorGrades.flatMap((g) => (catalogue.byGrade[g] ?? []).map((s) => [g, s.key] as const));
    Promise.all(pairs.map(([g, k]) => patternFor(g, k).then((pat) => (pat ? null : k)))).then((off) => {
      if (live) setHeld(off.filter((k): k is string => k === 'islamiat'));
    });
    return () => { live = false; };
  }, [door, catalogue, doorGrades]);

  // The door's read for the tapped class: in flight (said, and a second tap waits) or failed (said, with Try again). A
  // failed read is never taken as "no pattern here": that would drop the teacher on today's Chapters step unasked.
  const [doorRead, setDoorRead] = useState<null | 'busy' | { retry: () => void }>(null);
  const doorBusy = useRef(false);
  // A teacher who leaves Class (Back) while the read is out is not pulled forward when it answers.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const onPick = async (v: GradeSubjectPair, pick: ClassPick) => {
    const own = pick.combo && typeof pick.combo.featureKey === 'string' ? pick.combo.featureKey : null;
    const key = own ?? catalogue?.byGrade[v.grade]?.find((s) => s.name === v.subject)?.key ?? null;
    if (!key) return;
    const name = subjectName(catalogue, v.grade, key) || v.subject;
    if (door) {
      if (doorBusy.current) return;
      doorBusy.current = true;
      setDoorRead('busy');
      let pattern: AssessmentPattern | null;
      try {
        pattern = await patternOffer(v.grade, key);
      } catch {
        doorBusy.current = false;
        if (alive.current) setDoorRead({ retry: () => { onPick(v, pick); } });
        return;
      }
      doorBusy.current = false;
      if (!alive.current) return;
      setDoorRead(null);
      set((cur) => ({ ...changeClass(cur, v.grade, key, name), ...doorPick(pattern ? pattern.id : null) }));
      navigate(newPaperPath(pattern ? 'check' : 'cover'));
      return;
    }
    set((cur) => changeClass(cur, v.grade, key, name));
    navigate(newPaperPath('cover'));
  };

  const value = p.grade !== null && p.subject ? { grade: p.grade, subject: subjectName(catalogue, p.grade, p.subject) || p.subjectName || p.subject } : null;
  // The door (DESIGN 2.2): the grade is fixed (the pattern's grades) and only its subjects are offered, the held one off.
  // Given to the kit's picker as the only pairs, so it opens straight on the subjects (no grade step, no other class).
  const doorPairs = useMemo(() => {
    if (!door || !catalogue || !doorGrades?.length) return null;
    const pairs = doorGrades.flatMap((g) => (catalogue.byGrade[g] ?? []).map((s) => ({
      grade: g, subject: s.name, subjectKey: s.key, featureKey: s.key, available: !held.includes(s.key),
    })));
    return pairs.length ? pairs : null;
  }, [door, catalogue, doorGrades, held]);
  const heldNames = held.map((k) => subjectName(catalogue, 5, k)).filter(Boolean);

  return (
    <StepFrame
      step="class"
      backTo={ASSESSMENT_V2_BASE}
      steps={door ? FDE_STEPS : STEPS}
      crumb={door ? C.fdeDoor : undefined}
      next={{ label: C.next, why: door && doorRead === 'busy' ? C.why.wait : stepReason('class', p, catalogue?.maxQuestions ?? 50, C), to: newPaperPath(isFde(p) ? 'check' : 'cover') }}
    >
      {door && heldNames.length > 0 && (
        <p data-testid="fde-held-note" className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 text-[14px] font-semibold text-[#6b7280]">
          {C.islamiatHeld}
        </p>
      )}
      {door && doorRead === 'busy' && (
        <p data-testid="fde-door-busy" role="status" className="flex min-h-[44px] items-center px-3.5 text-[15px] font-semibold text-[#4b5563]">{C.why.wait}</p>
      )}
      {door && doorRead && doorRead !== 'busy' && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">
          <p>{C.loadFailed}</p>
          <button type="button" onClick={doorRead.retry} className={cn(PRIMARY, 'flex-none', FOCUS)}>{C.tryAgain}</button>
        </div>
      )}
      {combos.status !== 'ok'
        ? <LoadState status={combos.status} onRetry={retryCombos} />
        : cat.status !== 'ok' || !catalogue
          ? <LoadState status={cat.status} onRetry={retryCat} />
          : (
            <ClassPicker
              label={C.selectGradeSubject}
              feature="assessment"
              combos={doorPairs ?? mine}
              allowOther={!doorPairs}
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
  // The side door: the board pattern for this class, when /assessment/options offers it (flag on, Grade 5, eligible).
  const [offer, retryOffer] = useLoad(needsClass ? null : () => patternOffer(p.grade, p.subject), `pattern:${p.grade}:${p.subject}`);
  const pattern = dataOf(offer) ?? null;
  // Board-pattern picks (the side door, a reload, Back from Check) hold until the offer is read: while it loads or after a
  // failed read the step waits and says so; if no pattern is offered any more (its flag went off), the picks go back to
  // today's, so the plain Chapters step shows its tabs and its reason.
  const fdeHeld = isFde(p) || p.coverBy === 'fde';
  const gone = fdeHeld && offer.status === 'ok' && !pattern;
  useEffect(() => {
    if (gone) set({ coverBy: 'chapters', style: null, pattern: null, patternIntent: null, chapters: [], ranges: [] });
  }, [gone, set]);
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;
  if (fdeHeld && !pattern) {
    return (
      <StepFrame step="cover" backTo={backTo('class')} next={{ label: C.next, why: offer.status === 'error' ? C.loadFailed : C.why.wait, to: newPaperPath('check') }}>
        <LoadState status={offer.status === 'error' ? 'error' : 'loading'} onRetry={retryOffer} />
      </StepFrame>
    );
  }

  const toggle = (n: number) => set((cur) => ({
    ...clearTopics(cur),
    chapters: cur.chapters.includes(n) ? cur.chapters.filter((x) => x !== n) : [...cur.chapters, n],
  }));
  const check = checkPages(from, to, lastPage);
  const note = pagesMessage(check, C);
  const fdePicked = !!pattern && isFde(p);
  const flip = () => set(fdePicked
    ? { coverBy: 'chapters', style: null, pattern: null, patternIntent: null }
    : { coverBy: 'fde', style: 'fde', pattern: pattern?.id ?? null });

  if (fdePicked) {
    return (
      <StepFrame step="cover" backTo={backTo('class')} hint={C.skips4} next={{ label: C.next, why: null, to: newPaperPath('check') }}>
        <SideDoor picked onFlip={flip} C={C} grade={p.grade} />
        <p className="px-1.5 text-[15px] font-semibold text-[#6b7280]">{C.chaptersOff}</p>
        {list.length > 0 && (
          <div aria-hidden="true" className="pointer-events-none opacity-40">
            <ListCard label={C.chapters}>
              {list.map((c, i) => (
                <div key={c.chapter_number} className={cn('flex min-h-[56px] items-center gap-3 px-3', i > 0 && 'border-t border-[#f0f1f3]')}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[15px] font-bold text-[#33374a]">{c.chapter_number}</span>
                  <span className="text-[16px] font-semibold leading-snug">{c.chapter_title}</span>
                </div>
              ))}
            </ListCard>
          </div>
        )}
      </StepFrame>
    );
  }

  return (
    <StepFrame step="cover" steps={topicsApply(p) ? TOPIC_STEPS : STEPS} backTo={backTo('class')} next={{ label: C.next, why: stepReason('cover', p, 50, C, { offerFde: !!pattern }), to: newPaperPath(topicsApply(p) ? 'topics' : 'questions') }}>
      {pattern && <SideDoor picked={false} onFlip={flip} C={C} grade={p.grade} />}
      <Tabs
        label={C.steps.cover}
        value={p.coverBy}
        onChange={(k) => set((cur) => ({ ...clearTopics(cur), coverBy: k }))}
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

/** The side door: the FDE board pattern as one pickable card above today's Chapters step (a pattern grade, eligible, flag on). */
function SideDoor({ picked, onFlip, C, grade }: { picked: boolean; onFlip: () => void; C: AssessmentV2Copy; grade: number | null }) {
  return (
    <div data-testid="fde-side-door" role="radiogroup" aria-label={C.styleFde}>
      <Choice picked={picked} onPick={onFlip} icon={<LayoutList className="h-6 w-6" aria-hidden="true" />} name={C.styleFde} sub={C.fdeDoorChips(grade === null ? [] : [grade])} />
    </div>
  );
}

/* ── 3 Questions ─────────────────────────────────────────────────────────── */

const GROUP = 'mx-1.5 mt-2 text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]';

/**
 * The paper's questions on one screen (the operator's pick, 20 Oct; design canvas "Questions · simpler", B v5): the
 * seen questions (the book's own: a count, no types), the unseen types she chose with a count each, Add a type for the
 * rest (the subject's types, Objective and Written, up to MAX_TYPES), and an optional total marks. Every number is a
 * box she can type in or step. The paper is what they add up to, so nothing has to match: the line above Next says it.
 */
export function QuestionsStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const [cat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const max = dataOf(cat)?.maxQuestions ?? 50;
  const defaultCount = dataOf(cat)?.defaultQuestions ?? 15;
  const needsClass = needsClassOf(p);
  const [types, retry] = useLoad(
    needsClass ? null : () => loadTypes(p.grade as number, p.subject as string),
    `types:${p.grade}:${p.subject}`,
  );
  const offered = useMemo(() => dataOf(types) ?? [], [types]);
  const [tray, setTray] = useState(false);
  // A first visit for this class starts with the default mix; after that the page is hers (a class change clears it).
  const seedNow = !needsClass && !p.typesSeeded && types.status === 'ok';
  useEffect(() => {
    if (!seedNow) return;
    set((cur) => (cur.typesSeeded ? {} : { typeCounts: defaultTypeCounts(offered, Math.max(1, defaultCount - cur.seen)), typesSeeded: true }));
  }, [seedNow, offered, defaultCount, set]);
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;

  const total = questionTotal(p);
  const unseen = unseenTotal(p);
  const rows = Object.entries(p.typeCounts);
  const full = total >= max;
  const over = total > max;
  const marks = p.marks;
  const marksBad = marks !== null && (marks < 1 || marks > MAX_TOTAL_MARKS || marks < total);
  const num = (d: string) => Number(d || '0');
  const setCount = (id: string, n: number) => set((cur) => ({ typeCounts: { ...cur.typeCounts, [id]: Math.max(0, n) } }));
  const remove = (id: string) => set((cur) => {
    const next = { ...cur.typeCounts };
    delete next[id];
    return { typeCounts: next };
  });
  const add = (id: string) => set((cur) => ({ typeCounts: { ...cur.typeCounts, [id]: 1 } }));

  const group = (category: 'objective' | 'subjective', name: string) => {
    const list = offered.filter((t) => t.category === category);
    if (list.length === 0) return null;
    return (
      <>
        <p className={GROUP}>{name}</p>
        <ListCard label={name}>
          {list.map((t, i) => {
            const on = t.id in p.typeCounts;
            return (
              <CheckRow
                key={t.id}
                first={i === 0}
                checked={on}
                disabled={!on && rows.length >= MAX_TYPES}
                onToggle={() => (on ? remove(t.id) : add(t.id))}
                label={<span className="min-w-0 flex-1 text-[16px] font-semibold">{t.id}</span>}
              />
            );
          })}
        </ListCard>
      </>
    );
  };

  const totalLine = (
    <span data-testid="questions-total">
      {C.join(C.questionsCount(total), C.seenShort(p.seen), C.unseenShort(unseen), marks !== null ? C.marksCount(marks) : null)}
    </span>
  );

  return (
    <StepFrame step="questions" steps={p.topicScope ? TOPIC_STEPS : STEPS} backTo={backTo(p.topicScope ? 'topics' : 'cover')} hint={totalLine} next={{ label: C.next, why: stepReason('questions', p, max, C), to: newPaperPath('check') }}>
      <h2 className="mx-1 mt-3 text-[20px] font-bold leading-snug">{C.askCount}</h2>

      <p className={GROUP}>{C.seenQuestions}</p>
      <ListCard label={C.seenQuestions}>
        <CountRow
          first
          name={C.asInBook}
          ariaName={C.typeCount(C.seenQuestions)}
          value={String(p.seen)}
          dim={p.seen === 0}
          error={over && p.seen > 0}
          onType={(d) => set({ seen: num(d) })}
          onLess={() => set({ seen: Math.max(0, p.seen - 1) })}
          onMore={() => set({ seen: p.seen + 1 })}
          canLess={p.seen > 0}
          canMore={!full}
          lessLabel={C.fewerOf(C.seenQuestions)}
          moreLabel={C.moreOf(C.seenQuestions)}
          testId="count-seen"
        />
      </ListCard>

      <p className={GROUP}>{C.unseenQuestions}</p>
      <ListCard label={C.unseenQuestions}>
        {rows.map(([id, n], i) => (
          <CountRow
            key={id}
            first={i === 0}
            name={id}
            ariaName={C.typeCount(id)}
            value={String(n)}
            dim={n === 0}
            error={over && n > 0}
            bin={n <= 1}
            onType={(d) => setCount(id, num(d))}
            onLess={() => (n <= 1 ? remove(id) : setCount(id, n - 1))}
            onMore={() => setCount(id, n + 1)}
            canLess
            canMore={!full}
            lessLabel={n <= 1 ? C.removeType(id) : C.fewerOf(id)}
            moreLabel={C.moreOf(id)}
            testId={`type-count-${id}`}
          />
        ))}
        <button
          type="button"
          data-testid="add-type"
          onClick={() => setTray(true)}
          className={cn('flex min-h-[60px] w-full items-center justify-center gap-2 text-[16px] font-semibold text-[#33374a]', rows.length > 0 && 'border-t border-dashed border-[#c7cad6]', FOCUS)}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {C.addType}
        </button>
      </ListCard>

      <p className={GROUP}>{C.totalMarks}</p>
      <ListCard label={C.totalMarks}>
        <CountRow
          first
          name={<>{C.wholePaper}<Chip>{C.optional}</Chip></>}
          ariaName={C.totalMarks}
          value={marks === null ? '' : String(marks)}
          dim={marks === null}
          error={marksBad}
          maxLength={4}
          onType={(d) => set({ marks: d === '' ? null : Number(d) })}
          // As the old Marks step: steps of 5; the first + suggests 2 a question; down past 5 clears it (no limit).
          onLess={() => set({ marks: marks === null || marks <= 5 ? null : marks - 5 })}
          onMore={() => set({ marks: marks === null ? Math.min(MAX_TOTAL_MARKS, Math.max(5, total * 2)) : Math.min(MAX_TOTAL_MARKS, marks + 5) })}
          canLess={marks !== null}
          canMore={marks === null || marks < MAX_TOTAL_MARKS}
          lessLabel={C.fewerOf(C.marks)}
          moreLabel={C.moreOf(C.marks)}
          testId="total-marks"
        />
      </ListCard>

      <Tray open={tray} title={C.steps.types} onClose={() => setTray(false)} closeLabel={C.close} testId="types-tray">
        {types.status !== 'ok'
          ? <LoadState status={types.status} onRetry={retry} />
          : <>{group('objective', C.objective)}{group('subjective', C.written)}</>}
        <p className="px-1.5 text-[14px] font-semibold text-[#6b7280]">{C.typesCap(rows.length, MAX_TYPES)}</p>
        <button type="button" onClick={() => setTray(false)} className={cn(PRIMARY, 'flex-none', FOCUS)}>{C.done}</button>
      </Tray>
    </StepFrame>
  );
}

/* ── 6 Check and make ────────────────────────────────────────────────────── */

export function CheckStep() {
  const [p] = usePicks();
  if (isFde(p)) return <FdeCheck />;
  return <PlainCheck />;
}

function PlainCheck() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
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
  // The job's name: the first chapter's title, or its number when Make is tapped before the titles have loaded.
  const firstChapters = [...p.chapters].sort((a, b) => a - b);
  const coverName = p.coverBy === 'chapters'
    ? (titles.length ? `${titles[0].chapter_title}${titles.length > 1 ? ` +${titles.length - 1}` : ''}`
      : firstChapters.length ? `${C.chapterShort(firstChapters[0])}${firstChapters.length > 1 ? ` +${firstChapters.length - 1}` : ''}` : C.chapters)
    : (p.ranges.length ? C.pageRange(p.ranges[0][0], p.ranges[0][1]) : C.pages);
  // One Questions row: the count, then its seen / unseen parts, then the unseen types (as she chose them on Questions).
  const unseen = unseenTotal(p);
  const typesLine = chosenTypes(p).map(([id, n]) => `${id} ${n}`).join(' · ');
  const questionsSub = (
    <>
      <span className="block">{C.join(C.seenShort(p.seen), C.unseenShort(unseen))}</span>
      {typesLine && <span className="block">{typesLine}</span>}
    </>
  );

  const rows: Array<{ k: string; v: ReactNode; sub?: ReactNode; to?: string }> = [
    { k: C.steps.class, v: C.gradeSubject(p.grade as number, p.subjectName ?? p.subject ?? ''), to: newPaperPath('class') },
    { k: p.coverBy === 'chapters' ? C.chapters : C.pages, v: cover.map((c) => <span key={c} className="block">{c}</span>), to: newPaperPath('cover') },
    ...(p.topicScope ? [{ k: C.steps.topics, v: p.topicIds?.length ? C.picked(p.topicIds.length) : C.wholeChapter, to: newPaperPath('topics') }] : []),
    { k: C.steps.questions, v: C.questionsCount(questionTotal(p)), sub: questionsSub, to: newPaperPath('questions') },
    { k: C.totalMarks, v: p.marks === null ? C.noLimit : C.marksCount(p.marks), to: newPaperPath('questions') },
  ];

  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await start(toSpec(p), coverName, p.subjectName ?? p.subject);
    setBusy(false);
    if ('job' in res) { navigate(requestPath(res.job.requestId), { replace: true }); return; }
    // The hour's paper limit (the server's 429) in the teacher's words and time; any other refusal keeps the server's message.
    const f = portal.takeGenerateFailure?.() ?? null;
    setError(makeErrorText(res.error, f, C));
  };

  return (
    <StepFrame step="check" steps={p.topicScope ? TOPIC_STEPS : STEPS} backTo={backTo('questions')} next={{ label: busy ? C.making : C.makePaper, why: stepReason('check', p, 50, C), onPress: make, busy }}>
      {/* Above the rows, as on the board-pattern Check: under them it sits below the fold, behind the dock. */}
      {error && <p role="alert" className="rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">{error}</p>}
      <ListCard label={C.steps.check}>
        {rows.map((r, i) => (
          <div key={r.k} className={cn('flex min-h-[72px] items-center gap-3 py-2 ps-3.5 pe-1.5', i > 0 && 'border-t border-[#f0f1f3]')}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-[#6b7280]">{r.k}</span>
              <span className="text-[16px] font-semibold leading-snug">{r.v}</span>
              {r.sub && <span className="text-[13px] leading-snug text-[#4b5563]">{r.sub}</span>}
            </span>
            {r.to
              ? <Link to={r.to} className={cn('flex min-h-[56px] min-w-[72px] items-center justify-center rounded-[14px] px-3 text-[15px] font-semibold text-[#33374a]', FOCUS)}>{C.edit}</Link>
              : <span className="pe-3 text-[13px] font-semibold text-[#6b7280]">{C.fixed}</span>}
          </div>
        ))}
      </ListCard>
      {/* Answer lines moved here from the old Marks and lines step: the one choice it had left. */}
      <SwitchRow on={p.answerLines} onFlip={() => set({ answerLines: !p.answerLines })}
        icon={<AlignLeft className="h-6 w-6" aria-hidden="true" />} name={C.answerLines} />
    </StepFrame>
  );
}
