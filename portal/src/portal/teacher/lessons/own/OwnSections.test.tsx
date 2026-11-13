import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-snkn32.19 — spec item 7 / screen 9 on the plan viewer:
 *
 *   Given her ready own plan     the viewer shows it section by section (PlanSections), read from the stored JSON
 *   When one section was changed that card says Changed with Before / After
 *   Given the cards cannot load  the single "Change this plan" entry stays, so she can still change it
 */

vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';
import { fetchSections } from './api';
import { OwnSections } from './OwnSections';
import type { ChangeAt } from './change';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const AT: ChangeAt = { own: 'own-1', band: 'k5', left: 1, grade: 3, subject: 'math', lesson: 'g3_d4' };
const show = () => render(<MemoryRouter><OwnSections at={AT} /></MemoryRouter>);

beforeEach(() => { cleanup(); http.get.mockReset(); });

describe('fetchSections — GET /lp612/own/:id/sections', () => {
  it('reads her cards, dropping anything that is not a section of her band', async () => {
    http.get.mockResolvedValue({ data: { success: true, band: 'k5', changed: 'we_do', sections: [
      { part: 'we_do', text: 'Game', before: 'Count' }, { part: 'whole', text: 'x' }, { part: 'hook' },
    ] } });
    expect(await fetchSections('own 1', 'k5')).toEqual({ changed: 'we_do', sections: [{ part: 'we_do', text: 'Game', before: 'Count' }] });
    expect(http.get).toHaveBeenCalledWith('/lp612/own/own%201/sections');
  });
  it('a failure or no cards is null', async () => {
    http.get.mockRejectedValueOnce(new Error('down'));
    expect(await fetchSections('own-1', 'k5')).toBeNull();
    http.get.mockResolvedValueOnce({ data: { success: true, sections: [] } });
    expect(await fetchSections('own-1', 'k5')).toBeNull();
  });
});

describe('OwnSections on the viewer', () => {
  it('shows her plan as section cards, the changed one marked', async () => {
    http.get.mockResolvedValue({ data: { success: true, band: 'k5', changed: 'we_do', sections: [
      { part: 'hook', text: 'Sing' }, { part: 'we_do', text: 'Game', before: 'Count' },
    ] } });
    show();
    await waitFor(() => expect(screen.getByTestId('own-sec-we_do')).toBeTruthy());
    expect(screen.getByTestId('own-sec-hook')).toBeTruthy();
    expect(screen.getByTestId('own-grr')).toBeTruthy();
    expect(screen.queryByTestId('own-change-entry')).toBeNull();
  });
  it('keeps the one Change this plan entry while loading or when the cards cannot load', async () => {
    http.get.mockRejectedValue(new Error('down'));
    show();
    expect(screen.getByTestId('own-change-entry')).toBeTruthy();
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    expect(screen.getByTestId('own-change-entry')).toBeTruthy();
    expect(screen.queryByTestId('own-sec-hook')).toBeNull();
  });
});
