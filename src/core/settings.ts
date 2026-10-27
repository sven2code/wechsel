import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

// Plausible Grenzen für Eingaben. Stehphasen dürfen bewusst sehr kurz sein.
export const LIMITS = {
  sitMinutes: [5, 240],
  standMinutes: [1, 120],
  snoozeMinutes: [1, 60],
  movementIntervalMinutes: [15, 240],
  movementDurationMinutes: [1, 15],
  movementSnoozeMinutes: [1, 60],
  reminderTimeoutMinutes: [1, 60],
  idleThresholdMinutes: [1, 60],
  speedMmPerS: [5, 200],
  heightMm: [400, 1600],
} as const;

const clampInt = (v: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const optHeight = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= LIMITS.heightMm[0] && r <= LIMITS.heightMm[1] ? r : null;
};

/** Bringt beliebige (auch beschädigte oder alte) Daten in eine gültige Settings-Form. */
export function normalizeSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const i = (input && typeof input === 'object' ? input : {}) as Partial<Settings> & Record<string, any>;
  const r = (i.routine ?? {}) as Partial<Settings['routine']>;
  const s = (i.schedule ?? {}) as Partial<Settings['schedule']>;
  const k = (i.desk ?? {}) as Partial<Settings['desk']>;
  const sim = (k.simulator ?? {}) as Partial<Settings['desk']['simulator']>;

  const simMin = optHeight(sim.minMm) ?? d.desk.simulator.minMm;
  const simMax = optHeight(sim.maxMm) ?? d.desk.simulator.maxMm;

  return {
    version: 1,
    routine: {
      sitMinutes: clampInt(r.sitMinutes, LIMITS.sitMinutes, d.routine.sitMinutes),
      standMinutes: clampInt(r.standMinutes, LIMITS.standMinutes, d.routine.standMinutes),
      snoozeMinutes: clampInt(r.snoozeMinutes, LIMITS.snoozeMinutes, d.routine.snoozeMinutes),
      movementEnabled: typeof r.movementEnabled === 'boolean' ? r.movementEnabled : d.routine.movementEnabled,
      movementIntervalMinutes: clampInt(r.movementIntervalMinutes, LIMITS.movementIntervalMinutes, d.routine.movementIntervalMinutes),
      movementDurationMinutes: clampInt(r.movementDurationMinutes, LIMITS.movementDurationMinutes, d.routine.movementDurationMinutes),
      movementSnoozeMinutes: clampInt(r.movementSnoozeMinutes, LIMITS.movementSnoozeMinutes, d.routine.movementSnoozeMinutes),
      reminderTimeoutMinutes: clampInt(r.reminderTimeoutMinutes, LIMITS.reminderTimeoutMinutes, d.routine.reminderTimeoutMinutes),
      idleThresholdMinutes: clampInt(r.idleThresholdMinutes, LIMITS.idleThresholdMinutes, d.routine.idleThresholdMinutes),
    },
    schedule: {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.schedule.enabled,
      days: Array.isArray(s.days)
        ? [...new Set(s.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
        : [...d.schedule.days],
      start: isTime(s.start) ? s.start : d.schedule.start,
      end: isTime(s.end) ? s.end : d.schedule.end,
    },
    desk: {
      mode: k.mode === 'simulator' ? 'simulator' : 'manual',
      sitMm: optHeight(k.sitMm),
      standMm: optHeight(k.standMm),
      personalMinMm: optHeight(k.personalMinMm),
      personalMaxMm: optHeight(k.personalMaxMm),
      safetyAcknowledged: k.safetyAcknowledged === true,
      simulator: {
        speedMmPerS: clampInt(sim.speedMmPerS, LIMITS.speedMmPerS, d.desk.simulator.speedMmPerS),
        profile: (['full', 'holdOnly', 'noTelemetry', 'noStop'] as const).includes(sim.profile as any)
          ? (sim.profile as Settings['desk']['simulator']['profile'])
          : d.desk.simulator.profile,
        failure: (['none', 'connectFails', 'disconnectDuringMove', 'stall', 'stopIgnored'] as const).includes(sim.failure as any)
          ? (sim.failure as Settings['desk']['simulator']['failure'])
          : d.desk.simulator.failure,
        minMm: Math.min(simMin, simMax - 100),
        maxMm: Math.max(simMax, simMin + 100),
      },
    },
    notifications: {
      style: (['native', 'window', 'both'] as const).includes(i.notifications?.style as any)
        ? (i.notifications!.style as Settings['notifications']['style'])
        : d.notifications.style,
    },
    appearance: {
      theme: (['system', 'light', 'dark'] as const).includes(i.appearance?.theme as any)
        ? (i.appearance!.theme as Settings['appearance']['theme'])
        : d.appearance.theme,
    },
    autostart: i.autostart === true,
    statsEnabled: typeof i.statsEnabled === 'boolean' ? i.statsEnabled : d.statsEnabled,
  };
}

/** Teil-Update tief zusammenführen und anschließend normalisieren. */
export function mergeSettings(current: Settings, patch: DeepPartial<Settings>): Settings {
  return normalizeSettings(deepMerge(current, patch));
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function deepMerge(a: any, b: any): any {
  if (b === undefined) return a;
  if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
  const out: any = { ...(a ?? {}) };
  for (const key of Object.keys(b)) out[key] = deepMerge(a?.[key], b[key]);
  return out;
}

export interface HeightCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * Prüft gespeicherte Sitz-/Stehhöhen gegen Gerätegrenzen und persönliche Grenzen.
 * Es wird nie eine Höhe berechnet – nur übernommen, was der Nutzer eingestellt hat.
 */
export function checkHeights(desk: Settings['desk'], deviceLimits: { minMm: number; maxMm: number } | null): HeightCheck {
  const reasons: string[] = [];
  const { sitMm, standMm, personalMinMm, personalMaxMm } = desk;
  if (sitMm === null) reasons.push('Sitzhöhe ist noch nicht eingestellt.');
  if (standMm === null) reasons.push('Stehhöhe ist noch nicht eingestellt.');
  if (sitMm !== null && standMm !== null && standMm - sitMm < 100) {
    reasons.push('Stehhöhe muss mindestens 10 cm über der Sitzhöhe liegen.');
  }
  if (personalMinMm !== null && personalMaxMm !== null && personalMinMm >= personalMaxMm) {
    reasons.push('Persönliche Mindesthöhe muss unter der Höchsthöhe liegen.');
  }
  for (const [name, v] of [['Sitzhöhe', sitMm], ['Stehhöhe', standMm]] as const) {
    if (v === null) continue;
    if (deviceLimits && (v < deviceLimits.minMm || v > deviceLimits.maxMm)) {
      reasons.push(`${name} liegt außerhalb des Gerätebereichs (${fmtCm(deviceLimits.minMm)}–${fmtCm(deviceLimits.maxMm)}).`);
    }
    if (personalMinMm !== null && v < personalMinMm) reasons.push(`${name} liegt unter deiner erlaubten Mindesthöhe.`);
    if (personalMaxMm !== null && v > personalMaxMm) reasons.push(`${name} liegt über deiner erlaubten Höchsthöhe.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export const fmtCm = (mm: number) => `${(mm / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 })} cm`;
