import type { AppSnapshot, Phase } from '../shared/types';

export const phaseLabel: Record<Phase, string> = {
  sitting: 'Sitzen',
  standing: 'Stehen',
  movement: 'Bewegungspause',
  unknown: 'Unbekannt',
};

export const holdLabel: Record<NonNullable<AppSnapshot['hold']>, string> = {
  user: 'Routine pausiert',
  idle: 'Angehalten – keine Eingabe erkannt',
  suspend: 'Angehalten – Ruhezustand',
  lock: 'Angehalten – Bildschirm gesperrt',
};

export function fmtClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const fmtTime = (wall: number) => new Date(wall).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export const fmtCm = (mm: number | null) =>
  mm === null ? 'unbekannt' : `${(mm / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;

export const nextLabel: Record<string, string> = {
  toStand: 'Vorschlag: Stehen',
  toSit: 'Vorschlag: Sitzen',
  movementBreak: 'Bewegungspause',
  movementOver: 'Ende der Bewegungspause',
};
