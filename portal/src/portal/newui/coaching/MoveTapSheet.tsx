import { useCopy } from '../../teacher/i18n';
import { Sheet } from '../Sheet';
import { BottomButton } from '../BottomButton';
import { LIVE_COPY } from './liveCopy';

/**
 * bd-v0toag.31 — her answer on one move. A ticked move: "Yes, I did this" / "No, I didn't".
 * A move still to come: "I did this". Her tap never changes the tick or the Finish check.
 */
export function MoveTapSheet({ ticked, onChoose, onClose }: {
  ticked: boolean;
  onChoose: (choice: 'did' | 'did_not') => void;
  onClose: () => void;
}) {
  const L = useCopy(LIVE_COPY);
  return (
    <Sheet open title={L.sheetTitle} onClose={onClose} testId="live-move-sheet">
      <div className="flex flex-col gap-2">
        <BottomButton onClick={() => onChoose('did')}>{ticked ? L.yesDid : L.iDid}</BottomButton>
        {ticked ? <BottomButton tone="outline" onClick={() => onChoose('did_not')}>{L.noDidnt}</BottomButton> : null}
      </div>
    </Sheet>
  );
}
