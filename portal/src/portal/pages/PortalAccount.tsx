import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, LogOut, School, ShieldCheck, UserMinus, UserRound } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import PortalLayout from '../components/PortalLayout';
import { useAuth } from '../hooks/useAuth';
import { DELETE_ACCOUNT_PATH, EXTERNAL_LINK_PROPS, PRIVACY_POLICY_URL } from '../lib/legalLinks';
import type { User } from '../types/portal';

/**
 * bd-3wb0s — My account.
 *
 * Google Play wants the privacy policy and an account-deletion path findable
 * inside the app. Rather than scatter both through the navigation, they live
 * here, under the one thing a user expects on an account page: who she is.
 *
 * Who she is = her own name and her school (operator, 2026-10-03). Not her
 * phone number and not her role: she knows both, and the page is not a place
 * to recite them back. An unknown school shows nothing — no "—", no "N/A".
 *
 * Signed-in only (PortalLayout sends anyone else to /portal/login), and the
 * same page for teachers and every leader role.
 */

/** Her name as one string: the API puts the whole of users.name in firstName. */
function fullName(user: User): string {
  return [user.firstName, user.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * First letter of the first and last word ("Ayesha Khan" → "AK"); one letter
 * for a single name. Code-point aware, so a name in Urdu script works too.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = (w: string) => Array.from(w)[0] ?? '';
  const letters = words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
  return letters.toLocaleUpperCase();
}

function cleanSchool(value: User['schoolName']): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

const PAGE = 'mx-auto flex w-full max-w-xl flex-col gap-3.5 pb-6';
const TITLE = 'text-3xl font-light sm:text-4xl';
const ROW = 'flex min-h-[56px] items-center gap-3.5 px-4 py-2 text-start transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent';

/** Same shapes and heights as the loaded page, so nothing moves when it arrives. */
const AccountSkeleton = () => (
  <div data-testid="account-skeleton" className={PAGE}>
    <h1 className={TITLE}>My account</h1>
    <div className="flex items-center gap-4 rounded-2xl bg-white p-5" aria-hidden="true">
      <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <Skeleton className="h-6 w-44 max-w-full" />
        <Skeleton className="h-4 w-32 max-w-full" />
      </div>
    </div>
    <div className="overflow-hidden rounded-2xl bg-white" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="flex h-14 items-center gap-3.5 border-b border-[#eceef1] px-4 last:border-b-0">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 w-36" />
        </div>
      ))}
    </div>
    <Skeleton className="h-12 w-full rounded-xl" aria-hidden="true" />
  </div>
);

const AccountView = () => {
  const { user, logout } = useAuth();
  if (!user) return <AccountSkeleton />;

  const name = fullName(user);
  const initials = initialsOf(name);
  const school = cleanSchool(user.schoolName);

  return (
    <div data-testid="account-page" className={PAGE}>
      <h1 className={TITLE}>My account</h1>

      <section data-testid="account-header" aria-label="Your details" className="flex items-center gap-4 rounded-2xl bg-white p-5">
        <div
          data-testid="account-avatar"
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-full bg-accent text-[24px] font-bold leading-none text-white"
        >
          {initials || <UserRound className="h-8 w-8" />}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p data-testid="account-name" className="break-words text-[22px] font-bold leading-tight text-foreground">
            {name || 'Signed in'}
          </p>
          {school && (
            <p data-testid="account-school" className="flex items-start gap-1.5 text-[15px] leading-snug text-[#5b6170]">
              <School className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{school}</span>
            </p>
          )}
        </div>
      </section>

      <nav aria-label="Account" className="overflow-hidden rounded-2xl bg-white">
        <ul className="divide-y divide-[#eceef1]">
          <li>
            <a href={PRIVACY_POLICY_URL} {...EXTERNAL_LINK_PROPS} className={`${ROW} text-foreground`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.06] text-primary">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="flex-1 text-[17px] font-medium">Privacy policy</span>
              <span className="sr-only">(opens outside the app)</span>
              <ExternalLink className="h-[18px] w-[18px] shrink-0 text-[#9aa0aa] rtl:-scale-x-100" aria-hidden="true" />
            </a>
          </li>
          <li>
            <Link to={DELETE_ACCOUNT_PATH} className={`${ROW} text-[#a8423b]`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fbeceb]">
                <UserMinus className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="flex-1 text-[17px] font-medium">Delete my account</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-[#9aa0aa] rtl:rotate-180" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </nav>

      <button
        type="button"
        onClick={logout}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[#d6d9de] bg-white text-[16px] font-semibold text-primary transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <LogOut className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
        Logout
      </button>
    </div>
  );
};

const PortalAccount = () => (
  <PortalLayout loadingFallback={<AccountSkeleton />}>
    <AccountView />
  </PortalLayout>
);

export default PortalAccount;
