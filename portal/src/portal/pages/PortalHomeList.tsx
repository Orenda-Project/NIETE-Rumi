import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { isLeader } from '../lib/leaderRole';
import { useNewUi } from '../lib/useNewUi';
import LoadingState from '../components/LoadingState';
import HomeList from '../newui/home/HomeList';

/**
 * bd-5rz1v.17 — /portal/dashboard/:metric, the lists behind Home's tiles. They exist only in the
 * new UI: with the flag off (or for a leader) the address goes back to the dashboard, which
 * renders exactly what it did before.
 */
const PortalHomeList = () => {
  const auth = useAuth();
  const { user, loading } = auth;
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);
  if (newUi === null && (loading || user)) return <LoadingState type="full" />;
  if (newUi !== true || !user || isLeader(user)) return <Navigate to="/portal/dashboard" replace />;
  return <AuthContext.Provider value={auth}><HomeList /></AuthContext.Provider>;
};

export default PortalHomeList;
