import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-t5tow — with "Lesson Plans" and "Assessment Generator" in the menu, the desktop bar wrapped
 * labels onto two lines below 1366px. Each link keeps its label on one line.
 */
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { firstName: 'Sana', lastName: 'A', phoneNumber: '923000000000', role: 'teacher' }, loading: false, logout: vi.fn() }),
}));
vi.mock('../services/api', () => ({ portal: { getConfig: vi.fn().mockResolvedValue({ success: true, features: {} }) } }));

import PortalNavigation from './PortalNavigation';

it('desktop menu labels never wrap', () => {
  render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
  for (const name of ['Lesson Plans', 'Assessment Generator', 'My Classes']) {
    const links = screen.getAllByRole('link', { name: new RegExp(name) });
    expect(links.some((a) => a.className.includes('whitespace-nowrap'))).toBe(true);
  }
});
