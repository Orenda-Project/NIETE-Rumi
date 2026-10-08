import { Award, Download, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TRAINING_COPY as T } from '../../newui/copy';
import { shortDate } from '../../newui/range';
import { downloadCertificate, viewCertificate } from '../../newui/training/certificateFile';
import { useTrainingCertificates } from '../../newui/training/TrainingCertificates';
import { providerInitials } from '../../newui/training/trainingApi';
import { StatusChip, Tray } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { providerLogo } from './model';
import { HeroCard, V2Row } from './parts';
import { LoadState, ProviderMark, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — her certificates (v28 canvas TrainingCertificates): a provider filter once a second
 * provider appears, a row each (the provider's real logo, the certificate's name, its date, download), and a
 * tray to view or download it. The read, the filter, and when a tap views or downloads are
 * useTrainingCertificates' (certificateFile's rules); only the look is v2.
 */
export function CertificatesPage() {
  const { paths, certs, list, providers, active, setFilter, shown, name, tap, open, setOpen } = useTrainingCertificates();

  const chip = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={active === key}
      onClick={() => setFilter(key)}
      className={cn(
        'inline-flex min-h-[56px] items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-semibold',
        active === key ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#d1d5db] bg-white text-[#1d2025]',
        FOCUS,
      )}
    >
      {key !== 'all' ? <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-white"><ProviderMark logo={providerLogo(key)} initials={providerInitials(key)} size={20} /></span> : null}
      {label}
    </button>
  );

  return (
    <TrainingPageV2 crumb={T.crumb()} title={T.certificates} backTo={paths.home}>
      <LoadState loading={certs.loading} failed={!certs.loading && !!certs.error} onRetry={certs.reload} />
      {!certs.loading && !certs.error && list.length === 0 ? <HeroCard icon={Award} tone="quiet" title={T.empty} /> : null}

      {list.length ? (
        <>
          {providers.length > 1 ? (
            <div role="radiogroup" aria-label={T.providers} className="flex flex-wrap gap-2">
              {chip('all', T.all(list.length))}
              {providers.map((p) => chip(p.key, T.providerCount(p.label, p.count)))}
            </div>
          ) : null}
          <div className="flex flex-col gap-2.5" data-testid="training-certificates-list">
            {shown.map((c) => {
              const date = c.issued_at ? shortDate(c.issued_at.slice(0, 10)) : null;
              const lead = (
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white">
                  <ProviderMark logo={providerLogo(c.vendor_key)} initials={providerInitials(String(c.vendor_key || ''), c.vendor_name)} size={34} />
                </span>
              );
              const body = (
                <>
                  {lead}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span dir="auto" className="text-[16px] font-semibold">{name(c)}</span>
                    {date ? <span className="text-[13px] text-[#6b7280]">{date}</span> : null}
                  </span>
                  {c.download_url ? <Download className="h-[22px] w-[22px] shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" /> : <StatusChip text={T.notAvailable} tone="info" />}
                </>
              );
              const box = cn(CARD, 'flex min-h-[76px] w-full items-center gap-3.5 py-2.5 pe-3.5 ps-3 text-start text-[#1d2025]');
              return c.download_url ? (
                <button key={c.id || c.certificate_code} type="button" onClick={() => tap(c)} data-testid={`training-certificate-${c.certificate_code}`} className={cn(box, FOCUS)}>{body}</button>
              ) : (
                <div key={c.id || c.certificate_code} data-testid={`training-certificate-${c.certificate_code}`} className={box}>{body}</div>
              );
            })}
          </div>
        </>
      ) : null}

      <Tray open={Boolean(open)} title={open ? name(open) : T.certificate} onClose={() => setOpen(null)}>
        {open ? (
          <div className="flex flex-col gap-2.5">
            <span className="flex flex-wrap gap-1.5">
              <StatusChip text={open.certificate_code} tone="done" />
              {open.issued_at ? <StatusChip text={shortDate(open.issued_at.slice(0, 10), true)} tone="info" /> : null}
            </span>
            <V2Row icon={Eye} title={T.view} onPress={() => viewCertificate(open.download_url!)} testId="training-certificate-view" />
            <V2Row icon={Download} title={T.download} end="download" onPress={() => downloadCertificate(open.download_url!)} testId="training-certificate-download" />
          </div>
        ) : null}
      </Tray>
    </TrainingPageV2>
  );
}
