import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { isLeader } from '../lib/leaderRole';
import { useNewUi } from '../lib/useNewUi';
import { OLD_ASSESSMENT_TAB, type AssessmentView } from '../lib/assessmentRoutes';
import LoadingState from '../components/LoadingState';
import AssessmentHome from '../newui/assessment/AssessmentHome';
import AssessmentRequest from '../newui/assessment/AssessmentRequest';
import MyAssessments from '../newui/assessment/MyAssessments';

/**
 * bd-5rz1v.13 — /portal/assessment and the pages inside it. They exist only in the new UI
 * (`portal_new_ui`): with the flag off, unreadable, or for a school leader, every address goes
 * to the Curriculum page's Assessment tab, which renders exactly what it did before
 * (PortalHomeList's rule for Home's lists).
 */
const PortalAssessment = ({ view }: { view: AssessmentView }) => {
  const auth = useAuth();
  const { user, loading } = auth;
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);
  if (newUi === null && (loading || user)) return <LoadingState type="full" />;
  if (newUi !== true || !user || isLeader(user)) return <Navigate to={OLD_ASSESSMENT_TAB} replace />;
  return (
    <AuthContext.Provider value={auth}>
      {view === 'home' ? <AssessmentHome /> : view === 'request' ? <AssessmentRequest /> : <MyAssessments />}
    </AuthContext.Provider>
  );
};

export default PortalAssessment;
