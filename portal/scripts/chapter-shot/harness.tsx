/**
 * bd-oitowp — the REAL teacher v2 chapter page (LessonsPage) on its own, at the address given by `?at=`, in the
 * language given by `?lang=`. Every API read is answered by run.mjs (page.route), so no stack or sign-in is needed.
 * Local only: nothing here ships.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import i18n from '@/i18n/config';
import { LessonsPage } from '@/portal/teacher/lessons/LessonsPage';
import { LESSONS_HOME } from '@/portal/teacher/lessons/paths';
import { OwnPage } from '@/portal/teacher/lessons/own/OwnPage';
import { LESSONS_OWN } from '@/portal/teacher/lessons/own/state';

const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'ur' ? 'ur' : 'en';
const AT = params.get('at') ?? '';

async function start() {
  await i18n.changeLanguage(LANG);
  if (LANG === 'ur') await document.fonts.load('16px "Noto Nastaliq Urdu"', 'اردو');
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      {/* bd-snkn32.4 — the real PortalLayout's <main className="px-4 …">: the kit's dock (-mx-4) and hero assume it,
          and without it an Urdu page scrolls sideways in the harness only. */}
      <main className="px-4">
      <MemoryRouter initialEntries={[AT]}>
        <Routes>
          <Route path={`${LESSONS_HOME}/lessons`} element={<LessonsPage />} />
          {/* bd-snkn32.4 — the Make my own steps too (run.mjs --own) */}
          <Route path={LESSONS_OWN} element={<OwnPage />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
      </main>
    </StrictMode>,
  );
}
void start();
