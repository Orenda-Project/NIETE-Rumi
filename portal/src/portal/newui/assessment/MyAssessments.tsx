import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, CircleAlert, Download, Inbox, KeyRound, Loader2 } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { portal, type AssessmentPaper, type AssessmentSubject } from '../../services/api';
import { ASSESSMENT_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row } from '../List';
import { Chip, FilterChips } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Sheet } from '../Sheet';
import { Hero } from '../Hero';
import { pkDayMonth } from '../range';
import { downloadArtifact, subjectIcon, useAssessmentGate } from './assessmentApi';

/**
 * bd-5rz1v.13 — My assessments, /portal/assessment/mine (deep-screens.html, Assessment 4).
 * Everything she has made, newest first, ONE entry per paper (its latest version, "· v2"),
 * from GET /assessment/papers — the same list AssessmentPapersPanel browses.
 *
 *   filters  FilterChips: All and her classes; a class then offers its subjects (subjects
 *            follow the class, as in the old panel). The picked chip is indigo.
 *   rows     the subject's icon (neutral grey — DESIGN.md's colour rule), "Science · Ch 2",
 *            chips "15 Q" and "3 Oct", and a download icon. A tap offers Download and, when the
 *            paper has one, its Answer key, in a sheet.
 *   paging   a More row under the list, while there are more.
 *
 * Failed papers are not here (the API lists only ready ones). A list that does not load says
 * "Not loaded" with Try again — never an empty list, which would claim she has made none.
 */

const PAGE_SIZE = 20;
const ALL = 'all';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ok'; papers: AssessmentPaper[]; total: number; page: number };

const dayOf = (iso: string | null) => {
  const d = iso ? pkDayMonth(iso) : null;
  return d ? `${d.day} ${d.month}` : null;
};

const nameOf = (p: AssessmentPaper) => ASSESSMENT_COPY.paperName(p.subject, p.chapter_number, p.version ?? null);

export default function MyAssessments() {
  const gate = useAssessmentGate();
  if (gate === false) return <Navigate to="/portal/assessment" replace />;
  return (
    <PortalLayout ownHeading>
      <InnerBar feature="assessment" crumb={ASSESSMENT_COPY.title} title={ASSESSMENT_COPY.mine} backTo="/portal/assessment" />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10">
        {gate ? <Papers /> : <Hero title={ASSESSMENT_COPY.loading} icon={Loader2} spinning live />}
      </div>
    </PortalLayout>
  );
}

function Papers() {
  const [grade, setGrade] = useState<string>(ALL);
  const [subject, setSubject] = useState<string>(ALL);
  const [grades, setGrades] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<AssessmentSubject[]>([]);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const [open, setOpen] = useState<AssessmentPaper | null>(null);

  // Her classes for the filter; a class's subjects once one is picked.
  useEffect(() => {
    let live = true;
    portal.getAssessmentOptions(grade === ALL ? undefined : Number(grade))
      .then((opts) => {
        if (!live) return;
        setGrades(opts.grades || []);
        setSubjects(grade === ALL ? [] : opts.subjects || []);
      })
      .catch(() => { /* the filters are a convenience; the list is the feature */ });
    return () => { live = false; };
  }, [grade]);

  const query = (page: number) => ({
    page,
    page_size: PAGE_SIZE,
    ...(grade !== ALL ? { grade: Number(grade) } : {}),
    ...(grade !== ALL && subject !== ALL ? { subject } : {}),
  });

  // The first page, again whenever a filter changes.
  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    setMore('idle');
    portal.getAssessmentPapers(query(1))
      .then((res) => { if (live) setLoad({ status: 'ok', papers: res.papers || [], total: Number(res.total) || 0, page: 1 }); })
      .catch(() => { if (live) setLoad({ status: 'error' }); });
    return () => { live = false; };
    // `query` is built from the filters listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, subject, attempt]);

  const loadMore = async () => {
    if (load.status !== 'ok' || more === 'loading') return;
    setMore('loading');
    try {
      const res = await portal.getAssessmentPapers(query(load.page + 1));
      setLoad((cur) => (cur.status === 'ok'
        ? { status: 'ok', papers: [...cur.papers, ...(res.papers || [])], total: Number(res.total) || cur.total, page: cur.page + 1 }
        : cur));
      setMore('idle');
    } catch {
      setMore('error');
    }
  };

  const pickGrade = (g: string) => { setGrade(g); setSubject(ALL); };
  const filtered = grade !== ALL;
  const ok = load.status === 'ok' ? load : null;

  return (
    <>
      <FilterChips<string>
        label={ASSESSMENT_COPY.rows.class}
        value={grade}
        onChange={pickGrade}
        options={[{ key: ALL, label: ASSESSMENT_COPY.all }, ...grades.map((g) => ({ key: String(g), label: ASSESSMENT_COPY.grade(g) }))]}
      />
      {filtered && subjects.length ? (
        <FilterChips<string>
          label={ASSESSMENT_COPY.rows.subject}
          value={subject}
          onChange={setSubject}
          options={[{ key: ALL, label: ASSESSMENT_COPY.allSubjects }, ...subjects.map((s) => ({ key: s.subject_key, label: s.subject }))]}
        />
      ) : null}

      {load.status === 'loading' ? <Hero title={ASSESSMENT_COPY.loading} icon={Loader2} spinning live /> : null}
      {load.status === 'error' ? (
        <>
          <Hero title={ASSESSMENT_COPY.notLoaded} icon={CircleAlert} tone="error" live />
          <BottomButton tone="outline" onClick={() => setAttempt((n) => n + 1)}>{ASSESSMENT_COPY.retry}</BottomButton>
        </>
      ) : null}
      {ok && !ok.papers.length ? (
        <>
          <Hero title={ASSESSMENT_COPY.empty} icon={Inbox} />
          {!filtered ? <BottomButton tone="outline" to="/portal/assessment">{ASSESSMENT_COPY.make}</BottomButton> : null}
        </>
      ) : null}

      {ok && ok.papers.length ? (
        <List label={ASSESSMENT_COPY.mine}>
          {ok.papers.map((p) => {
            const day = dayOf(p.ready_at);
            return (
              <Row
                key={p.paper_id}
                icon={subjectIcon(p.subject_key)}
                title={nameOf(p)}
                end={Download}
                onClick={() => setOpen(p)}
                chips={(
                  <>
                    {p.question_count != null ? <Chip>{ASSESSMENT_COPY.q(p.question_count)}</Chip> : null}
                    {day ? <Chip>{day}</Chip> : null}
                  </>
                )}
              />
            );
          })}
        </List>
      ) : null}

      {ok && ok.papers.length < ok.total ? (
        <List>
          <Row
            title={ASSESSMENT_COPY.moreRows}
            icon={more === 'loading' ? Loader2 : ChevronDown}
            tile="quiet"
            onClick={loadMore}
            state={more === 'loading' ? 'off' : undefined}
            chips={more === 'error' ? <Chip tone="error">{ASSESSMENT_COPY.notLoaded}</Chip> : undefined}
            testId="assessment-mine-more"
          />
        </List>
      ) : null}

      <PaperSheet paper={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** One paper: Download, and its Answer key when it has one. */
function PaperSheet({ paper, onClose }: { paper: AssessmentPaper | null; onClose: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setProblem(null); }, [paper?.paper_id]);
  if (!paper) return null;

  const download = async (artifact: 'paper' | 'answer_key') => {
    setProblem(null);
    const result = await downloadArtifact(paper.paper_id, artifact);
    if (result === 'unavailable') setProblem(artifact === 'answer_key' ? ASSESSMENT_COPY.noKey : ASSESSMENT_COPY.unavailable);
    if (result === 'failed') setProblem(ASSESSMENT_COPY.notOpened);
  };

  const day = dayOf(paper.ready_at);
  return (
    <Sheet open title={nameOf(paper)} onClose={onClose} testId="assessment-paper-sheet">
      <div className="flex flex-wrap justify-center gap-1.5 py-1">
        {paper.question_count != null ? <Chip>{ASSESSMENT_COPY.q(paper.question_count)}</Chip> : null}
        {paper.total_marks != null ? <Chip>{ASSESSMENT_COPY.marks(paper.total_marks)}</Chip> : null}
        {day ? <Chip>{day}</Chip> : null}
        {problem ? <Chip tone="error" icon={CircleAlert}>{problem}</Chip> : null}
      </div>
      <BottomButton icon={Download} onClick={() => download('paper')}>{ASSESSMENT_COPY.download}</BottomButton>
      {paper.has_answer_key ? (
        <BottomButton tone="outline" icon={KeyRound} onClick={() => download('answer_key')}>{ASSESSMENT_COPY.answerKey}</BottomButton>
      ) : null}
    </Sheet>
  );
}
