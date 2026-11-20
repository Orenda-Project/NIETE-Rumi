import { TEACHER_BASE } from '../paths';

/** My journey, one tap from Home's "My journey" row; `?step=taught` is Home's Taught in class tile (spec §3, §4). */
export const JOURNEY_PATH = `${TEACHER_BASE}/journey`;
export const journeyTaughtPath = () => `${JOURNEY_PATH}?step=taught`;
