import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, TrendingUp, CheckCircle2, Target, Lightbulb, FileText, MessageSquare } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import AudioPlayer from '../components/AudioPlayer';
import ScoreBreakdown from '../components/ScoreBreakdown';
import { UrduAware } from '../components/UrduAware';
import ScoreIndicator from '../components/ScoreIndicator';
import LoadingState from '../components/LoadingState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { portal } from '../services/api';
import { useToast } from '@/hooks/use-toast';
import type { SessionDetail } from '../types/portal';

const PortalCoachingDetail = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionDetail | null>(null);

  // Fetch session detail
  useEffect(() => {
    const fetchSession = async () => {
      if (!sessionId) {
        navigate('/portal/coaching');
        return;
      }

      try {
        const data = await portal.getCoachingSession(sessionId);
        setSession(data.session);
      } catch (error: any) {
        console.error('Session detail fetch error:', error);
        toast({
          title: "Error Loading Data",
          description: "Could not load session details. Please try again.",
          variant: "destructive"
        });
        navigate('/portal/coaching');
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, navigate, toast]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minutes`;
  };

  if (loading) {
    return (
      <PortalLayout>
        <LoadingState type="full" />
      </PortalLayout>
    );
  }

  if (!session) {
    return (
      <PortalLayout>
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/portal/coaching')}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Sessions
          </Button>
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">Session not found. Please try again later.</p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/portal/coaching')}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Sessions
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-light mb-2">Coaching Session Report</h1>
              <p className="text-muted-foreground">
                {formatDate(session.date)} • {formatDuration(session.duration)}
              </p>
            </div>
            <ScoreIndicator percentage={session.percentage} size="large" />
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            {/* The button used to say PDF and point at a raw private-bucket
                URL that answers 400. It is now presigned, and named for what
                the file actually is: 897 of 914 stored reports are PNG. Only
                drawn when there is something to open. */}
            {session.reportUrl && (
              <Button asChild variant="default" size="sm">
                <a
                  href={session.reportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  {session.reportFormat === 'pdf' ? 'Download report (PDF)' : 'Open your report'}
                </a>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/portal/coaching/analytics" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                View All Analytics
              </Link>
            </Button>
          </div>
        </div>

        {/* TWO recordings, named for what they are.
            This player was titled "Session Recording" and fed
            voice_debrief_url — the COACH talking. Her own lesson lives in
            audio_url, is present on 100% of sessions, and had never once been
            served to her. */}
        <div className="mb-8 space-y-4">
          {session.lessonAudioUrl && (
            <AudioPlayer
              audioUrl={session.lessonAudioUrl}
              title="Your lesson"
            />
          )}
          {session.debriefAudioUrl && (
            <AudioPlayer
              audioUrl={session.debriefAudioUrl}
              title="Your coach's debrief"
            />
          )}
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="analysis" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="analysis">Analysis & Scores</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>

          {/* Analysis Tab */}
          <TabsContent value="analysis" className="space-y-6">
            {/* Overall Score */}
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-semibold">Overall Performance</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-3xl font-bold text-foreground">
                    {session.analysisData.overall_score.points}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Points Earned</div>
                </div>
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-3xl font-bold text-foreground">
                    {session.analysisData.overall_score.max_points}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Maximum Points</div>
                </div>
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-3xl font-bold text-accent">
                    {session.analysisData.overall_score.percentage.toFixed(1)}%
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Success Rate</div>
                </div>
              </div>
            </div>

            {/* Her scores, from the framework she was actually assessed on.
                This replaced six OECD goal bars reading scores.goalN_total —
                keys a FICO session does not have, so five rendered zero under
                labels her framework has never used. The portal now names no
                framework and no domain; the bot supplies both. */}
            {session.breakdown && session.breakdown.groups.length > 0 ? (
              <ScoreBreakdown breakdown={session.breakdown} />
            ) : (
              <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
                <p className="text-sm text-muted-foreground">
                  This session has not been scored yet.
                </p>
              </div>
            )}

            {/* What the analysis said in prose. English on most sessions even
                when the lesson was in Urdu, so it goes through UrduAware
                rather than being assumed either way. */}
            {session.analysisData.executive_summary && (
              <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-5 h-5 text-accent" aria-hidden="true" />
                  <h2 className="text-xl font-semibold">In summary</h2>
                </div>
                <UrduAware
                  text={session.analysisData.executive_summary}
                  className="text-sm leading-relaxed text-muted-foreground"
                />
              </div>
            )}

            {/* Strengths */}
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h2 className="text-xl font-semibold">Strengths</h2>
              </div>
              <ul className="space-y-3">
                {session.analysisData.strengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Growth Opportunities */}
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-orange-600" />
                <h2 className="text-xl font-semibold">Growth Opportunities</h2>
              </div>
              <ul className="space-y-3">
                {session.analysisData.growth_opportunities.map((opportunity, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Target className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{opportunity}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="w-5 h-5 text-yellow-600" />
                <h2 className="text-xl font-semibold">Recommendations</h2>
              </div>
              <ul className="space-y-3">
                {session.analysisData.recommendations.map((recommendation, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{recommendation}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* HER OWN WORDS — the reflective question Rumi asked and the
                answer she gave, plus the action she was set. All of it has
                been stored since the pipeline began and she has never been
                able to re-read any of it.

                READ-ONLY, and the copy says where to act rather than letting
                the page look like an inert record. Answering and committing
                stay on WhatsApp; the write side is a separate piece of work. */}
            {((session.reflection && session.reflection.length > 0) || session.prioritizedAction) && (
              <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-5 h-5 text-accent" aria-hidden="true" />
                  <h2 className="text-xl font-semibold">Your reflection</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  From your conversation with Rumi on WhatsApp.
                </p>

                <div className="space-y-5">
                  {(session.reflection || []).map((entry, i) => (
                    <div key={i} className="space-y-2">
                      {entry.question && (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            Rumi asked
                          </div>
                          <UrduAware
                            text={entry.question}
                            className="text-sm text-foreground pl-3 border-l-2 border-border"
                          />
                        </div>
                      )}
                      {entry.answer ? (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            You answered
                          </div>
                          <UrduAware
                            text={entry.answer}
                            className="text-sm text-foreground pl-3 border-l-2 border-accent"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground pl-3">
                          You have not answered this one yet — reply to Rumi on WhatsApp.
                        </p>
                      )}
                    </div>
                  ))}

                  {session.prioritizedAction?.action && (
                    <div className="pt-4 border-t border-border">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                        One thing to try next class
                      </div>
                      <UrduAware
                        text={session.prioritizedAction.action}
                        className="text-sm text-foreground pl-3 border-l-2 border-accent"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Transcript Tab */}
          <TabsContent value="transcript">
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-semibold">Session Transcript</h2>
              </div>
              {/* Urdu on 97% of sessions, so this cannot render LTR in a
                  Latin face. Detected by SCRIPT rather than by
                  transcript_language, because that column describes the audio
                  while the analysis on the same row is English. */}
              <div className="prose max-w-none">
                <UrduAware
                  text={session.transcript}
                  className="text-foreground whitespace-pre-wrap leading-relaxed"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
};

export default PortalCoachingDetail;
