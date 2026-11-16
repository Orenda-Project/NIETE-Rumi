import type { OwnCopy } from './copy';
import type { Purpose, Resource, Way } from './rules';

/**
 * the same answer codes, named for the band (pure): "Children" or "Students in class", the subject
 * classroom's resource names at 6–12, and Grade 8's exam practice named for the FDE centralised annual exam (Amena,
 * 10 Nov), where 9–12 practise for the board.
 */
export function bandWords(C: OwnCopy, grade: number) {
  const secondary = grade >= 6;
  const fde = grade === 8;
  return {
    size: secondary ? C.sizeSecondary : C.size,
    resource: (k: Resource) => (secondary ? C.resourceNames612 : C.resourceNames)[k],
    objectsHint: secondary ? C.objectsHint612 : C.objectsHint,
    purpose: (k: Purpose) => (fde && k === 'board' ? C.purposeBoardFde : C.purposes[k]),
    way: (k: Way) => C.ways[k],
  };
}
