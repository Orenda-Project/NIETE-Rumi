import { createContext } from 'react';

/**
 * bd-5rz1v.14 — is the recording bar on screen above the phone menu right now? PortalLayout
 * decides (a session is live and this is not its own page) and says so here, so a page's fixed
 * bottom action (newui BottomActions) can stand above the bar instead of under it. False outside
 * a layout. Its own module: the kit reads it without loading the recorder.
 */
export const RecordingBarShownContext = createContext(false);
