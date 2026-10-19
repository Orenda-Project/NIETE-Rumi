import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Smartphone } from 'lucide-react';
import { isValidPkMobile } from '../lib/phone';
import { BottomButton } from '../newui';
import { auth } from '../services/api';
import { AuthFrame, AuthMessage } from '../auth/AuthFrame';
import { AuthField } from '../auth/AuthField';
import { AUTH } from '../auth/copy';
import { RegisterOnWhatsApp } from '../auth/RegisterOnWhatsApp';
import { resetFailure, serverWhatsapp, statusOf, type AuthError } from '../auth/errors';
import { useCopy } from '../teacher/i18n';

/**
 * bd-fmf24g.64 — forgot password, in the shared auth frame (v36_login-refresh). Same checks and the same
 * `requestReset` call; the number is carried from the login, editable. Messages sit under the field, from the status.
 */
const PortalPasswordReset = () => {
  const location = useLocation();
  const c = useCopy(AUTH);
  // bd-2512: seeded from the login screen when the user came via "Forgot
  // password?". Editable — a pre-fill is a default, not a lock — and empty
  // when this page is opened directly.
  const [phoneNumber, setPhoneNumber] = useState(location.state?.phoneNumber ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  // bd-x7aprz.3: a number that is not registered gets the way to register, never "No account found".
  const [register, setRegister] = useState<{ href: string | null } | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // bd-2511: catch a dropped digit here rather than letting the lookup miss
    // and report the account as non-existent.
    if (!phoneNumber.trim() || !isValidPkMobile(phoneNumber)) {
      setError({ field: 'phone', key: 'checkNum' });
      return;
    }

    setError(null);
    setRegister(null);
    setLoading(true);
    try {
      await auth.requestReset(phoneNumber);
      navigate('/portal/reset-password/verify', { state: { phoneNumber } });
      return;
    } catch (err) {
      const status = statusOf(err);
      if (status === 404) setRegister({ href: serverWhatsapp(err) });
      else setError(resetFailure(status));
    }
    setLoading(false);
  };

  return (
    <AuthFrame title={c.forgot} onBack={() => navigate('/portal/login')}>
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
          onChange={(v) => { setPhoneNumber(v); setError(null); setRegister(null); }}
          placeholder={c.phoneHint}
          disabled={loading}
          error={error?.field === 'phone' ? c[error.key] : null}
        />
        {error && error.field === 'form' ? <AuthMessage>{c[error.key]}</AuthMessage> : null}
        {register ? <RegisterOnWhatsApp href={register.href} /> : null}
        <BottomButton type="submit" icon={MessageCircle} busy={loading}>{loading ? c.sending : c.sendCode}</BottomButton>
        <div className="h-3.5" />
      </form>
    </AuthFrame>
  );
};

export default PortalPasswordReset;
