import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { teacherPath } from '../../routes';
import { DockButton, StepBar } from '../../ui';
import { useCopy } from '../../i18n';
import TeacherPage from '../../TeacherPage';
import { LoadState } from '../LoadState';
import { LESSONS } from '../copy';
import { lessonsUrl } from '../paths';
import { OWN } from './copy';
import {
  FOCI, LEVELS, RESOURCES, SIZES, isComplete, purposesFor, suggestWay, waysFor, type Resource,
} from './rules';
import { nextStep, ownUrl, prevStep, readOwn, stepsFor, toAnswers, type OwnAt } from './state';
import { fetchSloMix, makeOwnPlan, ownable, useLpMakeOwn } from './api';
import { nextLesson } from './extend';
import type { Refusal } from './change';
import { checkBand, fmtPg, parseLabel, pgToSend, type PageRange, type PagesPick } from './pages';
import { PagesStep, type PlanRow } from './PagesStep';
import { MyOwnPlans } from './MyOwnPlans';
import { RadioList, TickList } from './Options';
import { bandWords } from './bandCopy';
import { Check } from './Check';

/**
 * "Make my own" lesson plan: one question per screen, one sticky OK (the WhatsApp-flow form pattern), every
 * answer in the address. Make my plan hands over to the 6-12 Preparing page, whose poll, ready banner and viewer already
 * answer her fork's id. Children in class is remembered on this phone. Dark unless lpMakeOwn: off, this page sends her
 * back to Lesson Plans.
 *
 * one flow for grades 1–12 (the unified spec); only the option lists differ. Step 1 is the same picker
 * for every band (PagesStep: the lesson, her pages, the book's text, and through-the-next-lesson at 6–12); what the
 * lesson is for comes second, pre-picked "Teach new"; single answers are radio lists, resources a tick list; the way
 * screen says I do → We do → You do stays. Grade 8's exam practice is named for the FDE annual exam (bandWords).
 */

const SIZE_KEY = 'lp-own-size';
const remembered = (): string | null => { try { return localStorage.getItem(SIZE_KEY); } catch { return null; } };
const remember = (v: string) => { try { localStorage.setItem(SIZE_KEY, v); } catch { /* private window */ } };

export function OwnPage() {
  const s = readOwn(useLocation().search);
  const on = useLpMakeOwn();
  if (!s) return <Navigate to={teacherPath('lessons')} replace />;
  return <Own s={s} on={on} />;
}

function Own({ s, on }: { s: OwnAt; on: boolean | null }) {
  const C = useCopy(OWN);
  const L = useCopy(LESSONS);
  const w = bandWords(C, s.grade);
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Refusal | 'error' | null>(null);
  const [lessons, retry] = useLoad(() => lessonPlans.lessons(s.grade, s.subject, s.chapter), `l:${s.grade}:${s.subject}:${s.chapter}`);
  const all = dataOf(lessons) ?? [];
  const plans: PlanRow[] = all.filter(ownable).map((l) => ({ id: l.id, number: l.number, title: l.title, pages: l.pages ?? null, lane: l.lane === 'k5' ? 'k5' : 'g612' }));
  const k5 = plans.some((l) => l.lane === 'k5');
  const seg = plans.find((l) => l.id === s.seg) ?? null;
  const next612 = nextLesson(all, s.seg); // none on the chapter's last lesson
  const nextRow = seg?.lane === 'k5' ? plans[plans.indexOf(seg) + 1] ?? null : next612 ? plans.find((l) => l.id === next612.id) ?? null : null;
  const lesson = seg ? parseLabel(seg.pages) : null;
  const nextPages = nextRow ? parseLabel(nextRow.pages) : null;
  // Her pages from the address; a 6–12 "both lessons" with no pg is the natural run to the next lesson's end.
  const start: PageRange | null = s.pg ?? (s.ext && lesson && nextPages && seg?.lane === 'g612' ? { start: lesson.start, end: nextPages.end } : null);
  const atStart = (): PagesPick | null => (lesson ? checkBand(seg?.lane === 'k5', String((start ?? lesson).start), String((start ?? lesson).end), lesson, nextPages) : null);
  const [pickEdit, setPick] = useState<{ seg: string | null; pick: PagesPick | null } | null>(null);
  const pick = pickEdit && pickEdit.seg === s.seg ? pickEdit.pick : atStart();
  const chapterUrl = lessonsUrl('lessons', { grade: s.grade, subject: s.subject, chapter: s.chapter });
  const go = (over: Partial<OwnAt>) => navigate(ownUrl({ ...s, ...over }), { replace: true });
  const askMix = s.grade >= 9 && !!s.seg;
  const [slo] = useLoad(askMix ? () => fetchSloMix(s.seg as string) : null, `slo:${askMix ? s.seg : ''}`);
  const mix = dataOf(slo);
  const purposeNow = s.purpose ?? 'new';
  const steps = stepsFor({ grade: s.grade, mixed: !!mix?.mixed, purpose: purposeNow });
  const back = prevStep(s.step, steps);
  const n = steps.indexOf(s.step) + 1;
  const sizeNow = s.size ?? SIZES.find((x) => x === remembered()) ?? null;
  const suggestion = suggestWay({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: ['textbook', ...s.res], level: s.level, way: null, purpose: s.purpose });
  const wayNow = s.way ?? suggestion.way;

  // Off is a real answer (back to the chapter); unknown is not, so the frame waits for /config.
  if (on === false) return <Navigate to={chapterUrl} replace />;

  const ok = (over: Partial<OwnAt>, enabled: boolean) => (
    <DockButton disabled={!enabled} testId="own-ok" onClick={() => go({ ...over, step: nextStep(s.step, steps) ?? s.step })}>{C.ok}</DockButton>
  );

  async function make() {
    if (!seg || busy) return; // her plan's own lane (6–12 or 1–5) decides what is sent: wait for the list
    setBusy(true);
    setFailed(null);
    const r = await makeOwnPlan(seg, toAnswers(s, note, next612?.id ?? null));
    setBusy(false);
    if (!r || !('renderId' in r)) { setFailed(r && 'outcome' in r ? r.outcome : 'error'); return; }
    navigate(lessonsUrl('preparing', {
      grade: s.grade, subject: s.subject, chapter: s.chapter, lesson: s.seg, render: r.renderId, title: seg?.title ?? C.makeMyOwn,
    }), { replace: true });
  }

  const pagesOk = !!seg && (!lesson || !!pick) && (!pick?.both || !!s.ext);
  const dock = s.step === 'pages' ? ok({ pg: pgToSend(pick, lesson, nextPages), ext: pick?.both ? s.ext : null }, pagesOk)
    : s.step === 'purpose' ? ok({ purpose: purposeNow }, slo.status !== 'loading') // which step is next waits for the SLO mix
      : s.step === 'focus' ? ok({}, !!s.focus)
        : s.step === 'size' ? ok({ size: sizeNow }, !!sizeNow)
          : s.step === 'level' ? ok({}, !!s.level)
            : s.step === 'resources' ? ok({}, true)
              : s.step === 'way' ? ok({ way: wayNow }, true)
                : <DockButton disabled={busy || !seg || !isComplete({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: s.res, level: s.level, way: s.way, purpose: s.purpose })} testId="own-make" onClick={() => { void make(); }}>{failed === 'error' ? C.tryAgain : C.makeMyPlan}</DockButton>;

  const title = s.step === 'check' ? C.yourPlan : s.step === 'pages' ? (k5 ? C.day : C.whichLesson) : s.step === 'size' ? w.size : C[s.step];
  const hints = C.purposeHints as Partial<Record<string, string>>;
  const segName = seg ? (seg.number != null ? `${seg.lane === 'k5' ? C.dayN(seg.number) : C.lessonN(seg.number)} · ${seg.title}` : seg.title) : '—';
  const segPages = s.pg ? C.pagesShort(fmtPg(s.pg)) : seg?.lane === 'g612' ? seg.pages : null;

  return (
    <TeacherPage feature="lessons" crumb={C.title} title={title} backTo={back ? ownUrl({ ...s, step: back }) : chapterUrl} dock={dock} testId={`own-${s.step}`}>
      {s.step !== 'check' ? <StepBar total={steps.length - 1} current={n} /> : null}
      {s.step === 'pages' ? (
        <>
          <LoadState status={lessons.status} empty={!plans.length} onRetry={retry} />
          {plans.length ? (
            <PagesStep
              key={s.seg ?? ''}
              C={C} plans={plans} seg={seg} next={nextRow} start={start} ext={s.ext ?? null}
              onPick={(k) => { setPick(null); go({ seg: k, pg: undefined, ext: null }); }}
              onClear={() => { setPick(null); go({ seg: null, pg: undefined, ext: null }); }}
              onPages={(p) => setPick({ seg: s.seg, pick: p })}
              onExt={(ext) => go({ ext })}
            />
          ) : null}
          {plans.length && !s.seg ? <MyOwnPlans at={{ grade: s.grade, subject: s.subject, chapter: s.chapter }} plans={plans} /> : null}
        </>
      ) : null}
      {s.step === 'purpose' ? (
        <RadioList label={C.purpose} items={purposesFor(s.grade).map((k) => ({ key: k, label: w.purpose(k), subtitle: hints[k] }))} value={purposeNow} onPick={(k) => go({ purpose: k as OwnAt['purpose'] })} />
      ) : null}
      {s.step === 'focus' ? (
        <RadioList label={C.focus} items={FOCI.map((k) => ({ key: k, label: C.foci[k], subtitle: C.focusCount((mix?.[k] ?? []).length) }))} value={s.focus} onPick={(k) => go({ focus: k as OwnAt['focus'] })} />
      ) : null}
      {s.step === 'size' ? (
        <RadioList label={w.size} items={SIZES.map((k) => ({ key: k, label: C.sizes[k] }))} value={sizeNow} onPick={(k) => { remember(k); go({ size: k as OwnAt['size'] }); }} />
      ) : null}
      {s.step === 'level' ? (
        <RadioList label={C.level} items={LEVELS.map((k) => ({ key: k, label: C.levels[k] }))} value={s.level} onPick={(k) => go({ level: k as OwnAt['level'] })} />
      ) : null}
      {s.step === 'resources' ? (
        <TickList
          label={C.resources} allLabel={C.tickAll} locked={['textbook']} chosen={['textbook', ...s.res]}
          items={RESOURCES.map((k) => ({ key: k, label: w.resource(k), subtitle: k === 'objects' ? w.objectsHint : undefined }))}
          onChange={(keys) => go({ res: keys.filter((k) => k !== 'textbook') as Resource[] })}
        />
      ) : null}
      {s.step === 'way' ? (
        <>
          {/* The guardrail sits above the options, never under the fold (the unified spec's layout rule 5). */}
          <p className="text-[14px] font-semibold text-[#33374a]" data-testid="own-grr">{C.grrLine}</p>
          <RadioList
            label={C.way}
            items={[suggestion.way, ...waysFor(s).filter((x) => x !== suggestion.way)].map((k) => ({ key: k, label: w.way(k), subtitle: k === suggestion.way ? C.suggested : undefined }))}
            value={wayNow}
            onPick={(k) => go({ way: k as OwnAt['way'] })}
          />
        </>
      ) : null}
      {s.step === 'check' ? (
        <Check s={s} C={C} k5={k5} nextLabel={next612 && s.ext ? next612.pages ?? next612.title : null} pagesLabel={[segName, segPages].filter(Boolean).join(' · ')} gradeLabel={L.grade(s.grade)} note={note} setNote={setNote} failed={failed} />
      ) : null}
    </TeacherPage>
  );
}
