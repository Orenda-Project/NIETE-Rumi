/**
 * bd-bfagiy — the REAL coach Schedule an observation page (CoachNewVisit) on its own, at the address given by `?at=`,
 * in the language given by `?lang=`. Every API read is answered by run.mjs (page.route); the app chrome (PortalLayout)
 * and the sign-in gate (CoachGate) are stubbed, so no stack or sign-in is needed. Local only: nothing here ships.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import i18n from '@/i18n/config';
import CoachNewVisit from '@/portal/coach/pages/CoachNewVisit';

const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'ur' ? 'ur' : 'en';
const AT = params.get('at') ?? '/portal/coach/new-visit';

async function start() {
  await i18n.changeLanguage(LANG);
  if (LANG === 'ur') await document.fonts.load('16px "Noto Nastaliq Urdu"', 'اردو');
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <main className="px-4">
        <MemoryRouter initialEntries={[AT]}>
          <Routes>
            <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </main>
    </StrictMode>,
  );
}
void start();
