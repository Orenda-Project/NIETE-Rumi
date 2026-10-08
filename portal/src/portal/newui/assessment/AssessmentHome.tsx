import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CircleAlert, ClipboardList, Clock, FolderOpen, Hash, Hourglass, Layers, ListChecks, Loader2 } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { useAuth } from '../../hooks/useAuth';
import { portal, type AssessmentChapter, type AssessmentQuestionType, type AssessmentSubject } from '../../services/api';
import { ASSESSMENT_COPY } from '../copy';
import { MainHeading } from '../MainHeading';
import { List, Row, SectionLabel } from '../List';
import { Chip, FilterChips, ToggleChips } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { Sheet } from '../Sheet';
import { NumberGrid } from '../NumberGrid';
import { ToggleList } from '../ToggleList';
import { Stepper } from '../Stepper';
import { Hero } from '../Hero';
import { AccountAvatar } from '../NewUiNavigation';
import { pkDayMonth } from '../range';
import {
  recallAssessmentPicks, rememberAssessmentPicks, subjectIcon, typeLabel, useAssessmentGate,
  type ContentSource, type Picks, type RequestState,
} from './assessmentApi';

/**
 * bd-5rz1v.13 — Assessment, its own page (deep-screens.html, Assessment 1), behind
 * `portal_new_ui` (pages/PortalAssessment.tsx picks it). It replaces the Curriculum page's
 * Assessment Generator tab for a teacher on the new UI; the tab is untouched for everyone else.
 *
 *   band     "Assessment", with "12 made" and "Last: 3 Oct" (GET /assessment/papers)
 *   rows     Class · Subject · Chapter, each opening a sheet; Subject waits for a class and
 *            Chapter for a subject. A new class clears what was under it. Chapter takes any
 *            number of chapters (bd-ix9uhr): one paper from several, as on WhatsApp.
 *   stepper  Questions − 15 +: the server's default, never past its maximum or under 1
 *   More     question types (toggle chips), where questions come from, answer lines
 *   button   Make assessment → POST /assessment/generate → the writing page
 *
 * Same behaviour as AssessmentGeneratorPanel, rebuilt from the kit: every option and the
 * question cap come from /assessment/options and /assessment/chapters. With
 * features.assessmentGenerator off the page says Coming soon, calmly, and asks nothing else.
 */

type Sheets = 'class' | 'subject' | 'chapter' | 'more' | null;
type Load = 'loading' | 'error' | 'ok';

export default function AssessmentHome() {
  const { user } = useAuth();
  const gate = useAssessmentGate();
  const made = useMade(gate === true);
  return (
    <PortalLayout ownHeading>
      <MainHeading
        feature="assessment"
        title={ASSESSMENT_COPY.title}
        right={<div className="md:hidden"><AccountAvatar name={user?.firstName} testId="newui-assessment-avatar" /></div>}
        context={gate && made && made.total > 0 ? <MadeChips made={made} /> : null}
      />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10 md:pt-[10px]">
        {gate === null ? <Hero title={ASSESSMENT_COPY.loading} icon={Loader2} spinning live /> : null}
        {gate === false ? <Hero title={ASSESSMENT_COPY.comingSoon} icon={Hourglass} /> : null}
        {gate ? <Form made={made} /> : null}
      </div>
    </PortalLayout>
  );
}

type Made = { total: number; last: string | null };

/** How many she has made, and the last one's day (GET /assessment/papers, newest first). */
function useMade(ask: boolean): Made | null {
  const [made, setMade] = useState<Made | null>(null);
  useEffect(() => {
    if (!ask) return undefined;
    let live = true;
    portal.getAssessmentPapers({ page: 1, page_size: 1 })
      .then((res) => {
        if (!live) return;
        const total = Number(res?.total);
        const at = res?.papers?.[0]?.ready_at;
        const day = at ? pkDayMonth(at) : null;
        setMade(Number.isFinite(total) ? { total, last: day ? `${day.day} ${day.month}` : null } : null);
      })
      .catch(() => { if (live) setMade(null); });
    return () => { live = false; };
  }, [ask]);
  return made;
}

/** "12 made", "Last: 3 Oct" — nothing before her first. */
function MadeChips({ made }: { made: Made }) {
  return (
    <>
      <Chip surface="band">{ASSESSMENT_COPY.made(made.total)}</Chip>
      {made.last ? <Chip surface="band" icon={Clock}>{ASSESSMENT_COPY.last(made.last)}</Chip> : null}
    </>
  );
}

function Form({ made }: { made: Made | null }) {
  const navigate = useNavigate();
  const [picks, setPicksState] = useState<Picks>(recallAssessmentPicks);
  const setPicks = useCallback((update: (p: Picks) => Picks) => {
    setPicksState((cur) => {
      const next = update(cur);
      rememberAssessmentPicks(next);
      return next;
    });
  }, []);

  // ── everything the form offers, from the server ─────────────────────────
  const [load, setLoad] = useState<Load>('loading');
  const [attempt, setAttempt] = useState(0);
  const [grades, setGrades] = useState<number[]>([]);
  const [bounds, setBounds] = useState<{ max: number; initial: number }>({ max: 1, initial: 1 });
  const [subjects, setSubjects] = useState<AssessmentSubject[]>([]);
  const [chapters, setChapters] = useState<AssessmentChapter[]>([]);
  const [types, setTypes] = useState<AssessmentQuestionType[]>([]);

  const [sheet, setSheet] = useState<Sheets>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refused, setRefused] = useState(false);

  // The grade list and the question cap, once (and again on Try again).
  useEffect(() => {
    let live = true;
    setLoad('loading');
    portal.getAssessmentOptions()
      .then((opts) => {
        if (!live) return;
        setGrades(opts.grades || []);
        setBounds({ max: opts.maxQuestions, initial: opts.defaultQuestions });
        setLoad('ok');
      })
      .catch(() => { if (live) setLoad('error'); });
    return () => { live = false; };
  }, [attempt]);

  // Subjects follow the grade.
  useEffect(() => {
    if (picks.grade == null) { setSubjects([]); return undefined; }
    let live = true;
    portal.getAssessmentOptions(picks.grade)
      .then((opts) => { if (live) setSubjects(opts.subjects || []); })
      .catch(() => { if (live) setSubjects([]); });
    return () => { live = false; };
  }, [picks.grade]);

  // Chapters, question types and the subject's own cap follow the subject.
  useEffect(() => {
    const { grade, subject } = picks;
    if (grade == null || !subject) { setChapters([]); setTypes([]); return undefined; }
    let live = true;
    Promise.all([portal.getAssessmentChapters(grade, subject), portal.getAssessmentOptions(grade, subject)])
      .then(([ch, opts]) => {
        if (!live) return;
        const list = ch.chapters || [];
        const offered = opts.types || [];
        setChapters(list);
        setTypes(offered);
        setBounds({ max: opts.maxQuestions, initial: opts.defaultQuestions });
        // What she had picked stays only if this subject still offers it.
        setPicks((p) => ({
          ...p,
          chapters: p.chapters.filter((n) => list.some((c) => c.chapter_number === n)),
          types: p.types.filter((t) => offered.some((o) => o.id === t)),
        }));
      })
      .catch(() => { if (live) { setChapters([]); setTypes([]); } });
    return () => { live = false; };
    // The subject's loads are keyed on the grade and subject alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks.grade, picks.subject]);

  const count = Math.max(1, Math.min(bounds.max, picks.count ?? bounds.initial));
  const canMake = picks.grade != null && !!picks.subject && picks.chapters.length > 0 && load === 'ok' && !submitting;
  // One chapter shows its title; several, how many.
  const chapterLabel = picks.chapters.length > 1
    ? ASSESSMENT_COPY.chapters(picks.chapters.length)
    : chapters.find((c) => c.chapter_number === picks.chapters[0])?.chapter_title ?? null;

  const close = () => setSheet(null);
  const pickGrade = (grade: number) => {
    setPicks((p) => (p.grade === grade ? p : { ...p, grade, subject: null, subjectName: null, chapters: [], types: [] }));
    setRefused(false);
    close();
  };
  const pickSubject = (key: string) => {
    const name = subjects.find((s) => s.subject_key === key)?.subject ?? key;
    setPicks((p) => (p.subject === key ? p : { ...p, subject: key, subjectName: name, chapters: [], types: [] }));
    setRefused(false);
    close();
  };
  // The sheet stays open while she ticks; Done closes it.
  const pickChapters = (keys: string[]) => {
    setPicks((p) => ({ ...p, chapters: keys.map(Number).sort((a, b) => a - b) }));
    setRefused(false);
  };

  const make = async () => {
    if (!canMake || picks.grade == null || !picks.subject || !picks.chapters.length) return;
    const spec = {
      grade: picks.grade,
      subject: picks.subject,
      // A lone chapter also goes by itself, so a bot that predates chapterNumbers still reads it.
      chapterNumber: picks.chapters.length === 1 ? picks.chapters[0] : null,
      chapterNumbers: picks.chapters,
      contentSource: picks.source,
      questionCount: count,
      questionTypes: picks.types,
      answerLines: picks.answerLines,
      outputFormat: 'pdf' as const,
    };
    setSubmitting(true);
    setRefused(false);
    try {
      const res = await portal.generateAssessment(spec);
      if (!res?.success || !res.requestId) { setRefused(true); return; }
      const state: RequestState = { spec, subjectName: picks.subjectName, chapterTitle: chapterLabel, startedAt: Date.now() };
      navigate(`/portal/assessment/request/${encodeURIComponent(res.requestId)}`, { state });
    } catch {
      setRefused(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (load === 'loading') return <Hero title={ASSESSMENT_COPY.loading} icon={Loader2} spinning live />;
  if (load === 'error') {
    return (
      <>
        <Hero title={ASSESSMENT_COPY.notLoaded} icon={CircleAlert} tone="error" live />
        <BottomButton tone="outline" onClick={() => setAttempt((n) => n + 1)}>{ASSESSMENT_COPY.retry}</BottomButton>
      </>
    );
  }

  const pickedTypes = picks.types.filter((t) => types.some((o) => o.id === t));
  const pickValue = (value: string | number | null) => (value == null || value === '' ? ASSESSMENT_COPY.pick : value);

  return (
    // Desktop: the three picks on the left, the rest on the right (deep-screens.html's desktop
    // Lesson Plans layout). A phone keeps one column in this order.
    <div className="flex flex-col gap-3 md:[display:grid] md:grid-cols-2 md:items-start md:gap-x-6">
      <List label={ASSESSMENT_COPY.title}>
        <Row
          title={ASSESSMENT_COPY.rows.class}
          icon={Hash}
          value={pickValue(picks.grade)}
          valueMuted={picks.grade == null}
          onClick={() => setSheet('class')}
          testId="assessment-class"
        />
        <Row
          title={ASSESSMENT_COPY.rows.subject}
          icon={picks.subject ? subjectIcon(picks.subject) : BookOpen}
          value={pickValue(picks.subjectName)}
          valueMuted={!picks.subjectName}
          onClick={() => setSheet('subject')}
          state={picks.grade == null ? 'off' : undefined}
          testId="assessment-subject"
        />
        <Row
          title={ASSESSMENT_COPY.rows.chapter}
          icon={Layers}
          value={chapterLabel
            // A chapter's title can be long: it gives way to the row's name and the arrow.
            ? <span className="block max-w-[46vw] truncate md:max-w-[360px]">{chapterLabel}</span>
            : ASSESSMENT_COPY.pick}
          valueMuted={!chapterLabel}
          onClick={() => setSheet('chapter')}
          state={!picks.subject ? 'off' : undefined}
          testId="assessment-chapter"
        />
      </List>

      <div className="flex flex-col gap-3">
        <SectionLabel>{ASSESSMENT_COPY.questions}</SectionLabel>
        <Stepper
          label={ASSESSMENT_COPY.questions}
          value={count}
          min={1}
          max={bounds.max}
          onChange={(n) => setPicks((p) => ({ ...p, count: n }))}
          decreaseLabel={ASSESSMENT_COPY.fewer}
          increaseLabel={ASSESSMENT_COPY.moreQuestions}
        />

        <List>
          <Row
            title={ASSESSMENT_COPY.rows.more}
            icon={ListChecks}
            onClick={() => setSheet('more')}
            testId="assessment-more"
            chips={pickedTypes.length
              ? pickedTypes.map((t) => <Chip key={t}>{typeLabel(t)}</Chip>)
              : <Chip>{ASSESSMENT_COPY.mixed}</Chip>}
          />
        </List>

        <List>
          <Row
            title={ASSESSMENT_COPY.rows.mine}
            icon={FolderOpen}
            to="/portal/assessment/mine"
            value={made && made.total > 0 ? made.total : undefined}
            testId="assessment-mine"
          />
        </List>

        {refused ? (
          <div className="flex justify-center">
            <Chip tone="error" icon={CircleAlert}>{ASSESSMENT_COPY.notStarted}</Chip>
          </div>
        ) : null}

        <BottomActions>
          <BottomButton icon={ClipboardList} disabled={!canMake} onClick={make} testId="assessment-make">
            {ASSESSMENT_COPY.make}
          </BottomButton>
        </BottomActions>
      </div>

      {/* ── the pickers ───────────────────────────────────────────────── */}
      <Sheet open={sheet === 'class'} title={ASSESSMENT_COPY.rows.class} onClose={close}>
        <NumberGrid label={ASSESSMENT_COPY.rows.class} numbers={grades} value={picks.grade} onChange={pickGrade} />
      </Sheet>

      <Sheet open={sheet === 'subject'} title={ASSESSMENT_COPY.rows.subject} onClose={close}>
        <ToggleList
          label={ASSESSMENT_COPY.rows.subject}
          options={subjects.map((s) => ({ key: s.subject_key, label: s.subject }))}
          value={picks.subject}
          onChange={pickSubject}
        />
      </Sheet>

      <Sheet open={sheet === 'chapter'} title={ASSESSMENT_COPY.rows.chapter} onClose={close}>
        <ToggleList
          mode="multi"
          label={ASSESSMENT_COPY.rows.chapter}
          options={chapters.map((c) => {
            const pages = ASSESSMENT_COPY.pages(c.page_start, c.page_end);
            return {
              key: String(c.chapter_number),
              label: `${c.chapter_number} · ${c.chapter_title}`,
              aside: pages ? <Chip>{pages}</Chip> : undefined,
            };
          })}
          value={picks.chapters.map(String)}
          onChange={pickChapters}
        />
        <BottomButton onClick={close}>{ASSESSMENT_COPY.done}</BottomButton>
      </Sheet>

      <Sheet open={sheet === 'more'} title={ASSESSMENT_COPY.rows.more} onClose={close}>
        {types.length ? (
          <>
            <SectionLabel>{ASSESSMENT_COPY.types}</SectionLabel>
            <ToggleChips
              label={ASSESSMENT_COPY.types}
              options={types.map((t) => ({ key: t.id, label: typeLabel(t.id) }))}
              value={pickedTypes}
              onChange={(next) => setPicks((p) => ({ ...p, types: next }))}
            />
          </>
        ) : null}
        <SectionLabel>{ASSESSMENT_COPY.source}</SectionLabel>
        <FilterChips<ContentSource>
          label={ASSESSMENT_COPY.source}
          value={picks.source}
          onChange={(source) => setPicks((p) => ({ ...p, source }))}
          options={[
            { key: 'unseen', label: ASSESSMENT_COPY.sources.unseen },
            { key: 'seen', label: ASSESSMENT_COPY.sources.seen },
            { key: 'both', label: ASSESSMENT_COPY.sources.both },
          ]}
        />
        <ToggleList
          mode="multi"
          compact
          label={ASSESSMENT_COPY.answerLines}
          options={[{ key: 'lines', label: ASSESSMENT_COPY.answerLines }]}
          value={picks.answerLines ? ['lines'] : []}
          onChange={(keys) => setPicks((p) => ({ ...p, answerLines: keys.includes('lines') }))}
        />
        <BottomButton onClick={close}>{ASSESSMENT_COPY.done}</BottomButton>
      </Sheet>
    </div>
  );
}
