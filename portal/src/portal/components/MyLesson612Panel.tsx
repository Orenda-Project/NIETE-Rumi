/**
 * "My lesson plans" — every grade 6-12 lesson this teacher has asked for.
 *
 * WHY THIS IS NOT A CONVENIENCE. Authoring a 6-12 lesson takes a median of 172 seconds and a p90
 * of 314 (measured over all completed renders on production). A teacher WILL navigate away, and
 * the render finishes regardless — it is running on a worker, not in her tab. Without somewhere
 * for it to land, a lesson we have already paid ~$1.50 for is simply lost to her.
 *
 * Grades 1-5 need no equivalent: those PDFs are pre-rendered, so there is never a wait to
 * survive. This panel is therefore about the 6-12 lane only, and it says so rather than
 * pretending to cover the whole tab.
 *
 * It holds no lp612 rules — it lists what the bot says she has asked for, and mints a download
 * link per click because a presigned URL expires.
 */

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Download, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type MyLesson = {
  renderId: string;
  segmentId: string;
  state: 'ready' | 'authoring' | 'failed';
  title: string | null;
  grade: number | null;
  subject: string | null;
  lang: 'en' | 'ur';
};

/** Bumped by the parent when a render completes, so the list refreshes itself. */
const MyLesson612Panel = ({ refreshKey = 0 }: { refreshKey?: number }) => {
  const { toast } = useToast();
  const [lessons, setLessons] = useState<MyLesson[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/lp612/mine');
        if (!cancelled) setLessons(data.lessons || []);
      } catch {
        // Soft. This list is a backstop; failing to load it must not bury the picker above it.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const open = useCallback(async (renderId: string) => {
    try {
      const { data } = await api.get(`/lp612/status/${renderId}`);
      if (data.state === 'ready' && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
      toast({ title: 'That lesson is not ready yet' });
    } catch {
      toast({ title: 'Could not open that lesson', variant: 'destructive' });
    }
  }, [toast]);

  // Nothing asked for yet, and nothing to explain. An empty panel on a tab whose main lane
  // (grades 1-5) never populates it would just be noise.
  if (!loaded || lessons.length === 0) return null;

  return (
    <div className="border-t mt-8 pt-6">
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <BookOpen className="h-4 w-4" /> My lesson plans
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Grade 6-12 lessons you have asked for. These keep being written even if you leave.
      </p>

      <ul className="space-y-2">
        {lessons.map((m) => (
          <li key={m.renderId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{m.title || m.segmentId}</div>
              <div className="text-xs text-muted-foreground">
                {m.grade ? `Grade ${m.grade}` : ''}
                {m.subject ? ` · ${m.subject}` : ''}
                {m.lang === 'ur' ? ' · اردو' : ''}
              </div>
            </div>

            {m.state === 'ready' && (
              <Button size="sm" variant="outline" onClick={() => open(m.renderId)}>
                <Download className="h-4 w-4 mr-1" /> Open
              </Button>
            )}
            {m.state === 'authoring' && (
              <span className="text-sm text-muted-foreground flex items-center gap-1 shrink-0">
                <Clock className="h-4 w-4" /> Writing…
              </span>
            )}
            {m.state === 'failed' && (
              <span className="text-sm text-destructive flex items-center gap-1 shrink-0">
                <AlertCircle className="h-4 w-4" /> Failed
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MyLesson612Panel;
