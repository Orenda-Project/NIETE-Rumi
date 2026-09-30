import { useState, useEffect } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ObservationsSection from '../components/ObservationsSection';
import AttendanceSection from '../components/AttendanceSection';
import { RemarksReceivedSection } from '../components/RemarksSection';
import { portal } from '../services/api';
import { useToast } from '@/hooks/use-toast';
import type { MyAnalyticsResponse } from '../types/portal';

/**
 * My Analytics — a teacher's own page. It is the page her principal sees when
 * picking her on School Analytics, in her own words (operator, 2026-09-30):
 *
 *   · her lesson plans and exams generated
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

  useEffect(() => {
    portal.getMyAnalytics()
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
  }, [toast]);

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
  const totals = data.totals ?? { lessonPlans: 0, examsGenerated: 0 };
  const presence = data.presence ?? {
    teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
    student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null },
  };
  const tile = 'bg-white rounded-lg p-6 shadow-sm border border-border';

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">My Analytics</h1>
          <p className="text-muted-foreground">How your teaching is going, all in one place.</p>
        </header>

        <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-8">
          <div className={tile}>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Lesson plans</span>
            </div>
            <div data-testid="kpi-lesson-plans" className="text-3xl font-bold">{totals.lessonPlans}</div>
          </div>
          <div data-testid="kpi-exams" className={tile}>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Exams generated</span>
            </div>
            <div className="text-3xl font-bold">{totals.examsGenerated}</div>
          </div>
        </div>

        <ObservationsSection analytics={data.analytics} showTeacher={false} audience="teacher" />
        <AttendanceSection presence={presence} audience="teacher" />
        <RemarksReceivedSection remarks={data.remarksReceived ?? []} />
      </div>
    </PortalLayout>
  );
};

export default PortalCoachingAnalytics;
