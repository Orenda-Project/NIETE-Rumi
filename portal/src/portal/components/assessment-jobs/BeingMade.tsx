/**
 * "Being made" — the top of My papers while any paper is still being written, or has just
 * failed (bd-t5tow).
 *
 * The papers list below holds only READY papers, so without this a paper she has just asked
 * for would be invisible on the tab whose name promises it. A failed one stays here, with the
 * reason and a Try again, until she dismisses it — rather than vanishing with a toast she may
 * not have been looking at.
 */

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { failureMessage } from './failureMessages';
import type { PaperJob } from './usePaperJobs';

/** HH:MM, the way she reads a clock. */
function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Props = {
  jobs: PaperJob[];
  onRetry: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
};

const BeingMade = ({ jobs, onRetry, onDismiss }: Props) => {
  const shown = jobs.filter((j) => j.status === 'writing' || j.status === 'failed');
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="being-made-heading" className="space-y-2">
      <h4 id="being-made-heading" className="text-sm font-medium">Being made</h4>
      <ul className="divide-y rounded-lg border">
        {shown.map((job) => (job.status === 'writing' ? (
          <li key={job.requestId} className="flex flex-wrap items-center gap-3 p-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{job.label}</p>
              <p className="text-xs text-muted-foreground">
                {job.slow
                  ? "Taking longer than usual · we'll keep checking"
                  : `Started ${clock(job.startedAt)} · about a minute`}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">Writing…</span>
          </li>
        ) : (
          <li key={job.requestId} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{job.label}</span>
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  Not made
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{failureMessage(job.errorCode)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onRetry(job.requestId)}>Try again</Button>
              <Button size="sm" variant="ghost" onClick={() => onDismiss(job.requestId)}>Dismiss</Button>
            </div>
          </li>
        )))}
      </ul>
    </section>
  );
};

export default BeingMade;
