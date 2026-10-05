import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Award, Check, GraduationCap, ListChecks, Play } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { useAuth } from '../../hooks/useAuth';
import { MainHeading } from '../MainHeading';
import { AccountAvatar } from '../NewUiNavigation';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { KIT_COPY, TRAINING_COPY } from '../copy';
import { findContinue, type ContinueTarget } from './continue';
import { Loading, NotLoaded, TrainingActions, TrainingBody } from './frame';
import {
  percent, providerInitials, providerLabel, sortVendors, trainingBase, trainingPaths, useGet,
  type Level, type Vendor,
} from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training with the new UI on (deep-screens.html, Training 1).
 *
 *   heading    the flat indigo band, "Training" and the graduation cap; on the band the provider
 *              she is continuing with its % ("NIETE 24%") and her certificate count
 *   providers  a row each (NIETE, I-SAPS, Beacon House, Oxbridge): a neutral initials badge, the
 *              name, a green bar and the % — a check once done. The bar is the old card's:
 *              parts done over parts. A one-level provider (I-SAPS, Oxbridge) opens its level.
 *   certificates  a row with the count, to the certificates page
 *   Continue   the green bottom button, to where she left off (continue.ts says how)
 *
 * "My grades" (the band picker) is not here: it is in the account sheet. The one exception is
 * a teacher with nothing assigned, for whom it is the way out (bd-43487).
 */
export default function TrainingHome() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const base = trainingBase(pathname);
  const paths = trainingPaths(base);

  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const certs = useGet<number>('/training/certificates', undefined, (d) => ((d as { certificates?: unknown[] })?.certificates || []).length);

  // undefined while working it out, null when there is nothing to continue.
  const [target, setTarget] = useState<ContinueTarget | null | undefined>(undefined);
  useEffect(() => {
    if (!vendors.data || !levels.data) return undefined;
    let live = true;
    setTarget(undefined);
    findContinue(vendors.data, levels.data, base).then((t) => { if (live) setTarget(t); });
    return () => { live = false; };
  }, [vendors.data, levels.data, base]);

  const loading = vendors.loading || levels.loading;
  const failed = !loading && (vendors.error || levels.error);
  const retry = () => { vendors.reload(); levels.reload(); certs.reload(); };
  const nothing = !loading && !failed && (levels.data?.length ?? 0) === 0;

  const continuing = target ? vendors.data?.find((v) => v.vendor_key === target.vendorKey) : undefined;
  const certCount = certs.data ?? KIT_COPY.noValue;

  return (
    <PortalLayout ownHeading>
      <MainHeading
        feature="training"
        title={TRAINING_COPY.title}
        right={<div className="md:hidden"><AccountAvatar name={user?.firstName} testId="newui-training-avatar" /></div>}
        context={(
          <>
            {continuing ? (
              <Chip surface="band">
                {TRAINING_COPY.providerPct(providerLabel(continuing.vendor_key, vendors.data), percent(continuing.completed_module_count, continuing.module_count))}
              </Chip>
            ) : null}
            <Chip surface="band" icon={Award}>{certCount}</Chip>
          </>
        )}
      />
      <TrainingBody>
        {loading ? <Loading /> : null}
        {failed ? <NotLoaded onRetry={retry} /> : null}

        {!loading && !failed && nothing ? (
          <>
            <Hero title={TRAINING_COPY.noTraining} icon={GraduationCap} tone="neutral" />
            <List>
              <Row icon={ListChecks} title={TRAINING_COPY.myGrades} to={paths.grades} testId="training-my-grades" />
            </List>
          </>
        ) : null}

        {!loading && !failed && !nothing && vendors.data && levels.data ? (
          <List label={TRAINING_COPY.providers}>
            {sortVendors(vendors.data).map((v) => {
              const own = levels.data!.filter((l) => l.vendor_key === v.vendor_key);
              const pct = percent(v.completed_module_count, v.module_count);
              return (
                <Row
                  key={v.vendor_key}
                  lead={providerInitials(v.vendor_key, v.vendor_name)}
                  title={providerLabel(v.vendor_key, vendors.data)}
                  progress={pct}
                  value={pct >= 100
                    ? <Check className="h-[22px] w-[22px] text-nu-done" strokeWidth={3} aria-label={TRAINING_COPY.done} role="img" />
                    : TRAINING_COPY.pct(pct)}
                  to={own.length === 1 ? paths.level(v.vendor_key, own[0].id) : paths.provider(v.vendor_key)}
                  testId={`training-provider-${v.vendor_key}`}
                />
              );
            })}
          </List>
        ) : null}

        {!loading && !failed ? (
          <List>
            <Row icon={Award} title={TRAINING_COPY.certificates} value={certCount} to={paths.certificates} testId="training-certificates" />
          </List>
        ) : null}

        {!loading && !failed && !nothing && target !== null ? (
          <TrainingActions>
            {target ? (
              <BottomButton icon={Play} to={target.to} testId="training-continue">
                {TRAINING_COPY.continueTo(providerLabel(target.vendorKey, vendors.data))}
              </BottomButton>
            ) : (
              <BottomButton icon={Play} disabled>{TRAINING_COPY.continue}</BottomButton>
            )}
          </TrainingActions>
        ) : null}
      </TrainingBody>
    </PortalLayout>
  );
}
