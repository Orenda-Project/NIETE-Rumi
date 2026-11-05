import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuestionForm } from './QuestionForm';
import { blankValues, type FormValues } from './editForm';
import { ASSESSMENT_V2_COPY as C } from './copy';

/**
 * bd-cj8ggk.2 — field report: "Match the Column allows only two pairs in some subjects". A new Match question started
 * with two pairs and had no way to add one, though the server takes any number. The form now offers "Add pair" up to
 * the slot cap (6, the server's SLOT_CAP), the same cap as comprehension parts.
 */
const KIND = { kind: 'match', label: 'Match the Column', layout: 'columns' as const, section: 'objective' as const, marks: 1, lines: 1 };

function Harness({ slotCap }: { slotCap?: number }) {
  const [v, setV] = useState<FormValues>(blankValues(KIND));
  return <QuestionForm kind={KIND} values={v} onChange={setV} rtl={false} slotCap={slotCap} />;
}

const pairCount = () => screen.queryAllByLabelText(/^Pair \d+ A$/).length;

describe('Match the Column: add a pair', () => {
  it('a new Match question can grow past two pairs, up to six', () => {
    render(<Harness />);
    expect(pairCount()).toBe(2);
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: C.addPair }));
    expect(pairCount()).toBe(6);
    expect(screen.queryByRole('button', { name: C.addPair })).toBeNull();
  });

  it('the cap follows slotCap', () => {
    render(<Harness slotCap={3} />);
    fireEvent.click(screen.getByRole('button', { name: C.addPair }));
    expect(pairCount()).toBe(3);
    expect(screen.queryByRole('button', { name: C.addPair })).toBeNull();
  });
});
