/**
 * bd-hronni — the REAL coach Upload recording step (CoachAttach) on its own, at the address given by `?at=`, in the
 * language given by `?lang=`. Every API read is answered by run.mjs (page.route); the app chrome (PortalLayout) and the
 * sign-in gate (CoachGate) are stubbed, so no stack or sign-in is needed. Local only: nothing here ships.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import i18n from '@/i18n/config';
import CoachAttach from '@/portal/coach/pages/CoachAttach';

const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'ur' ? 'ur' : 'en';
const AT = params.get('at') ?? '/portal/coach/visit/v1/attach';

async function start() {
  await i18n.changeLanguage(LANG);
  if (LANG === 'ur') await document.fonts.load('16px "Noto Nastaliq Urdu"', 'اردو');
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <main className="px-4">
        <MemoryRouter initialEntries={[AT]}>
          <Routes>
            <Route path="/portal/coach/visit/:id/attach" element={<CoachAttach />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </main>
    </StrictMode>,
  );
}
void start();
