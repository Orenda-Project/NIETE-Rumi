import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, FilePen, Info, LayoutList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { portal, type AssessmentPattern, type BiText } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { Tray } from '../ui/Tray';
import { isolateRuns } from '../ui/bidi';
import { FOCUS } from '../ui/styles';
import { useCopy, useLang } from '../i18n';
import { ASSESSMENT, type AssessmentV2Copy } from './copy';
import { loadChapters, patternOffer } from './api';
import { makeErrorText } from './failure';
import { FDE_STEPS, fdeUnitRanges, toSpec, type Picks } from './model';
import { newPaperPath, requestPath } from './paths';
import { stepReason } from './reasons';
import { usePicks } from './store';
import { useJobs } from './useJobs';
import { CheckRow, Chip, Choice, ListCard, LoadState, PRIMARY, StepFrame } from './ui';

/**
 * The FDE board pattern's Check and make (DESIGN v2 §2.6): ONE screen after the class. Rows Paper style · Class ·
 * Syllabus (each with Edit) · Inside ›, the amber You add row when the paper needs one, and Make my paper under a one-line
 * hint. Scope and style are trays on this screen, not steps. Every line about the paper (its sections, its choice, its
 * files, what the teacher adds, the FDE syllabus) is DATA from /assessment/options' `patterns[0]`, never typed here, so a
 * pattern change needs no app release.
 */

/**
 * The line in the teacher's language. On an Urdu page the data's Latin and number runs ("FDE", "2026–27", "1–8") go
 * through the kit's own egress (isolateRuns), as every kit row does, or a range prints backwards (language-protocol §8).
 */
const pick = (t: BiText | null | undefined, lang: 'en' | 'ur') => {
  const text = t ? t[lang] || t.en : '';
  return lang === 'ur' ? isolateRuns(text) : text;
};

/** A Check row: label, value (and a sub-line), and its action at the end. The whole row is the button. */
function Row({ testId, label, value, sub, action, onPress, to, first }: {
  testId: string; label: string; value: ReactNode; sub?: ReactNode; action?: ReactNode; onPress?: () => void; to?: string; first?: boolean;
}) {
  const cls = cn(
    'flex min-h-[72px] w-full items-center gap-3 py-2 ps-3.5 pe-1.5 text-start',
    !first && 'border-t border-[#f0f1f3]',
    FOCUS,
  );
  const inner = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-[#6b7280]">{label}</span>
        <span className="text-[16px] font-semibold leading-snug">{value}</span>
        {sub && <span className="text-[13px] leading-snug text-[#4b5563]">{sub}</span>}
      </span>
      {action}
    </>
  );
  if (to) return <Link to={to} data-testid={testId} className={cls}>{inner}</Link>;
  if (onPress) return <button type="button" data-testid={testId} onClick={onPress} className={cls}>{inner}</button>;
  return <div data-testid={testId} className={cls}>{inner}</div>;
}

const EditWord = ({ C }: { C: AssessmentV2Copy }) => (
  <span className="flex min-h-[56px] min-w-[72px] items-center justify-center rounded-[14px] px-3 text-[15px] font-semibold text-[#33374a]">{C.edit}</span>
);

/** The units the teacher keeps on a customised FDE paper, as the picks for the request: pages when the pattern gives them per unit. */
function customised(pattern: AssessmentPattern, units: number[]): Partial<Picks> {
  const sorted = [...units].sort((a, b) => a - b);
  return pattern.scope.unitRanges.length
    ? { coverBy: 'pages', chapters: sorted, ranges: fdeUnitRanges(pattern.scope.unitRanges, sorted) }
    : { coverBy: 'chapters', chapters: sorted, ranges: [] };
}

export function FdeCheck() {
  const C = useCopy(ASSESSMENT);
  const lang = useLang();
  const [p, set] = usePicks();
  const navigate = useNavigate();
  const { jobs, start } = useJobs();
  const needsClass = p.grade === null || !p.subject;
  // A failed read is a load failure with Try again (LoadState), never "the pattern is off" (that is `gone`, below).
  const [pat, retryPat] = useLoad(needsClass ? null : () => patternOffer(p.grade, p.subject), `pattern:${p.grade}:${p.subject}`);
  const [chapters] = useLoad(needsClass ? null : () => loadChapters(p.grade as number, p.subject as string), `chapters:${p.grade}:${p.subject}`);
  const [tray, setTray] = useState<null | 'style' | 'syllabus' | 'inside'>(null);
  const [styleChoice, setStyleChoice] = useState<'fde' | 'own'>('fde');
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  if (needsClass) return <Navigate to={newPaperPath('class')} replace />;

  const pattern = dataOf(pat);
  const custom = p.coverBy !== 'fde';
  // A paper for this class already being made: Make waits (the server answers 409 to a stale tap anyway).
  const busy = jobs.some((j) => {
    const s = j.spec as unknown as { grade?: number; subject?: string; pattern?: string };
    return j.status === 'writing' && s.pattern === p.pattern && s.grade === p.grade && s.subject === p.subject;
  });
  const why = stepReason('check', p, 50, C, { busy });
  const subject = p.subjectName ?? p.subject ?? '';
  const titles = new Map((dataOf(chapters) ?? []).map((c) => [c.chapter_number, c.chapter_title]));
  const unitsLine = [...p.chapters].sort((a, b) => a - b).join(', ');

  const make = async () => {
    setMaking(true);
    setError(null);
    setRunning(null);
    const res = await start(toSpec(p), C.join(subject, C.fdeChip), subject);
    setMaking(false);
    if ('job' in res) { navigate(requestPath(res.job.requestId), { replace: true }); return; }
    const f = portal.takeGenerateFailure?.() ?? null;
    setError(makeErrorText(res.error, f, C));
    // A paper for this class is already being made: no dead end, its page is one tap away.
    if (f?.errorCode === 'ALREADY_GENERATING' && f.requestId) setRunning(f.requestId);
  };

  const useFdeSyllabus = () => set({ coverBy: 'fde', chapters: [], ranges: [] });
  const toggleUnit = (n: number) => {
    if (!pattern) return;
    const now = custom ? p.chapters : pattern.scope.chapters;
    set(customised(pattern, now.includes(n) ? now.filter((x) => x !== n) : [...now, n]));
  };
  const ownPaper = () => {
    set({ style: 'own', pattern: null, patternIntent: null, coverBy: 'chapters', ranges: [], chapters: pattern ? [...pattern.scope.chapters] : [] });
    setTray(null);
    navigate(newPaperPath('questions'));
  };

  // The pattern is no longer offered (its flag went off mid-journey): say so, and keep the teacher's own paper one tap away.
  const gone = pat.status === 'ok' && !pattern && (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">
      <p>{C.fdeFailures.PATTERN_OFF}</p>
      <button type="button" onClick={() => { set({ style: null, pattern: null, patternIntent: null, coverBy: 'chapters', chapters: [], ranges: [] }); navigate(newPaperPath('cover')); }}
        className={cn(PRIMARY, 'flex-none', FOCUS)}>{C.styleOwn}</button>
    </div>
  );
  const body = gone || (pat.status !== 'ok' || !pattern
    ? <LoadState status={pat.status} onRetry={retryPat} />
    : (
      <>
        {/* Above the rows: on a 360×740 phone in Urdu a row under them would sit behind the dock. */}
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-[#fee4e2] p-3.5 text-[15px] text-[#c8331f]">
            <p>{error}</p>
            {running && (
              <Link to={requestPath(running)} className={cn('flex min-h-[48px] items-center gap-1 font-semibold text-[#33374a] underline', FOCUS)}>
                {C.seePaperBeingMade}
                <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
        <ListCard label={C.steps.check}>
          <Row first testId="fde-row-style" label={C.paperStyle} onPress={() => { setStyleChoice('fde'); setTray('style'); }}
            value={<span className="inline-flex items-center gap-1.5"><LayoutList className="h-4 w-4" aria-hidden="true" />{pick(pattern.name, lang)}</span>}
            action={<EditWord C={C} />} />
          <Row testId="fde-row-class" label={C.steps.class} to={newPaperPath('class')}
            value={C.gradeSubject(p.grade as number, subject)} action={<EditWord C={C} />} />
          <Row testId="fde-row-syllabus" label={C.syllabus} onPress={() => setTray('syllabus')}
            value={custom ? C.join(C.unitsRange(p.chapters) || C.picked(0), C.customised) : pick(pattern.scope.label, lang)}
            sub={custom ? undefined : pick(pattern.scope, lang)} action={<EditWord C={C} />} />
          <Row testId="fde-row-inside" label={C.inside} onPress={() => setTray('inside')} value={pick(pattern.holds, lang)}
            action={<ChevronRight className="me-3 h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />} />
          {pattern.youAdd && (
            // One amber line, so the Check screen fits above the dock on a 360×740 phone in Urdu too.
            <div data-testid="fde-row-youadd" className="flex min-h-[52px] items-center gap-2 border-t border-[#f0f1f3] bg-[#fffbeb] px-3.5 py-2 text-[15px] font-semibold leading-snug text-[#b45309]">
              {`${C.youAdd}: ${C.join(pick(pattern.youAdd, lang), C.beforeCopying)}`}
            </div>
          )}
        </ListCard>

        <Tray open={tray === 'style'} title={C.paperStyle} onClose={() => setTray(null)} closeLabel={C.close} testId="fde-style-tray">
          <div role="radiogroup" aria-label={C.paperStyle} className="flex flex-col gap-2.5">
            <Choice picked={styleChoice === 'fde'} onPick={() => { setStyleChoice('fde'); setTray(null); }}
              icon={<LayoutList className="h-6 w-6" aria-hidden="true" />} name={C.styleFde} sub={C.styleFdeSub} />
            <Choice picked={styleChoice === 'own'} onPick={() => setStyleChoice('own')}
              icon={<FilePen className="h-6 w-6" aria-hidden="true" />} name={C.styleOwn} sub={C.styleOwnSub} />
          </div>
          {styleChoice === 'own' && (
            <div className="flex flex-col gap-1.5">
              <p className="px-1 text-center text-[14px] font-semibold text-[#4b5563]">{C.ownNext}</p>
              <button type="button" data-testid="fde-style-next" onClick={ownPaper} className={cn(PRIMARY, FOCUS)}>
                {C.next}
                <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
          )}
        </Tray>

        <Tray open={tray === 'syllabus'} title={C.syllabus} onClose={() => setTray(null)} closeLabel={C.close} testId="fde-syllabus-tray">
          <div role="radiogroup" aria-label={C.syllabus} className="flex flex-col gap-2.5">
            <Choice picked={!custom} onPick={useFdeSyllabus} icon={<LayoutList className="h-6 w-6" aria-hidden="true" />}
              name={pick(pattern.scope.label, lang)} sub={pick(pattern.scope, lang)} />
          </div>
          <ListCard label={C.chapters}>
            {(pattern.scope.displayChapters ?? pattern.scope.chapters).map((n, i) => {
              const inFde = pattern.scope.chapters.includes(n);
              const held = pattern.scope.held.includes(n);
              const chip = held ? C.practiseFromBook : !inFde ? C.notInFde : pattern.scope.topicsOnly.includes(n) ? C.fdeTopicsOnly : null;
              const checked = inFde && (custom ? p.chapters.includes(n) : true);
              const label = (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[16px] font-semibold leading-snug">{titles.get(n) ?? C.chapterShort(n)}</span>
                  {chip && <span className="text-[13px] text-[#6b7280]">{chip}</span>}
                </span>
              );
              return inFde
                ? <CheckRow key={n} first={i === 0} checked={checked} onToggle={() => toggleUnit(n)} label={label} />
                : (
                  <div key={n} aria-disabled="true" className={cn('flex min-h-[64px] items-center gap-3 px-3 py-2 opacity-60', i > 0 && 'border-t border-[#f0f1f3]')}>
                    <span className="h-7 w-7 shrink-0 rounded-[8px] border-2 border-[#e5e7eb] bg-[#f3f4f6]" aria-hidden="true" />
                    {label}
                  </div>
                );
            })}
          </ListCard>
          <div role="radiogroup" aria-label={C.steps.cover}>
            <Choice picked={custom} onPick={() => pattern && set(customised(pattern, custom ? p.chapters : pattern.scope.chapters))}
              icon={<FilePen className="h-6 w-6" aria-hidden="true" />} name={C.steps.cover} sub={C.ownScopeSub} />
          </div>
          <button type="button" onClick={() => setTray(null)} className={cn(PRIMARY, FOCUS)}>{C.done}</button>
        </Tray>

        <Tray open={tray === 'inside'} title={C.inside} onClose={() => setTray(null)} closeLabel={C.close} testId="fde-inside-tray">
          <ListCard label={C.inside}>
            {pattern.sections.map((sec, i) => (
              <div key={sec.id} className={cn('flex min-h-[56px] items-center gap-3 px-3.5 py-2', i > 0 && 'border-t border-[#f0f1f3]')}>
                <Chip tone="indigo">{sec.id}</Chip>
                <span className="text-[15px] font-semibold leading-snug">{pick(sec, lang)}</span>
              </div>
            ))}
            <div className="flex min-h-[56px] items-center border-t border-[#f0f1f3] px-3.5 py-2 text-[15px] font-semibold">{pick(pattern.files, lang)}</div>
            {pattern.youAdd && (
              <div className="flex min-h-[56px] items-center border-t border-[#f0f1f3] bg-[#fffbeb] px-3.5 py-2 text-[15px] font-semibold text-[#b45309]">
                {C.join(C.youAdd, pick(pattern.youAdd, lang))}
              </div>
            )}
          </ListCard>
          {custom && (
            <div className="flex flex-col gap-2 rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-3.5">
              <p className="text-[15px] font-semibold">{C.insideCustom(unitsLine)}</p>
              <p className="text-[14px] text-[#4b5563]">{C.fullRehearsal}</p>
              <button type="button" onClick={useFdeSyllabus} className={cn(PRIMARY, 'flex-none', FOCUS)}>{C.useFdeSyllabus}</button>
            </div>
          )}
          <p className="flex items-center gap-2 px-1 text-[14px] text-[#4b5563]">
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            {C.notOfficial}
          </p>
        </Tray>
      </>
    ));

  return (
    <StepFrame
      step="check"
      steps={FDE_STEPS}
      crumb={C.fdeDoor}
      backTo={newPaperPath(p.patternIntent ? 'class' : 'cover')}
      hint={pattern ? C.readyHint : undefined}
      next={{ label: making ? C.making : C.makePaper, why: pattern ? why : pat.status === 'error' ? C.loadFailed : C.why.wait, onPress: make, busy: making }}
    >
      {body}
    </StepFrame>
  );
}
