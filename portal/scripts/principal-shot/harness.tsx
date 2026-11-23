/**
 * bd-33wxxi.11 — the REAL teacher-app Home (pages/Home.tsx) and its phone bar, for a principal, at the address `?at=`
 * in the language `?lang=`. The signed-in user is given here (AuthContext); every API read (/config, /me/home,
 * /principal/school/card, …) is answered by run.mjs (page.route). Local only: nothing here ships.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import i18n from '@/i18n/config';
import { AuthContext } from '@/portal/hooks/authContext';
import Home from '@/portal/teacher/pages/Home';

const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'ur' ? 'ur' : 'en';
const AT = params.get('at') ?? '/portal/teacher';
const USER = {
  id: 'p-sample', firstName: 'Saima', lastName: 'Sample', role: params.get('role') || 'principal',
  phoneNumber: 'shot-principal', schoolName: 'IMSG (I-V) I-10/1',
};

async function start() {
  await i18n.changeLanguage(LANG);
  // The app sets these on <html> when the language changes; the harness page starts as English.
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ur' ? 'rtl' : 'ltr';
  if (LANG === 'ur') await document.fonts.load('16px "Noto Nastaliq Urdu"', 'اردو');
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <AuthContext.Provider value={{ user: USER, loading: false, error: null, refetch: async () => {} } as never}>
        <MemoryRouter initialEntries={[AT]}>
          <Routes>
            <Route path="/portal/teacher" element={<Home />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </StrictMode>,
  );
}
void start();
