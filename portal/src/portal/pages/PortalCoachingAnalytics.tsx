import { useState, useEffect } from 'react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ObservationsSection from '../components/ObservationsSection';
import AttendanceSection from '../components/AttendanceSection';
import AttendancePanel from '../components/AttendancePanel';
import { RemarksReceivedSection } from '../components/RemarksSection';
import { AnalyticsControls } from '../components/AnalyticsControls';
import { useAnalyticsView } from '../lib/analyticsView';
import { portal } from '../services/api';
import { useToast } from '@/hooks/use-toast';
import type { MyAnalyticsResponse } from '../types/portal';

/**
 * My Analytics — a teacher's own page. It is the page her principal sees when
 * picking her on School Analytics, in her own words (operator, 2026-09-30):
 *
 *   · (her lesson plans and exams — hidden for now, operator 2026-09-30)
 *   · tabs + a date window over the page, as on School Analytics
 *   · Observations — Progress and Strong and Weak Areas from Human
 *     Observations only; her own Digital Coach Observations carry their
 *     ratings in the monthly list, because they are hers to learn from
 *   · Attendance — her own presence and her students', kept separate
 *   · Principal Remarks — the remark she received, whole
 */
const PortalCoachingAnalytics = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MyAnalyticsResponse | null>(null);
  const { tab, setTab, from, to, setRange } = useAnalyticsView();

  useEffect(() => {
    portal.getMyAnalytics({ from, to })
      .then(setData)
      .catch((error) => {
        console.error('My analytics fetch error:', error);
        toast({
          title: 'Error Loading Data',
          description: 'Could not load your analytics. Please try again.',
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  }, [toast, from, to]);

  if (loading) {
    return (
      <PortalLayout>
        <LoadingState type="full" />
      </PortalLayout>
    );
  }

  if (!data) {
    return (
      <PortalLayout>
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-7xl text-center">
          <p className="text-lg text-muted-foreground py-12">Your analytics could not be loaded. Please try again later.</p>
        </div>
      </PortalLayout>
    );
  }

  // Defaulted, not destructured bare: a partial response must cost a panel, not the page.
  const presence = data.presence ?? {
    teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
    student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null },
  };

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">My Analytics</h1>
          <p className="text-muted-foreground">How your teaching is going, all in one place.</p>
        </header>

        {/* Lesson plans and exams are hidden on her page for now (operator,
            2026-09-30); the server still sends them, under `totals`. */}
        <AnalyticsControls tab={tab} onTab={setTab} from={from} to={to} onRange={setRange} />
        {tab === 'observations' && (
          <ObservationsSection analytics={data.analytics} showTeacher={false} audience="teacher" range={{ from, to }} />
        )}
        {tab === 'attendance' && (
          <>
            <AttendanceSection presence={presence} audience="teacher" />
            <AttendancePanel audience="teacher" from={from} to={to} />
          </>
        )}
        {tab === 'remarks' && <RemarksReceivedSection remarks={data.remarksReceived ?? []} />}
      </div>
    </PortalLayout>
  );
};

export default PortalCoachingAnalytics;
