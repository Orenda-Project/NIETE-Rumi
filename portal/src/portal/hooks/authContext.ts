import { createContext } from 'react';
import type { User } from '../types/portal';

/**
 * bd-5rz1v.6.6 — the user PortalLayout loaded, for everything inside it. Its own
 * module, so a test that mocks hooks/useAuth still gets a real context.
 */
export type SharedAuth = {
  user: User | null;
  loading: boolean;
  [key: string]: unknown;
};

export const AuthContext = createContext<SharedAuth | null>(null);
