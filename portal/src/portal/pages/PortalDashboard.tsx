import { useState, useEffect } from 'react';
import { WHATSAPP_URL } from '@/lib/whatsapp';
import { Library, MessageSquare, TrendingUp, ExternalLink, GraduationCap, FileText } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import { useAuth } from '../hooks/useAuth';
import { isLeader } from '../lib/leaderRole';
import { portal } from '../services/api';
import PortalLayout from '../components/PortalLayout';
import StatCard from '../components/StatCard';
import ScoreIndicator from '../components/ScoreIndicator';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { DashboardStats, CoachingSession } from '../types/portal';

const PortalDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // bd-2434: the teacher dashboard is not the leader's home. A school leader
  // (coach / principal / aeo / …) belongs on My Patch — bounce them there.
  // Guards every entry point: the post-login redirect, a bookmark, a refresh.
  const userIsLeader = isLeader(user);
  useEffect(() => {
    if (userIsLeader) navigate('/portal/leader', { replace: true });
  }, [userIsLeader, navigate]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalCoachingSessions: 0,
    totalAssessments: 0,
    training: { modulesCompleted: 0, modulesTotal: 0, currentLevel: null },
  });
  const [recentSession, setRecentSession] = useState<CoachingSession | null>(null);
  const [scoreTrend, setScoreTrend] = useState<Array<{ date: string; score: number; percentage: number }>>([]);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const data = await portal.getDashboard();
        // Merged, not replaced. `training` is new (bd-60079) and a response
        // from an older API — or a partial one after a failed count — has no
        // such key, which would crash the render on stats.training.
        // A bundle newer than the service it is talking to is the normal state
        // during a deploy, so this is not a hypothetical.
        setStats((prev) => ({ ...prev, ...(data.stats || {}) }));
        setRecentSession(data.recentCoachingSession || null);
        
        // Fetch analytics for score trend
        try {
          const analyticsData = await portal.getCoachingAnalytics();
          setScoreTrend(analyticsData.analytics.overallScoreTrend);
        } catch (error) {
          console.log('Analytics not available');
        }
      } catch (error: any) {
        console.error('Dashboard fetch error:', error);
        toast({
          title: "Error Loading Data",
          description: "Could not load dashboard data. Please try again.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [toast]);

  // Chart configuration for score trend
  const chartOptions: ApexOptions = {
    chart: {
      type: 'line',
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
    },
    stroke: {
      curve: 'smooth',
      width: 3,
    },
    colors: ['hsl(15, 85%, 60%)'],
    grid: {
      borderColor: 'hsl(220, 13%, 91%)',
      strokeDashArray: 4,
    },
    xaxis: {
      categories: scoreTrend.map(item => {
        const date = new Date(item.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }),
      labels: {
        style: {
          colors: 'hsl(220, 9%, 46%)',
          fontSize: '12px',
        },
      },
    },
    yaxis: {
      min: 0,
      max: 100,
      labels: {
        style: {
          colors: 'hsl(220, 9%, 46%)',
          fontSize: '12px',
        },
        formatter: (value) => `${value}%`,
      },
    },
    tooltip: {
      y: {
        formatter: (value) => `${value}%`,
      },
    },
    dataLabels: {
      enabled: false,
    },
  };

  const chartSeries = [{
    name: 'Score',
    data: scoreTrend.map(item => item.percentage)
  }];

  // bd-2434: a leader is being redirected to My Patch — don't flash the teacher
  // dashboard (or its empty state) at them while the navigation happens.
  if (userIsLeader) return null;

  if (loading) {
    return (
      <PortalLayout>
        <LoadingState type="full" />
      </PortalLayout>
    );
  }

  // bd-2567: greet with the teacher's full name. `lastName` is already
  // returned by the API and carried on the User type, but was never shown.
  //
  // Built by filtering-then-joining rather than `${firstName} ${lastName}`,
  // because a null/empty surname is expected — data migrated from a system
  // with one combined name field leaves it blank — and interpolation would
  // render "Ayesha undefined" or leave a space dangling before the "!".
  // Both look broken to a teacher, and this heading is the first thing they
  // see. An unresolved user (auth still loading) yields "" rather than
  // "undefined".
  const displayName = [user?.firstName, user?.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-7xl">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light mb-2" data-testid="dashboard-greeting">
            Welcome back, {displayName}! 👋
          </h1>
          <p className="text-muted-foreground">
            Here's an overview of your teaching journey so far
          </p>
        </div>

        {/* bd-60079 — four smaller stats, not three big ones.
            "Lesson Plans" counted her own Gamma-generated output and custom
            generation is off, so it was frozen at whatever she reached. In its
            place: the three things she is still doing. Compact, because none
            of the four is the headline — the score trend below is. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          <StatCard
            compact
            title="Coaching sessions"
            value={stats.totalCoachingSessions}
            icon={MessageSquare}
          />
          <StatCard
            compact
            title="Latest score"
            value={recentSession?.percentage != null ? `${recentSession.percentage.toFixed(0)}%` : '—'}
            detail={recentSession?.percentage != null ? 'most recent lesson' : 'no scored session yet'}
            icon={TrendingUp}
          />
          <StatCard
            compact
            title="Training"
            // "12" alone says nothing; 12 of 384 is a fact.
            value={`${stats.training?.modulesCompleted ?? 0}/${stats.training?.modulesTotal ?? 0}`}
            detail={stats.training?.currentLevel || 'modules completed'}
            icon={GraduationCap}
          />
          <StatCard
            compact
            title="Assessments made"
            value={stats.totalAssessments}
            icon={FileText}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {/* bd-60078 — "Recent Lesson Plans" removed.
              It listed a teacher's own Gamma-generated plans and linked to My
              Plans, and custom generation is off. Its empty state actively
              invited her to "Generate your first lesson plan using the
              WhatsApp bot" — an instruction for a feature that no longer
              answers, which is worse than showing nothing.

              The ready-made catalogue she CAN use is under Curriculum, so the
              column now points there instead of disappearing and leaving the
              grid lopsided. */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-light">Lesson Plans</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/portal/curriculum" className="flex items-center gap-2">
                  Browse
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </Button>
            </div>

            <EmptyState
              icon={Library}
              title="Ready-made lesson plans"
              description="Browse the curriculum library by class, subject and chapter."
              actionLabel="Open the library"
              actionHref="/portal/curriculum"
            />
          </div>

          {/* Coaching Score Trend */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-light">Score Trend</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/portal/coaching/analytics" className="flex items-center gap-2">
                  Details
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </Button>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <Chart
                options={chartOptions}
                series={chartSeries}
                type="line"
                height={250}
              />
            </div>

            {/* Recent Coaching Session */}
            {recentSession && (
              <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
                <h3 className="text-lg font-semibold mb-4">Latest Session</h3>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">
                      {new Date(recentSession.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.floor(recentSession.duration / 60)} minutes
                    </p>
                  </div>
                  <ScoreIndicator 
                    percentage={recentSession.percentage} 
                    size="medium"
                  />
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to={`/portal/coaching/session/${recentSession.id}`}>
                    View Full Report
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 bg-gradient-to-r from-accent/10 to-primary/10 rounded-lg p-6 border border-accent/20">
          <h3 className="text-xl font-semibold mb-2">Ready to improve your teaching?</h3>
          <p className="text-muted-foreground mb-4">
            Get personalized coaching and lesson plans through WhatsApp
          </p>
          <Button asChild className="bg-accent hover:bg-accent/90">
            <a 
              href={WHATSAPP_URL} 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Open WhatsApp
            </a>
          </Button>
        </div>
      </div>
    </PortalLayout>
  );
};

export default PortalDashboard;
