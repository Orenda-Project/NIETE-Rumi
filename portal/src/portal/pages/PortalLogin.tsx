import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, Smartphone, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../hooks/useAuth';
import { homeFor } from '../lib/homeRoute';
import { isValidPkMobile } from '../lib/phone';
import { BottomButton } from '../newui';
import { FOCUS } from '../newui/styles';
import { FrameSkeleton, LoginSkeleton } from '../components/Skeleton';
import { readShellHint } from '../lib/shellHint';
import { AuthFrame, AuthMessage } from '../auth/AuthFrame';
import { AuthField } from '../auth/AuthField';
import { AUTH } from '../auth/copy';
import { loginFailure, type AuthError } from '../auth/errors';
import { useCopy } from '../teacher/i18n';

/**
 * bd-fmf24g.64 — the login in the teacher app's look (v36_login-refresh). The handlers, the checks and the API
 * calls are the ones this page always had; what changed is the frame (auth/AuthFrame), the words (auth/copy, one
 * bilingual table), and the messages: under the field that is wrong, in her language, chosen from the HTTP status
 * (auth/errors), kept until she types in that field. No toast.
 */
const PortalLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const c = useCopy(AUTH);
  // `sessionLoading` is deliberately distinct from the `loading` state below,
  // which tracks the submit button. One is "is there already a session?", the
  // other is "is this form mid-submit".
  const { login, user, loading: sessionLoading } = useAuth();

  // bd-2569: never show a login form to someone who is already signed in.
  //
  // The OTA app boots straight to /portal/login — that path is compiled into
  // the APK — which bypasses "/" (PortalRoot), the route that reads the
  // session and forwards an authenticated user onward. So a teacher whose
  // session was perfectly valid got the login form on every cold start and
  // reasonably concluded the app had logged them out.
  //
  // The session cookie is httpOnly, so this page cannot inspect a token
  // itself; useAuth already asks the server on mount, and this waits for that
  // answer. Same rule as PortalRoot: leaders go to My Patch, teachers to the
  // dashboard (bd-s6qbts.3: an analytics-only account to its analytics page — lib/homeRoute).
  useEffect(() => {
    if (sessionLoading || !user) return;
    navigate(homeFor(user), { replace: true });
  }, [user, sessionLoading, navigate]);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // A setup link that died sends her here with its reason (PortalSetup); it shows until she types.
  const notice = (location.state as { notice?: 'linkExpired' | 'alreadySetUp' } | null)?.notice;
  const [error, setError] = useState<(AuthError & { tone?: 'error' | 'done' }) | null>(
    notice ? { field: 'form', key: notice, tone: notice === 'alreadySetUp' ? 'done' : 'error' } : null,
  );

  const typePhone = (v: string) => { setPhoneNumber(v); if (error && error.field !== 'password') setError(null); };
  const typePassword = (v: string) => { setPassword(v); if (error && error.field !== 'phone') setError(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // bd-2511: a wrong-length number otherwise reaches the server, misses the
    // lookup, and comes back as "No portal account found" — which reads as
    // "you have no account" when the teacher just dropped a digit.
    if (!phoneNumber || !isValidPkMobile(phoneNumber)) {
      setError({ field: 'phone', key: 'checkNum' });
      return;
    }
    if (!password) {
      setError({ field: 'password', key: 'enterPw' });
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await login(phoneNumber, password);
      if (result.success) {
        // bd-2434: school leaders go straight to My Patch, not the teacher dashboard.
        // bd-s6qbts.3: an analytics-only account to its analytics page (lib/homeRoute).
        // The button stays on "Logging in" until the page changes.
        navigate(homeFor(result.user));
        return;
      }
      setError(loginFailure(result.status));
    } catch {
      setError(loginFailure(0));
    }
    setLoading(false);
  };

  // Render nothing until the session is known, then either the redirect above
  // fires or there is genuinely no session and the form is the right answer.
  // Flashing the form and yanking it away looks worse than the bug it fixes.
  // bd-fxk3t8 — an outline while the session is checked (it was white): the app's frame
  // if this device was signed in last time, else the sign-in card.
  if (sessionLoading || user) {
    const hint = readShellHint();
    return hint ? <FrameSkeleton variant={hint} /> : <LoginSkeleton />;
  }

  const under = (field: AuthError['field']) => (error && error.field === field ? c[error.key] : null);
  const noPassword = error?.key === 'noPw';

  return (
    <AuthFrame title={c.welcome}>
      <form onSubmit={handleSubmit} noValidate>
        <AuthField
          id="phoneNumber"
          label={c.phone}
          icon={Smartphone}
          type="tel"
          inputMode="tel"
          autoComplete="username"
          ltr
          value={phoneNumber}
          onChange={typePhone}
          placeholder={c.phoneHint}
          error={under('phone')}
        />
        <AuthField
          id="password"
          label={c.password}
          icon={Lock}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={typePassword}
          error={under('password')}
          eye={{ shown: showPassword, onToggle: () => setShowPassword(!showPassword), showLabel: c.showPw, hideLabel: c.hidePw }}
        />
        {error && error.field === 'form' ? (
          <AuthMessage tone={error.tone}>{c[error.key]}</AuthMessage>
        ) : null}

        <BottomButton type="submit" busy={loading}>{loading ? c.loggingIn : c.login}</BottomButton>

        <button
          type="button"
          data-emphasis={noPassword ? 'true' : undefined}
          className={cn(
            'mt-1.5 flex min-h-[56px] w-full items-center justify-center gap-2 text-[17px] font-bold text-nu-button',
            noPassword && 'mt-3.5 rounded-full border-2 border-nu-button',
            FOCUS,
          )}
          // bd-2512: carry whatever they already typed, so the reset
          // screen does not ask for the same number a second time.
          onClick={() => navigate('/portal/reset-password', { state: { phoneNumber } })}
        >
          <KeyRound className="h-[22px] w-[22px]" aria-hidden="true" />
          <span>{c.forgot}</span>
        </button>
      </form>
    </AuthFrame>
  );
};

export default PortalLogin;
