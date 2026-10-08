import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import type { AttendanceClass, Student } from './model';

/**
 * bd-fmf24g.7 — what the teacher v2 Attendance reads and writes: /api/portal/teacher/attendance/…
 * (dashboard/routes/portal-teacher-attendance.routes.js). The rules — who is in a class, the 90-day
 * window, re-mark replaces, the register — are the bot's; nothing here holds a count of its own.
 */

const BASE = '/teacher/attendance/classes';
const enc = encodeURIComponent;

export type ClassesData = { date: string; classes: AttendanceClass[] };
export type RosterData = { listId: string; label: string; students: Student[] };
export type DayData = {
  date: string; marked: boolean; present: number | null; absent: number | null; leave: number | null;
  statuses: Record<string, string>;
};
export type MonthData = {
  month: string;
  days: { date: string; present: number; absent: number; leave: number; total: number }[];
  students: { id: string; name: string; roll: number | null; present: number; marked: number; pct: number | null }[];
};
export type MarkResult = { date: string; present: number; absent: number; leave: number; replaced: boolean };

export async function getClasses(date?: string): Promise<ClassesData> {
  const { data } = await api.get(BASE, { params: date ? { date } : {} });
  return { date: data.date, classes: data.classes || [] };
}

export async function getRoster(listId: string): Promise<RosterData> {
  const { data } = await api.get(`${BASE}/${enc(listId)}/roster`);
  return { listId: data.listId, label: data.label, students: data.students || [] };
}

export async function getDay(listId: string, date: string): Promise<DayData> {
  const { data } = await api.get(`${BASE}/${enc(listId)}/day`, { params: { date } });
  return data;
}

export async function getMonth(listId: string, month: string): Promise<MonthData> {
  const { data } = await api.get(`${BASE}/${enc(listId)}/month`, { params: { month } });
  return { month: data.month, days: data.days || [], students: data.students || [] };
}

export async function postMark(listId: string, body: { date: string; absentIds: string[]; leaveIds: string[] }): Promise<MarkResult> {
  const { data } = await api.post(`${BASE}/${enc(listId)}/mark`, body);
  return data;
}

/** The month's register, saved by the browser (web). Never throws: true when the file was handed over. */
export async function saveRegister(listId: string, month: string): Promise<boolean> {
  try {
    const res = await api.get(`${BASE}/${enc(listId)}/register`, { params: { month }, responseType: 'blob' });
    const disposition = String(res.headers?.['content-disposition'] || '');
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const name = star ? decodeURIComponent(star[1]) : 'Attendance register.xlsx';
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    return true;
  } catch {
    return false;
  }
}

/** The month's register to her WhatsApp — the bot's existing delivery. Never throws. */
export async function sendRegister(listId: string, month: string): Promise<boolean> {
  try {
    const { data } = await api.post(`${BASE}/${enc(listId)}/register/send`, { month });
    return data?.delivered === true;
  } catch {
    return false;
  }
}

/** A read with loading / error / reload, re-run when `key` changes (null = nothing to read yet). */
export function useRead<T>(key: string | null, read: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: boolean }>({ data: null, loading: !!key, error: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!key) { setState({ data: null, loading: false, error: false }); return undefined; }
    let live = true;
    setState((s) => ({ data: s.data, loading: true, error: false }));
    read().then(
      (data) => { if (live) setState({ data, loading: false, error: false }); },
      () => { if (live) setState({ data: null, loading: false, error: true }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { ...state, reload };
}
