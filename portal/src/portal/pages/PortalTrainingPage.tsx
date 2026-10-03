import type { ComponentType } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { isLeader } from '../lib/leaderRole';
import { useNewUi } from '../lib/useNewUi';
import { newOnlyFallback, type TrainingView } from '../lib/trainingRoutes';
import PortalTrainingV2 from './PortalTrainingV2';
import TrainingHome from '../newui/training/TrainingHome';
import TrainingLevels from '../newui/training/TrainingLevels';
import TrainingLevel from '../newui/training/TrainingLevel';
import TrainingCourse from '../newui/training/TrainingCourse';

/**
 * bd-5rz1v.25 — every /portal/training address goes through here (App.tsx mounts
 * TRAINING_ROUTES with this element).
 *
 *   flag on, a teacher   the new screen for the address, where it is built; a screen not built
 *                        yet renders the old page at the same address, so nothing is unreachable
 *                        while the screens land one PR at a time;
 *   otherwise            PortalTrainingV2, exactly as before (PortalTrainingV2.flagOff pins
 *                        it): the flag off, absent, still loading or unreadable, and every school
 *                        leader. An address only the new UI has goes to the old page it stands
 *                        for (newOnlyFallback).
 *
 * The old page is rendered in the same place for every address, so its state carries from one
 * training address to the next as it did when App.tsx mounted it directly.
 */
const SCREENS: Partial<Record<TrainingView, ComponentType>> = {
  home: TrainingHome,
  provider: TrainingLevels,
  level: TrainingLevel,
  course: TrainingCourse,
};

const PortalTrainingPage = ({ view }: { view: TrainingView }) => {
  const auth = useAuth();
  const { user, loading } = auth;
  const { pathname } = useLocation();
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);
  const on = newUi === true && !!user && !isLeader(user);
  const Screen = on ? SCREENS[view] : undefined;

  if (!on && newUi !== null) {
    const fallback = newOnlyFallback(view, pathname);
    if (fallback) return <Navigate to={fallback} replace />;
  }

  return (
    <AuthContext.Provider value={auth}>
      {Screen ? <Screen /> : <PortalTrainingV2 />}
    </AuthContext.Provider>
  );
};

export default PortalTrainingPage;
