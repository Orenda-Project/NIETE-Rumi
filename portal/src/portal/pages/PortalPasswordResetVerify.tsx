import { useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Lock, MessageCircle } from 'lucide-react';
import { isLeader } from '../lib/leaderRole';
import { BottomButton } from '../newui';
import { auth } from '../services/api';
import { AuthFrame, AuthMessage } from '../auth/AuthFrame';
import { AuthField } from '../auth/AuthField';
import { CodeSlots } from '../auth/CodeSlots';
import { AUTH } from '../auth/copy';
import { statusOf, verifyFailure, type AuthError } from '../auth/errors';
import { useCopy } from '../teacher/i18n';

/**
 * bd-fmf24g.64 — enter the WhatsApp code and a new password, on ONE page (operator decision), in the shared auth frame.
 * The five checks and the two calls are the old ones; the code is one input drawn as six slots; where the code went is
 * plain information (WhatsApp and the number, left-to-right); one eye shows both passwords.
 */
const PortalPasswordResetVerify = () => {
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const c = useCopy(AUTH);

  const phoneNumber = location.state?.phoneNumber;

  if (!phoneNumber) return <Navigate to="/portal/reset-password" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (code.length !== 6) { setError({ field: 'code', key: 'sixDigits' }); return; }
    if (newPassword.length < 8) { setError({ field: 'password', key: 'tooShort' }); return; }
    if (newPassword !== confirmPassword) { setError({ field: 'confirm', key: 'differ' }); return; }

    setError(null);
    setLoading(true);
    try {
      // First verify the code
      await auth.verifyResetCode(phoneNumber, code);

      // Then reset the password. bd-2513: the server opens the session itself
      // (from the resetUserId it verified in the step above), so there is no
      // second login to perform here — we just land the teacher inside.
      const result = await auth.resetPassword(newPassword);

      // bd-2434: leaders go to My Patch, everyone else to the dashboard.
      navigate(isLeader(result?.user) ? '/portal/leader' : '/portal/dashboard');
      return;
    } catch (err) {
      setError(verifyFailure(statusOf(err)));
    }
    setLoading(false);
  };

  const under = (field: AuthError['field']) => (error && error.field === field ? c[error.key] : null);
  const eye = { shown: showPassword, onToggle: () => setShowPassword(!showPassword), showLabel: c.showPw, hideLabel: c.hidePw };

  return (
    <AuthFrame title={c.codeTitle} onBack={() => navigate('/portal/reset-password')}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Where the code went: information, so it is flat (no border, no chevron). */}
        <div className="mb-[22px] flex min-h-[48px] flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[14px] bg-nu-surface px-3.5 py-2.5 text-[17px] font-semibold">
          <MessageCircle className="h-[22px] w-[22px] shrink-0 text-nu-surface-muted" aria-hidden="true" />
          <span>{c.sentOnWhatsapp}</span>
          <span dir="ltr" className="ms-auto text-nu-surface-muted">{phoneNumber}</span>
        </div>

        <CodeSlots
          id="code"
          label={c.code}
          value={code}
          onChange={(v) => { setCode(v); if (error?.field === 'code') setError(null); }}
          error={under('code')}
          disabled={loading}
        />
        <AuthField
          id="newPassword"
          label={c.newPw}
          icon={Lock}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(v) => { setNewPassword(v); if (error?.field === 'password') setError(null); }}
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
        {error && error.field === 'form' ? <AuthMessage>{c[error.key]}</AuthMessage> : null}

        <BottomButton type="submit" busy={loading}>{loading ? c.resetting : c.resetPw}</BottomButton>
        <div className="h-3.5" />
      </form>
    </AuthFrame>
  );
};

export default PortalPasswordResetVerify;
