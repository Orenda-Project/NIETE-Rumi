import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import nieteLogo from '@/assets/niete-logo.png';
import { DELETE_ACCOUNT_PATH, DELETION_DAYS, DELETION_EMAIL, PUBLISHER } from '../lib/legalLinks';

/**
 * bd-nvnf2 — the NIETE privacy policy: the URL in Play Console > App content >
 * Privacy policy (https://portal.niete.edu.pk/portal/privacy).
 *
 * Play rejected the app with "App or developer details don't match" while it
 * pointed at taleemabad.com's policy, which never names the app or its
 * developer. So the identity block comes first and names exactly what the
 * listing shows: the app, its package, the developer name and the legal entity
 * on the developer account (PUBLISHER, shared with the deletion page).
 *
 * Every claim below is checked against the code (inventory on bd-nvnf2): the
 * permissions in AndroidManifest.xml, what the portal uploads and where, the
 * vendors the bot and dashboard actually call, who a leader can see, and what
 * is (and is not) deleted. Change the code that one of these describes and this
 * page changes with it — Play compares it with the Data safety form.
 *
 * PUBLIC, like PortalDeleteAccount: no session read, no API call, no
 * PortalLayout, so Play's reviewer can open it signed out and outside the app.
 */

const LAST_UPDATED = '4 October 2026';

function Section({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="mb-7">
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      <div className="space-y-2 text-base leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-6">{children}</ul>;
}

const PortalPrivacy = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Same Back as the deletion page: in-app history if she came from the app,
  // else the portal's front door.
  const cameFromInApp = location.key !== 'default';

  return (
    <div className="min-h-screen bg-secondary px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <article className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
          <header className="mb-6 text-center">
            <img src={nieteLogo} alt="NIETE logo" className="h-12 mx-auto mb-4" />
            <p className="text-sm font-medium text-accent mb-1">NIETE app and NIETE Portal</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">NIETE Privacy Policy</h1>
            <p data-testid="privacy-updated" className="text-sm text-muted-foreground">
              Last updated: {LAST_UPDATED}
            </p>
          </header>

          <section
            data-testid="privacy-identity"
            aria-label="Who this policy covers"
            className="rounded-lg border-2 border-accent/40 bg-accent/5 p-5 mb-7 space-y-2 text-base leading-relaxed text-foreground"
          >
            <p>
              This policy covers the <strong>{PUBLISHER.appName} app</strong> on Google Play (package{' '}
              <span className="font-mono text-sm">{PUBLISHER.packageName}</span>, developer name:{' '}
              <strong>{PUBLISHER.developerName}</strong>) and the NIETE Portal at portal.niete.edu.pk.
            </p>
            <p>
              Both are published and run by <strong>{PUBLISHER.legalEntity}</strong>, {PUBLISHER.address},
              for the National Institute of Excellence in Teacher Education (NIETE), Islamabad. In this
              policy, "we" means {PUBLISHER.legalEntity}.
            </p>
            <p>
              The app is for teachers, coaches and school leaders in the NIETE program. Your account is the
              same one you use with the NIETE Teaching Assistant on WhatsApp.
            </p>
          </section>

          <Section title="What we collect">
            <Bullets>
              <li>
                <strong>Your account:</strong> your name, phone number, school, role (teacher, coach, principal
                and so on) and the language you choose. Your password is stored only in scrambled (hashed) form.
              </li>
              <li>
                <strong>What you record and upload:</strong> lesson recordings, spoken feedback a coach records,
                lesson plan files and photos, such as a photo of the board. We turn recordings into written
                transcripts.
              </li>
              <li>
                <strong>What the app makes for you:</strong> feedback, scores and reports on your lessons.
              </li>
              <li>
                <strong>Your training:</strong> your quiz and exam answers and your progress.
              </li>
              <li>
                <strong>Your classes:</strong> the grades, sections and subjects you teach, your students' names,
                and attendance.
              </li>
              <li>
                <strong>Technical information:</strong> when the app talks to our servers we log the time, the
                page or action, your IP address and your device and browser type.
              </li>
            </Bullets>
            <p>
              We do not collect your location, your contacts or an advertising ID, and the app has no analytics
              or advertising trackers.
            </p>
          </Section>

          <Section title="How we use it">
            <Bullets>
              <li>To run your account and sign you in, including sending your setup link and password reset codes on WhatsApp.</li>
              <li>To give you feedback on your teaching: your recordings are transcribed and analysed by AI, which writes the feedback and scores.</li>
              <li>To let your coach and school leaders support you (see "Who can see it").</li>
              <li>To run training, class lists and attendance.</li>
              <li>To see which features are used, keep the service secure and fix problems.</li>
              <li>To report on the NIETE program, using totals with no names or phone numbers in them.</li>
            </Bullets>
            <p>
              <strong>We do not sell your data.</strong> The app has no advertising, and we do not use your data
              to target ads at anyone.
            </p>
          </Section>

          <Section title="Who processes it for us">
            <p>These companies process data for us, only to run the service:</p>
            <Bullets>
              <li><strong>Supabase:</strong> our database.</li>
              <li><strong>Cloudflare R2:</strong> storage for recordings, photos and documents.</li>
              <li><strong>Railway and Amazon Web Services:</strong> our servers and job queues.</li>
              <li><strong>Soniox and OpenAI:</strong> speech-to-text, turning recordings into transcripts.</li>
              <li>
                <strong>OpenRouter, OpenAI, Google (Gemini) and Anthropic:</strong> AI that reads transcripts and
                photos and writes feedback and teaching material.
              </li>
              <li><strong>SpeechAce:</strong> scoring children's spoken English in reading checks.</li>
              <li><strong>ElevenLabs and Uplift:</strong> turning written feedback into audio. They receive the text, not your recordings.</li>
              <li><strong>Meta (WhatsApp):</strong> messages between you and the NIETE Teaching Assistant.</li>
              <li><strong>Axiom:</strong> technical logs.</li>
              <li><strong>Google BigQuery:</strong> teacher attendance reports.</li>
              <li><strong>Google Fonts:</strong> the app's typefaces, which your device downloads from Google.</li>
            </Bullets>
            <p>Some of these companies store or process data outside Pakistan.</p>
          </Section>

          <Section title="Who can see it">
            <Bullets>
              <li>You can see your own data.</li>
              <li>
                Coaches, principals, supervisors, AEOs and school leaders can see the teachers at the schools
                assigned to them: name, phone number, coaching scores, a summary of feedback, and how many lesson
                plans the teacher has. Principals also see their school's reports and teacher attendance.
              </li>
              <li>A small number of our staff can see data when they need to run or support the service.</li>
              <li>NIETE receives program reports made of totals, with no names or phone numbers in them.</li>
              <li>We share data with anyone else only where the law requires it.</li>
            </Bullets>
          </Section>

          <Section title="App permissions">
            <Bullets>
              <li>
                <strong>Microphone:</strong> only when you choose to record a lesson or feedback. You can say no,
                and the rest of the app still works.
              </li>
              <li><strong>Internet:</strong> to reach our servers.</li>
            </Bullets>
            <p>
              The app does not ask for camera, storage, location, contacts or notification permissions. When you
              take a photo, your phone's own camera app opens and you choose what to send. A recording waits on
              your phone until it has uploaded, then the app removes it from your phone.
            </p>
          </Section>

          <Section title="How we protect it">
            <Bullets>
              <li>Everything between the app and our servers travels encrypted (HTTPS).</li>
              <li>Passwords are stored only in hashed form.</li>
              <li>Our database and file storage providers encrypt data where it is stored.</li>
              <li>
                Your sign-in lasts 7 days. Setup links expire after 7 days and password reset codes after
                10 minutes.
              </li>
              <li>Leaders see only the schools assigned to them, and staff access is limited to those who need it.</li>
            </Bullets>
          </Section>

          <Section title="How long we keep it, and deleting it" testId="privacy-deletion">
            <p>
              We keep your account, recordings, transcripts, feedback, uploads and training records for as long
              as your account exists, so you and your coach can go back to them. Our speech-to-text provider's
              copies are deleted within a few hours.
            </p>
            <p>
              You can ask us to delete your account and its data at any time by emailing{' '}
              <a href={`mailto:${DELETION_EMAIL}`} className="text-accent underline break-all">{DELETION_EMAIL}</a>.
              We do it within {DELETION_DAYS} days and email you when it is done. We may keep totals with no name
              or phone number in them, and anything the law requires us to keep. The steps are on{' '}
              <Link to={DELETE_ACCOUNT_PATH} className="font-medium text-accent underline">
                Delete your NIETE account
              </Link>
              .
            </p>
          </Section>

          <Section title="Children">
            <p>
              The app is for adults: teachers, coaches and school leaders. Children do not have accounts and do
              not use the app. Teaching involves children, though, so some features handle their information for
              their schools:
            </p>
            <Bullets>
              <li>Lesson recordings include students' voices in class.</li>
              <li>
                Teachers can add students' names to class lists and record attendance. A teacher can send a photo
                of a class register to the NIETE Teaching Assistant, which reads roll numbers, students' and
                fathers' names and a parent's phone number from it.
              </li>
              <li>
                Where a school takes part in learning checks, a coach or school leader may record a child reading
                aloud and photograph their maths work, with the child's name and father's name, to measure
                learning.
              </li>
            </Bullets>
            <p>
              We use this only to support teaching and measure learning in the NIETE program, never for
              advertising. A parent or school can ask us to delete a child's data by emailing{' '}
              <a href={`mailto:${DELETION_EMAIL}`} className="text-accent underline break-all">{DELETION_EMAIL}</a>.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              When we change this policy we update the date at the top, and we tell users about important
              changes in the app or on WhatsApp.
            </p>
          </Section>

          <Section title="Contact us" testId="privacy-contact">
            <p>
              {PUBLISHER.legalEntity}
              <br />
              {PUBLISHER.address}
            </p>
            <p>
              Email:{' '}
              <a href={`mailto:${DELETION_EMAIL}`} className="text-accent underline break-all">{DELETION_EMAIL}</a>
            </p>
          </Section>
        </article>

        <div className="mt-6 text-center">
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

export default PortalPrivacy;
