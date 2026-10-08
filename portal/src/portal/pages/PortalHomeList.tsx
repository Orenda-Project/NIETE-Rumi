import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { isLeader } from '../lib/leaderRole';
import { useNewUi } from '../lib/useNewUi';
import HomeList from '../newui/home/HomeList';
import { FrameSkeleton } from '../components/Skeleton';
import { readShellHint } from '../lib/shellHint';

/**
 * bd-5rz1v.17 — /portal/dashboard/:metric, the lists behind Home's tiles. They exist only in the
 * new UI: with the flag off (or for a leader) the address goes back to the dashboard, which
 * renders exactly what it did before.
 */
const PortalHomeList = () => {
  const auth = useAuth();
  const { user, loading } = auth;
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);
  // bd-fxk3t8 — the app's frame with placeholders while the flag is read, not a full-screen spinner.
  if (newUi === null && (loading || user)) return <FrameSkeleton variant={readShellHint() ?? 'classic'} />;
  if (newUi !== true || !user || isLeader(user)) return <Navigate to="/portal/dashboard" replace />;
  return <AuthContext.Provider value={auth}><HomeList /></AuthContext.Provider>;
};

export default PortalHomeList;
