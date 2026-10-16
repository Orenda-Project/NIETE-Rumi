import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LogIn, MessageCircle } from 'lucide-react';
import { homeFor } from '../lib/homeRoute';
import { BottomButton } from '../newui';
import { auth } from '../services/api';
import { LoginSkeleton } from '../components/Skeleton';
import { AuthFrame } from '../auth/AuthFrame';
import { chatLink } from '../auth/RegisterOnWhatsApp';
import { AUTH } from '../auth/copy';
import { serverWhatsapp } from '../auth/errors';
import { useCopy } from '../teacher/i18n';

/**
 * bd-x7aprz.3 — an old /portal/setup/<token> link. The bot sent these (valid 7 days) to set a password; some are still
 * in teachers' chats. There is no password to set any more: a live link SIGNS HER IN and lands her on her home (the
 * server spends the token), and a dead one — used, expired, or never real — says "Link expired" with one button for a
 * new link from WhatsApp (the bot answers /portal with a fresh one) and a way to the login.
 *
 * It replaced the bd-fmf24g.64 set-password page.
 */
const PortalSetup = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const c = useCopy(AUTH);
  const [expired, setExpired] = useState<{ href: string | null } | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    // Once per mount: the token is spent on the first answer, so a second ask would always be "expired".
    if (asked.current) return;
    asked.current = true;
    if (!token) { setExpired({ href: null }); return; }
    auth.setupSignIn(token)
      .then((res) => {
        if (res && res.success) navigate(homeFor(res.user), { replace: true });
        else setExpired({ href: null });
      })
      .catch((err) => setExpired({ href: serverWhatsapp(err) }));
  }, [token, navigate]);

  if (!expired) return <LoginSkeleton />;

  return (
    <AuthFrame title={c.linkExpired}>
      <BottomButton to={chatLink('/portal', expired.href)} icon={MessageCircle}>{c.getNewLink}</BottomButton>
      <div className="h-3" />
      <BottomButton tone="outline" icon={LogIn} onClick={() => navigate('/portal/login')}>{c.login}</BottomButton>
      <div className="h-3.5" />
    </AuthFrame>
  );
};

export default PortalSetup;
