import type { Settings } from '../shared/types';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Liegt der Zeitpunkt (lokale Zeit) innerhalb der eingestellten Arbeitszeit? */
export function isWithinWorkingHours(wallMs: number, schedule: Settings['schedule']): boolean {
  if (!schedule.enabled) return true;
  const d = new Date(wallMs);
  if (!schedule.days.includes(d.getDay())) return false;
  const now = d.getHours() * 60 + d.getMinutes();
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  if (start === end) return true;
  // Über Mitternacht (z. B. 22:00–06:00) zulassen.
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export const dayKey = (wallMs: number) => {
  const d = new Date(wallMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
