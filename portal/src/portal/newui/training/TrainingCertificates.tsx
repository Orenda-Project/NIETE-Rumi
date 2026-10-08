import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Award, Download, Eye } from 'lucide-react';
import { List, Row } from '../List';
import { Chip, FilterChips } from '../Chip';
import { Hero } from '../Hero';
import { Sheet } from '../Sheet';
import { shortDate } from '../range';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingInner } from './frame';
import { canView, downloadCertificate, viewCertificate } from './certificateFile';
import { providerShort, trainingBase, trainingPaths, useGet } from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/certificates (deep-screens.html, Training 9), CertificatesPanel in
 * the kit. GET /training/certificates (a pure read, newest first).
 *
 *   filters  FilterChips: All n, then one per provider she holds one from, in the order their
 *            first certificate appears ("NIETE 1", "Beacon 2"); the picked one is indigo
 *   rows     a neutral award icon, "NIETE · Aspiring", the date as a chip, a download icon
 *   a tap    web: a sheet with its code, View (in place, ?view=1) and Download (a new tab);
 *            the app: it downloads, in place — no View (no PDF viewer in the WebView) and no
 *            _blank (external Chrome has no session). certificateFile.ts keeps those rules.
 */
type Cert = {
  id: string;
  certificate_code: string;
  level_name: string | null;
  vendor_key?: string | null;
  vendor_name?: string | null;
  issued_at: string | null;
  has_pdf?: boolean;
  download_url: string | null;
};

export function useTrainingCertificates() {
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));
  const certs = useGet<Cert[]>('/training/certificates', undefined, (d) => (d as { certificates?: Cert[] })?.certificates || []);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<Cert | null>(null);

  const list = certs.data || [];
  const providers: Array<{ key: string; label: string; count: number }> = [];
  for (const c of list) {
    if (!c.vendor_key) continue;
    const found = providers.find((p) => p.key === c.vendor_key);
    if (found) found.count += 1;
    else providers.push({ key: c.vendor_key, label: providerShort(c.vendor_key, c.vendor_name), count: 1 });
  }
  const active = providers.some((p) => p.key === filter) ? filter : 'all';
  const shown = active === 'all' ? list : list.filter((c) => c.vendor_key === active);
  const name = (c: Cert) => TRAINING_COPY.certTitle(c.vendor_key ? providerShort(c.vendor_key, c.vendor_name) : c.vendor_name, c.level_name);

  const tap = (c: Cert) => {
    if (!c.download_url) return;
    if (!canView()) { downloadCertificate(c.download_url); return; }
    setOpen(c);
  };

  return { pathname, paths, certs, filter, setFilter, open, setOpen, list, providers, active, shown, name, tap };
}

/** The view; every rule and read is useTrainingCertificates's, shared with the teacher app v2 (bd-fmf24g.12). */
export default function TrainingCertificates() {
  const { paths, certs, setFilter, open, setOpen, list, providers, active, shown, name, tap } = useTrainingCertificates();
  return (
    <TrainingInner crumb={TRAINING_COPY.crumb()} title={TRAINING_COPY.certificates} backTo={paths.home}>
      {certs.loading ? <Loading /> : null}
      {!certs.loading && certs.error ? <NotLoaded onRetry={certs.reload} /> : null}
      {!certs.loading && !certs.error && list.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={Award} tone="neutral" /> : null}

      {list.length ? (
        <>
          <FilterChips
            label={TRAINING_COPY.providers}
            options={[{ key: 'all', label: TRAINING_COPY.all(list.length) }, ...providers.map((p) => ({ key: p.key, label: TRAINING_COPY.providerCount(p.label, p.count) }))]}
            value={active}
            onChange={setFilter}
          />
          <List label={TRAINING_COPY.certificates}>
            {shown.map((c) => (
              <Row
                key={c.id || c.certificate_code}
                icon={Award}
                title={name(c)}
                chips={(
                  <>
                    {c.issued_at ? <Chip>{shortDate(c.issued_at.slice(0, 10))}</Chip> : null}
                    {!c.download_url ? <Chip>{TRAINING_COPY.notAvailable}</Chip> : null}
                  </>
                )}
                end={c.download_url ? Download : undefined}
                onClick={c.download_url ? () => tap(c) : undefined}
                testId={`training-certificate-${c.certificate_code}`}
              />
            ))}
          </List>
        </>
      ) : null}

      <Sheet open={Boolean(open)} title={open ? name(open) : TRAINING_COPY.certificate} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <span className="flex flex-wrap gap-1.5 px-1">
              <Chip tone="done">{open.certificate_code}</Chip>
              {open.issued_at ? <Chip>{shortDate(open.issued_at.slice(0, 10), true)}</Chip> : null}
            </span>
            <List>
              <Row icon={Eye} title={TRAINING_COPY.view} onClick={() => viewCertificate(open.download_url!)} testId="training-certificate-view" />
              <Row icon={Download} title={TRAINING_COPY.download} end={Download} onClick={() => downloadCertificate(open.download_url!)} testId="training-certificate-download" />
            </List>
          </>
        ) : null}
      </Sheet>
    </TrainingInner>
  );
}
