/**
 * ClassicAssessment — the old UI's Assessment Generator (bd-4n7p4).
 *
 * It was the "Assessment Generator" tab of the Curriculum page; it is now its own menu item and
 * page, /portal/assessment, with the content moved over unchanged. The new UI has its own
 * Assessment pages (newui/assessment); PortalAssessment picks between the two.
 */

import { useState, useEffect } from 'react';
import { ClipboardList } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { portal } from '../services/api';
import AssessmentGeneratorPanel from '../components/AssessmentGeneratorPanel';
import AssessmentGeneratorComingSoon from '../components/AssessmentGeneratorComingSoon';
import AssessmentPapersPanel from '../components/AssessmentPapersPanel';

const ClassicAssessment = () => {
  // bd-2460 — null while loading, so the page never flashes a form that is off.
  const [assessmentEnabled, setAssessmentEnabled] = useState<boolean | null>(null);
  const [assessmentEditing, setAssessmentEditing] = useState(false);
  const [assessmentMessage, setAssessmentMessage] = useState<string | null>(null);
  // Bumped when a paper finishes so My papers refetches — she should not have
  // to reload the page to see the thing she just made.
  const [papersRefreshKey, setPapersRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    portal.getConfig().then((cfg) => {
      if (cancelled) return;
      setAssessmentEnabled(!!cfg?.features?.assessmentGenerator);
      setAssessmentEditing(!!cfg?.features?.assessmentEditing);
      setAssessmentMessage(cfg?.features?.assessmentGeneratorMessage ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-5xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-light">Assessment Generator</h1>
          </div>
        </div>

        {/* bd-2460 — the page stays reachable on purpose: a teacher who has heard
            about the feature and cannot find it just asks support. The
            message matches what the bot says, and the API refuses too. */}
        {assessmentEnabled === null
          ? null
          : assessmentEnabled
            ? (
              <div className="space-y-10">
                <AssessmentGeneratorPanel
                  onPaperReady={() => setPapersRefreshKey((k) => k + 1)}
                />

                {/* My papers lives on this page, under the generator,
                    rather than as a page of its own. Making a paper and
                    fetching one you already made are the same job. A separate
                    page would imply papers exist independently
                    of the generator, which they do not. */}
                <section className="border-t pt-8">
                  <h3 className="mb-1 text-lg font-medium">My papers</h3>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Everything you have made. Download it again any time.
                  </p>
                  <AssessmentPapersPanel refreshKey={papersRefreshKey} editing={assessmentEditing} />
                </section>
              </div>
            )
            : <AssessmentGeneratorComingSoon message={assessmentMessage} />}
      </div>
    </PortalLayout>
  );
};

export default ClassicAssessment;
