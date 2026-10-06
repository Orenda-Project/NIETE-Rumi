import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { isLeader } from '../lib/leaderRole';
import { useNewUi } from '../lib/useNewUi';
import { ASSESSMENT_PATH, type AssessmentView } from '../lib/assessmentRoutes';
import LoadingState from '../components/LoadingState';
import ClassicAssessment from './ClassicAssessment';
import AssessmentHome from '../newui/assessment/AssessmentHome';
import AssessmentRequest from '../newui/assessment/AssessmentRequest';
import MyAssessments from '../newui/assessment/MyAssessments';

/**
 * bd-5rz1v.13 — /portal/assessment and the pages inside it. They exist only in the new UI
 * (`portal_new_ui`). With the flag off, unreadable, or for a school leader, the home address is the
 * old UI's own Assessment Generator page (ClassicAssessment — bd-4n7p4, it was a Curriculum tab
 * before), and the inner addresses go to it (PortalHomeList's rule for Home's lists).
 */
const PortalAssessment = ({ view }: { view: AssessmentView }) => {
  const auth = useAuth();
  const { user, loading } = auth;
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);
  if (newUi === null && (loading || user)) return <LoadingState type="full" />;
  if (newUi !== true || !user || isLeader(user)) {
    // The home route IS the classic page; the inner routes land on it, so there is no loop.
    // bd-t5tow — handed the user this page already loaded, so ClassicAssessment (which keys its
    // stored paper jobs by her phone number) does not fetch /dashboard a second time.
    return view === 'home'
      ? <AuthContext.Provider value={auth}><ClassicAssessment /></AuthContext.Provider>
      : <Navigate to={ASSESSMENT_PATH} replace />;
  }
  return (
    <AuthContext.Provider value={auth}>
      {view === 'home' ? <AssessmentHome /> : view === 'request' ? <AssessmentRequest /> : <MyAssessments />}
    </AuthContext.Provider>
  );
};

export default PortalAssessment;
