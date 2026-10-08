import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { CircleAlert, Loader2, RotateCcw } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { InnerBar } from '../InnerBar';
import { Hero } from '../Hero';
import { BottomActions, BottomButton } from '../BottomButton';
import { TRAINING_COPY } from '../copy';

/**
 * bd-5rz1v.25 — the frame every Training page inside the flow shares: the light bar with the
 * graduation cap and the breadcrumb, then the content at the kit's spacing (0 14px 14px, 12px
 * between blocks; desktop 40px sides, centred at 1120px).
 */
export type TrainingFrameProps = {
  crumb: string;
  title: string;
  backTo: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
};

/**
 * bd-fmf24g.5 — the teacher app v2 mounts these screens under its own frame: a page inside this
 * context's provider renders through the given frame instead of the new UI's bar. Nothing here changes
 * without a provider (the default), so /portal/training is exactly as before.
 */
export const TrainingFrameContext = createContext<ComponentType<TrainingFrameProps> | null>(null);

export function TrainingInner({ crumb, title, backTo, onBack, right, children }: TrainingFrameProps) {
  const Frame = useContext(TrainingFrameContext);
  if (Frame) return <Frame crumb={crumb} title={title} backTo={backTo} onBack={onBack} right={right}>{children}</Frame>;
  return (
    <PortalLayout ownHeading>
      <InnerBar feature="training" crumb={crumb} title={title} backTo={backTo} onBack={onBack} right={right} />
      <TrainingBody>{children}</TrainingBody>
    </PortalLayout>
  );
}

export function TrainingBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10">{children}</div>;
}

/** The buttons: fixed above the menu on a phone; on a desktop under the content, at a readable width. */
export function TrainingActions({ children }: { children: ReactNode }) {
  return <div className="md:w-full md:max-w-[480px]"><BottomActions>{children}</BottomActions></div>;
}

export function Loading() {
  return <Hero title={TRAINING_COPY.loading} icon={Loader2} spinning live />;
}

/** A read that failed: said in two words, with one way to ask again. */
export function NotLoaded({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <Hero title={TRAINING_COPY.notLoaded} icon={CircleAlert} tone="error" live />
      <TrainingActions>
        <BottomButton tone="outline" icon={RotateCcw} onClick={onRetry}>{TRAINING_COPY.retry}</BottomButton>
      </TrainingActions>
    </>
  );
}
