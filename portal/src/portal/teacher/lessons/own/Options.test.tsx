import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RadioList, TickList } from './Options';

/**
 * bd-snkn32.19 — single looks single, multi looks multi: a radio list (one answer, ring) and a tick list (square boxes,
 * the textbook locked, "Tick all you have"). Both keep the `own-opt-<key>` handles.
 */

const items = [{ key: 'a', label: 'Apple', subtitle: 'red' }, { key: 'b', label: 'Banana' }];

describe('RadioList', () => {
  it('is a radiogroup, one row checked, the subtitle shown', () => {
    render(<RadioList label="Fruit" items={items} value="b" onPick={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Fruit' })).toBeTruthy();
    expect(screen.getByTestId('own-opt-a').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('own-opt-b').getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('red')).toBeTruthy();
  });
  it('reports the row she taps', () => {
    const onPick = vi.fn();
    render(<RadioList label="Fruit" items={items} value={null} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('own-opt-a'));
    expect(onPick).toHaveBeenCalledWith('a');
  });
  it('draws nothing with no rows', () => {
    const { container } = render(<RadioList label="Fruit" items={[]} value={null} onPick={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('TickList', () => {
  const all = [{ key: 'textbook', label: 'Textbook' }, ...items];
  it('square boxes, the locked one ticked and not untickable', () => {
    const onChange = vi.fn();
    render(<TickList label="Have" allLabel="Tick all you have" items={all} chosen={['textbook', 'a']} locked={['textbook']} onChange={onChange} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByTestId('own-opt-textbook').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('own-opt-textbook').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('own-opt-textbook'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('a tap toggles one; "Tick all you have" is only a hint, never a select-all', () => {
    const onChange = vi.fn();
    render(<TickList label="Have" allLabel="Tick all you have" items={all} chosen={['textbook', 'a']} locked={['textbook']} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('own-opt-a'));
    expect(onChange).toHaveBeenLastCalledWith(['textbook']);
    fireEvent.click(screen.getByTestId('own-opt-b'));
    expect(onChange).toHaveBeenLastCalledWith(['textbook', 'a', 'b']);
    expect(screen.queryByTestId('own-tick-all')).toBeNull();
    const hint = screen.getByText('Tick all you have');
    expect(hint.tagName).toBe('P');
    expect(hint.closest('button')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
