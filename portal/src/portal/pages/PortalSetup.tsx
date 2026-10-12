import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, Lock, Smartphone, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BottomButton } from '../newui';
import { auth } from '../services/api';
import { LoginSkeleton } from '../components/Skeleton';
import { AuthFrame, AuthMessage } from '../auth/AuthFrame';
import { AuthField } from '../auth/AuthField';
import { AUTH } from '../auth/copy';
import { statusOf, type AuthError } from '../auth/errors';
import { useCopy } from '../teacher/i18n';

/**
 * bd-fmf24g.64 — first-time setup from an invitation link, in the shared auth frame. The calls, the 8-characters-and-a-
 * number rule and the one eye for both fields are as before. New: who she is is plain information, the two
 * requirements are chips that turn done as she meets them (red if she tries to continue without), and a link that has
 * died sends her to the login WITH its reason (no toast).
 */
/** 923000000000 reads as +92 300 0000000 (the shape she writes it in); anything else is shown as it came. */
const showPhone = (n: string) => {
  const m = /^92(\d{3})(\d{7})$/.exec(n);
  return m ? `+92 ${m[1]} ${m[2]}` : `+${n}`;
};

const PortalSetup = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const c = useCopy(AUTH);

  const [userInfo, setUserInfo] = useState<{ firstName: string; lastName: string; phoneNumber: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // bd-2668: ONE toggle for both fields — the whole point on this screen is to
  // compare the two entries when "Passwords do not match" fires, which a
  // per-field toggle would make harder.
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    validateToken();
  }, [token]);

  const validateToken = async () => {
    if (!token) {
      navigate('/portal/login', { state: { notice: 'linkExpired' }, replace: true });
      return;
    }

    try {
      const response = await auth.validateToken(token);
      if (response.success && response.user) {
        setUserInfo(response.user);
      } else {
        throw new Error('Invalid token');
      }
    } catch (err) {
      // The server says "already set up" in words; the page says it in a label (and in her language).
      const already = /already/i.test(String((err as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ?? ''));
      navigate('/portal/login', { state: { notice: already ? 'alreadySetUp' : 'linkExpired' }, replace: true });
    } finally {
      setValidating(false);
    }
  };

  const longEnough = password.length >= 8;
  const hasNumber = /\d/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // The requirement chips ARE the message for a weak password (they turn red); a mismatch is said under the second box.
    setTried(true);
    const mismatch = password !== confirmPassword;
    if (mismatch) setError({ field: 'confirm', key: 'differ' });
    if (!longEnough || !hasNumber || mismatch) return;

    setError(null);
    setLoading(true);
    try {
      const response = await auth.setup(token!, password);
      if (response.success) {
        navigate('/portal/dashboard');
        return;
      }
      setError({ field: 'form', key: 'couldntCreate' });
    } catch (err) {
      setError(statusOf(err) === 0 ? { field: 'form', key: 'noConnection' } : { field: 'form', key: 'couldntCreate' });
    }
    setLoading(false);
  };

  if (validating || !userInfo) return <LoginSkeleton />;

  const under = (field: AuthError['field']) => (error && error.field === field ? c[error.key] : null);
  const eye = { shown: showPassword, onToggle: () => setShowPassword(!showPassword), showLabel: c.showPw, hideLabel: c.hidePw };
  const chip = (met: boolean) => (met ? 'true' : tried ? 'error' : 'false');
  const chipClass = (state: string) => cn(
    'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold',
    state === 'true' ? 'bg-nu-chip-done-bg text-nu-chip-done' : state === 'error' ? 'bg-nu-chip-error-bg text-nu-chip-error' : 'bg-nu-surface text-nu-surface-muted',
  );

  return (
    <AuthFrame title={c.welcome}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Who she is: information, so flat. */}
        <div className="mb-[22px] flex flex-col gap-2">
          <div className="flex min-h-[48px] items-center gap-2.5 rounded-[14px] bg-nu-surface px-3.5 py-2.5 text-[17px] font-semibold">
            <User className="h-[22px] w-[22px] shrink-0 text-nu-surface-muted" aria-hidden="true" />
            <span dir="ltr">{userInfo.firstName} {userInfo.lastName}</span>
          </div>
          <div className="flex min-h-[48px] items-center gap-2.5 rounded-[14px] bg-nu-surface px-3.5 py-2.5 text-[17px] font-semibold">
            <Smartphone className="h-[22px] w-[22px] shrink-0 text-nu-surface-muted" aria-hidden="true" />
            <span dir="ltr">{showPhone(userInfo.phoneNumber)}</span>
          </div>
        </div>

        <AuthField
          id="password"
          label={c.password}
          icon={Lock}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(v) => { setPassword(v); if (error?.field === 'password') setError(null); }}
          error={under('password')}
          disabled={loading}
          eye={eye}
        />
        <AuthField
          id="confirmPassword"
          label={c.confirmPw}
          icon={Lock}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(v) => { setConfirmPassword(v); if (error?.field === 'confirm') setError(null); }}
          error={under('confirm')}
          disabled={loading}
          shown={showPassword}
        />

        <ul className="-mt-1 mb-[18px] flex flex-wrap gap-2">
          <li data-met={chip(longEnough)} className={chipClass(chip(longEnough))}>
            {longEnough ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            <span>{c.chars}</span>
          </li>
          <li data-met={chip(hasNumber)} className={chipClass(chip(hasNumber))}>
            {hasNumber ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            <span>{c.oneNum}</span>
          </li>
        </ul>
        {error && error.field === 'form' ? <AuthMessage>{c[error.key]}</AuthMessage> : null}

        <BottomButton type="submit" busy={loading}>{loading ? c.creating : c.create}</BottomButton>
        <div className="h-3.5" />
      </form>
    </AuthFrame>
  );
};

export default PortalSetup;
