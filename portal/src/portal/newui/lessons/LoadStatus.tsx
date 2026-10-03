import { CircleAlert, Inbox, Loader2, RotateCcw } from 'lucide-react';
import { LESSONS_COPY } from '../copy';
import { Hero } from '../Hero';
import { BottomButton } from '../BottomButton';
import type { Loaded } from './shared';

/** Loading: a turning wheel. Failed: "Not loaded" and Try again. Empty: "Nothing yet". */
export function LoadStatus({ state, empty, onRetry }: { state: Loaded<unknown>; empty: boolean; onRetry: () => void }) {
  if (state.status === 'loading') return <Hero title={LESSONS_COPY.loading} icon={Loader2} spinning live />;
  if (state.status === 'error') {
    return (
      <>
        <Hero title={LESSONS_COPY.notLoaded} icon={CircleAlert} tone="error" live />
        <BottomButton tone="outline" icon={RotateCcw} onClick={onRetry}>{LESSONS_COPY.tryAgain}</BottomButton>
      </>
    );
  }
  if (state.status === 'ok' && empty) return <Hero title={LESSONS_COPY.empty} icon={Inbox} />;
  return null;
}
