import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Mail, Archive, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import nieteLogo from '@/assets/niete-logo.png';
import {
  DELETION_DAYS,
  DELETION_EMAIL,
  DELETION_MAILTO,
  DELETION_SUBJECT,
  PRIVACY_POLICY_PATH,
  PUBLISHER,
} from '../lib/legalLinks';

/**
 * bd-3wb0s — "Delete your NIETE account": the page Google Play's Data safety
 * form links to.
 *
 * PUBLIC on purpose. Play's rule is that a user can ask for deletion without
 * the app and without signing in, so this page reads no session and calls no
 * API: no useAuth, no PortalLayout (which would bounce a signed-out visitor to
 * the login form), nothing that can fail and redirect. It is the same page for
 * everyone, signed in or not.
 *
 * The request is an email (Play accepts that), so the steps are the first
 * thing on the page, with a one-tap mailto. The wording on what is deleted,
 * what may be kept and when must stay consistent with the NIETE privacy policy
 * (PortalPrivacy, "How long we keep it, and deleting it"); bd-nvnf2.
 */
const PortalDeleteAccount = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // The router gives the first page of a visit the key "default". Any other
  // key means she got here inside the app (from My account, say), so Back
  // returns her there; opened directly, it goes to the portal's front door.
  const cameFromInApp = location.key !== 'default';

  return (
    <div className="min-h-screen bg-secondary px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
          <div className="mb-6 text-center">
            <img src={nieteLogo} alt="NIETE logo" className="h-12 mx-auto mb-4" />
            <p className="text-sm font-medium text-accent mb-1">NIETE app and NIETE Portal</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">Delete your NIETE account</h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              You can ask us to delete your NIETE account and its data at any time. You don't need
              the app, and you don't need to sign in.
            </p>
          </div>

          {/* The steps come first and stand out: Play wants them prominent. */}
          <section
            data-testid="delete-account-steps"
            aria-labelledby="delete-account-how"
            className="rounded-lg border-2 border-accent/40 bg-accent/5 p-5 mb-6"
          >
            <h2 id="delete-account-how" className="text-lg font-semibold text-foreground mb-3">
              How to ask for deletion
            </h2>
            <ol className="space-y-3 text-base text-foreground">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">1</span>
                <span>
                  Email <a href={`mailto:${DELETION_EMAIL}`} className="font-semibold text-accent underline break-all">{DELETION_EMAIL}</a>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">2</span>
                <span>
                  Use the subject <strong>"{DELETION_SUBJECT}"</strong>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">3</span>
                <span>
                  Write the <strong>phone number you registered with</strong> and your <strong>name</strong>, so
                  we can find your account
                </span>
              </li>
            </ol>
            <Button asChild size="lg" className="mt-5 w-full bg-accent hover:bg-accent/90 whitespace-normal h-auto py-3">
              <a href={DELETION_MAILTO} data-testid="delete-account-mailto">
                <Mail className="w-5 h-5 mr-2 shrink-0" />
                Email us to delete my account
              </a>
            </Button>
            <p className="mt-2 text-center text-xs leading-normal text-muted-foreground">
              If the button doesn't open your email, write to {DELETION_EMAIL} yourself.
            </p>
          </section>

          <section data-testid="delete-account-deleted" aria-labelledby="delete-account-what" className="mb-6">
            <h2 id="delete-account-what" className="flex items-center gap-2 text-lg font-semibold text-foreground mb-2">
              <Trash2 className="w-5 h-5 text-accent shrink-0" />
              What we delete
            </h2>
            <ul className="list-disc space-y-1 pl-6 text-base leading-relaxed text-foreground">
              <li>Your account: your name, phone number, school and role</li>
              <li>Your lesson recordings, including lessons a coach recorded, and their transcripts</li>
              <li>AI feedback, reports and scores</li>
              <li>Photos and files you uploaded, such as lesson plans and board photos</li>
              <li>Your training progress and quiz answers</li>
            </ul>
            <p className="mt-2 text-sm leading-normal text-muted-foreground">
              After this you can no longer sign in with that account, and it cannot be undone.
            </p>
          </section>

          <section data-testid="delete-account-kept" aria-labelledby="delete-account-kept-title" className="mb-6">
            <h2 id="delete-account-kept-title" className="flex items-center gap-2 text-lg font-semibold text-foreground mb-2">
              <Archive className="w-5 h-5 text-accent shrink-0" />
              What we may keep
            </h2>
            <p className="text-base leading-relaxed text-foreground">
              Totals with no name or phone number in them, such as how many lessons were observed in a
              district, which we use for program statistics and which cannot be traced back to you. We
              also keep anything the law requires us to keep.
            </p>
          </section>

          <section data-testid="delete-account-timeline" aria-labelledby="delete-account-when" className="mb-6">
            <h2 id="delete-account-when" className="flex items-center gap-2 text-lg font-semibold text-foreground mb-2">
              <Clock className="w-5 h-5 text-accent shrink-0" />
              How long it takes
            </h2>
            <p className="text-base leading-relaxed text-foreground">
              We delete your account and its data within {DELETION_DAYS} days of your request, and email
              you to confirm when it is done.
            </p>
          </section>

          <div className="border-t border-border pt-5 text-sm text-muted-foreground space-y-2">
            {/* bd-nvnf2 — the same publisher the privacy policy and the Play
                listing name, from one constant. */}
            <p className="text-sm leading-normal">
              The {PUBLISHER.appName} app (on Google Play, developer {PUBLISHER.developerName}) and the
              NIETE Portal at portal.niete.edu.pk are published by {PUBLISHER.legalEntity}.
            </p>
            <p className="text-sm leading-normal">
              How we handle your data:{' '}
              <Link to={PRIVACY_POLICY_PATH} className="font-medium text-accent underline">
                Privacy policy
              </Link>
            </p>
            <p className="text-sm leading-normal">
              Questions? Email <a href={`mailto:${DELETION_EMAIL}`} className="text-accent underline">{DELETION_EMAIL}</a>.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          {/* Back: to the page she came from in the app (My account), else to
              /portal/login, which forwards a signed-in user to her home — so it
              is right for everyone without this page reading the session. */}
          <Link
            to="/portal/login"
            onClick={(e) => {
              if (!cameFromInApp) return;
              e.preventDefault();
              navigate(-1);
            }}
            className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent/80"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to the NIETE Portal
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PortalDeleteAccount;
