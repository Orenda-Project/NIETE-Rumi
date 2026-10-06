/**
 * ClassicAssessment — the old UI's Assessment Generator (bd-4n7p4).
 *
 * It was the "Assessment Generator" tab of the Curriculum page; it is now its own menu item and
 * page, /portal/assessment, with the content moved over unchanged. The new UI has its own
 * Assessment pages (newui/assessment); PortalAssessment picks between the two.
 *
 * bd-t5tow — two tabs, "Create paper" and "My papers" (?tab=papers), and a paper being made
 * is visible in both: a card on Create, a "Being made" row and a tab badge on My papers. The
 * jobs live here (usePaperJobs), not in the generator, so switching tabs never stops one.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '../hooks/useAuth';
import PortalLayout from '../components/PortalLayout';
import { portal } from '../services/api';
import type { AssessmentSpec } from '../services/api';
import AssessmentGeneratorPanel from '../components/AssessmentGeneratorPanel';
import AssessmentGeneratorComingSoon from '../components/AssessmentGeneratorComingSoon';
import AssessmentPapersPanel from '../components/AssessmentPapersPanel';
import BeingMade from '../components/assessment-jobs/BeingMade';
import { failureMessage } from '../components/assessment-jobs/failureMessages';
import { usePaperJobs, type PaperJob } from '../components/assessment-jobs/usePaperJobs';

type Tab = 'create' | 'papers';
const tabFrom = (search: string): Tab =>
  (new URLSearchParams(search).get('tab') === 'papers' ? 'papers' : 'create');

const ClassicAssessment = () => {
  // bd-2460 — null while loading, so the page never flashes a form that is off.
  const [assessmentEnabled, setAssessmentEnabled] = useState<boolean | null>(null);
  const [assessmentEditing, setAssessmentEditing] = useState(false);
  const [assessmentMessage, setAssessmentMessage] = useState<string | null>(null);
  // Bumped when a paper finishes so My papers refetches — she should not have
  // to reload the page to see the thing she just made.
  const [papersRefreshKey, setPapersRefreshKey] = useState(0);

  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // The tab is the URL, so a link can open My papers and browser Back returns to the last tab.
  const tab = tabFrom(location.search);
  const searchRef = useRef(location.search);
  searchRef.current = location.search;
  const goToTab = useCallback((next: Tab) => {
    // Already there (View on a toast while on My papers): no duplicate history entry.
    if (tabFrom(searchRef.current) === next) return;
    const params = new URLSearchParams(searchRef.current);
    if (next === 'papers') params.set('tab', 'papers'); else params.delete('tab');
    const search = params.toString();
    navigate({ search: search ? `?${search}` : '' }, { replace: false });
  }, [navigate]);

  // The job whose card Create shows. Cleared by Make another and by opening My papers — never
  // by a timer — and not restored on refresh (a still-writing job then shows in Being made).
  const [createJobId, setCreateJobId] = useState<string | null>(null);
  // Papers that became ready on this visit to the page, until she has looked at My papers.
  const [newIds, setNewIds] = useState<string[]>([]);
  const [papersTotal, setPapersTotal] = useState<number | null>(null);

  // Her jobs are stored under her own phone number: a shared school computer must not show
  // one teacher another's papers.
  const { user } = useAuth();
  const { jobs, start, retry, dismiss, retrying } = usePaperJobs({
    userKey: user?.phoneNumber || null,
    onReady: (job: PaperJob) => {
      setPapersRefreshKey((k) => k + 1);
      if (job.paperId) setNewIds((ids) => (ids.includes(job.paperId!) ? ids : [...ids, job.paperId!]));
      toast({
        title: 'Your paper is ready',
        description: job.label,
        action: <ToastAction altText="View" onClick={() => goToTab('papers')}>View</ToastAction>,
      });
    },
    onFailed: (job: PaperJob) => {
      toast({
        title: 'We could not make your paper',
        description: failureMessage(job.errorCode),
        variant: 'destructive',
      });
    },
  });

  // Opening My papers ends the Create card; leaving it ends the "New" highlights.
  const prevTab = useRef(tab);
  useEffect(() => {
    if (tab === 'papers') setCreateJobId(null);
    if (prevTab.current === 'papers' && tab !== 'papers') setNewIds([]);
    prevTab.current = tab;
  }, [tab]);

  const onStart = useCallback(async (spec: AssessmentSpec, label: string) => {
    const res = await start(spec, label);
    if (res.ok) setCreateJobId(res.job.requestId);
    return res;
  }, [start]);

  const onRetry = useCallback(async (requestId: string) => {
    const res = await retry(requestId);
    // null: a Try again for this job was already in flight, so nothing was sent.
    if (res && res.ok === false) {
      toast({ title: 'Could not start your paper', description: res.error, variant: 'destructive' });
    }
  }, [retry, toast]);

  const createJob = createJobId ? jobs.find((j) => j.requestId === createJobId) ?? null : null;
  const writingCount = jobs.filter((j) => j.status === 'writing').length;
  const newCount = tab !== 'papers' ? newIds.length : 0;

  useEffect(() => {
    let cancelled = false;
    portal.getConfig().then((cfg) => {
      if (cancelled) return;
      setAssessmentEnabled(!!cfg?.features?.assessmentGenerator);
      setAssessmentEditing(!!cfg?.features?.assessmentEditing);
      setAssessmentMessage(cfg?.features?.assessmentGeneratorMessage ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-5xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-light">Assessment Generator</h1>
          </div>
        </div>

        {/* bd-2460 — the page stays reachable on purpose: a teacher who has heard
            about the feature and cannot find it just asks support. The
            message matches what the bot says, and the API refuses too. */}
        {assessmentEnabled === null
          ? null
          : assessmentEnabled
            ? (
              <Tabs value={tab} onValueChange={(v) => goToTab(v === 'papers' ? 'papers' : 'create')}>
                <TabsList>
                  <TabsTrigger value="create">Create paper</TabsTrigger>
                  <TabsTrigger value="papers" className="gap-2">
                    My papers
                    {writingCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        {`${writingCount} being made`}
                      </span>
                    ) : newCount > 0 ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">
                        {`${newCount} new`}
                      </span>
                    ) : papersTotal != null ? (
                      <span className="rounded-full bg-muted-foreground/15 px-2 py-0.5 text-xs font-medium">
                        {papersTotal}
                      </span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                {/* Both tabs stay mounted (hidden when inactive): the form keeps her
                    choices, and the papers list keeps its filters and its count for
                    the badge. */}
                <TabsContent value="create" forceMount hidden={tab !== 'create'} className="mt-6">
                  <AssessmentGeneratorPanel
                    currentJob={createJob}
                    onStart={onStart}
                    onGoToPapers={() => goToTab('papers')}
                    onMakeAnother={() => setCreateJobId(null)}
                  />
                </TabsContent>

                {/* My papers lives on this page, beside the generator,
                    rather than as a page of its own. Making a paper and
                    fetching one you already made are the same job. A separate
                    page would imply papers exist independently
                    of the generator, which they do not. */}
                <TabsContent value="papers" forceMount hidden={tab !== 'papers'} className="mt-6 space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Everything you have made. Download it again any time.
                  </p>
                  <BeingMade jobs={jobs} retrying={retrying} onRetry={onRetry} onDismiss={dismiss} />
                  <AssessmentPapersPanel
                    refreshKey={papersRefreshKey}
                    editing={assessmentEditing}
                    highlightIds={tab === 'papers' ? newIds : []}
                    onTotal={setPapersTotal}
                    onCreate={() => goToTab('create')}
                  />
                </TabsContent>
              </Tabs>
            )
            : <AssessmentGeneratorComingSoon message={assessmentMessage} />}
      </div>
    </PortalLayout>
  );
};

export default ClassicAssessment;
