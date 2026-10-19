import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, UserRound } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { homeFor } from '../lib/homeRoute';
import { BottomButton } from '../newui';
import { LoginSkeleton } from '../components/Skeleton';
import { useCopy } from '../teacher/i18n';
import { AuthFrame, AuthMessage } from './AuthFrame';
import { AuthField } from './AuthField';
import { AUTH } from './copy';
import { accountLoginFailure, type AuthError } from './errors';

/**
 * The analytics accounts' own sign-in page (/portal/analytics/login): an account NAME, a password, one Log in. The
 * teacher sign-in's look (this folder's frame, fields and words) without anything a teacher's sign-in carries: no
 * phone, no WhatsApp code, no Forgot password (a name has no WhatsApp), no name/phone switch, no register prompt and
 * no banners. The teacher sign-in (pages/PortalLogin.tsx) is not touched by it.
 *
 * It signs in exactly as the teacher form does for a name: useAuth().login(name, password), the name in the phone
 * field of POST /api/portal/login, as typed (the server trims and lower-cases it). That same login reads the session
 * again, and the account goes where lib/homeRoute says: an analytics-only account to the schools analytics page,
 * anyone else (a phone typed into the name) to their own home. The server answers every refusal of a name with one
 * 401, so the page says the plain "Couldn't log in" and points at no field (auth/errors accountLoginFailure).
 */
const AnalyticsLogin = () => {
  const navigate = useNavigate();
  const c = useCopy(AUTH);
  // `sessionLoading` is "is there already a session?"; `loading` below is "is this form mid-submit".
  const { login, user, loading: sessionLoading } = useAuth();

  // Already signed in: never the form. The same rule as the teacher sign-in, through lib/homeRoute.
  useEffect(() => {
    if (sessionLoading || !user) return;
    navigate(homeFor(user), { replace: true });
  }, [user, sessionLoading, navigate]);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  // A message stays until she types in ITS field (a form message goes with either).
  const typeName = (v: string) => { setName(v); if (error && error.field !== 'password') setError(null); };
  const typePassword = (v: string) => { setPassword(v); if (error && error.field !== 'name') setError(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!name.trim()) { setError({ field: 'name', key: 'enterName' }); return; }
    if (!password) { setError({ field: 'password', key: 'enterPw' }); return; }
    setError(null);
    setLoading(true);
    try {
      const result = await login(name, password);
      if (result.success) {
        // The button stays on "Logging in" until the page changes.
        navigate(homeFor(result.user));
        return;
      }
      setError(accountLoginFailure((result as { status?: number }).status));
    } catch {
      setError(accountLoginFailure(0));
    }
    setLoading(false);
  };

  // The sign-in outline while the session is read, and while a signed-in visitor is sent on (never a flash of the form).
  if (sessionLoading || user) return <LoginSkeleton />;

  const under = (field: AuthError['field']) => (error && error.field === field ? c[error.key] : null);

  return (
    <AuthFrame title={c.analyticsTitle} subtitle={c.analyticsSub}>
      <form onSubmit={handleSubmit} noValidate>
        <AuthField
          id="accountName"
          label={c.accountName}
          icon={UserRound}
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          ltr
          value={name}
          onChange={typeName}
          error={under('name')}
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
        {error && error.field === 'form' ? <AuthMessage>{c[error.key]}</AuthMessage> : null}
        <BottomButton type="submit" busy={loading}>{loading ? c.loggingIn : c.login}</BottomButton>
        <div className="h-3.5" />
      </form>
    </AuthFrame>
  );
};

export default AnalyticsLogin;
