import type { DayStats, StatsData } from '../shared/types';
import { dayKey } from './schedule';

export const emptyDay = (): DayStats => ({
  sittingMs: 0,
  standingMs: 0,
  movementMs: 0,
  confirmedSwitches: 0,
  movementBreaksConfirmed: 0,
  remindersShown: 0,
  snoozed: 0,
  skipped: 0,
  ignored: 0,
  deskMovesSucceeded: 0,
  deskMovesFailed: 0,
});

const KEEP_DAYS = 90;

/**
 * Tagesstatistik. Zeiten sind Schätzungen: Zeit seit einem bestätigten Wechsel,
 * ohne Pausen. Die App misst keine Körperhaltung.
 */
export class Stats {
  private data: StatsData;
  enabled = true;

  constructor(initial?: unknown, private onChange: () => void = () => {}) {
    this.data = normalizeStats(initial);
  }

  private day(wallMs: number): DayStats {
    const key = dayKey(wallMs);
    return (this.data.days[key] ??= emptyDay());
  }

  add(wallMs: number, field: keyof DayStats, amount = 1) {
    if (!this.enabled || amount <= 0) return;
    this.day(wallMs)[field] += amount;
    this.prune(wallMs);
    this.onChange();
  }

  today(wallMs: number): DayStats {
    return { ...emptyDay(), ...this.data.days[dayKey(wallMs)] };
  }

  export(): StatsData {
    return JSON.parse(JSON.stringify(this.data));
  }

  clear() {
    this.data = { version: 1, days: {} };
    this.onChange();
  }

  private prune(wallMs: number) {
    const cutoff = dayKey(wallMs - KEEP_DAYS * 86_400_000);
    for (const key of Object.keys(this.data.days)) if (key < cutoff) delete this.data.days[key];
  }
}

export function normalizeStats(input: unknown): StatsData {
  const out: StatsData = { version: 1, days: {} };
  const days = (input as any)?.days;
  if (days && typeof days === 'object') {
    for (const [key, value] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
      const day = emptyDay();
      for (const f of Object.keys(day) as (keyof DayStats)[]) {
        const n = Number((value as any)[f]);
        if (Number.isFinite(n) && n >= 0) day[f] = n;
      }
      out.days[key] = day;
    }
  }
  return out;
}
