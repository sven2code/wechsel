import { describe, expect, it } from 'vitest';
import { checkHeights, mergeSettings, normalizeSettings } from '../src/core/settings';
import { DEFAULT_SETTINGS } from '../src/shared/types';

describe('Einstellungen', () => {
  it('beschädigte Daten ergeben gültige Standardwerte', () => {
    const s = normalizeSettings({ routine: { sitMinutes: 'abc', standMinutes: -4 }, schedule: { start: '25:00', days: [9, 1, 1] } });
    expect(s.routine.sitMinutes).toBe(30);
    expect(s.routine.standMinutes).toBe(1);
    expect(s.schedule.start).toBe('08:00');
    expect(s.schedule.days).toEqual([1]);
    expect(s.desk.mode).toBe('manual');
    expect(s.desk.safetyAcknowledged).toBe(false);
  });

  it('keine Zielhöhe ohne explizite Eingabe; unplausible Höhen werden verworfen', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { desk: { sitMm: 50, standMm: 5000 } });
    expect(s.desk.sitMm).toBeNull();
    expect(s.desk.standMm).toBeNull();
    expect(checkHeights(s.desk, null).ok).toBe(false);
  });

  it('prüft Gerätegrenzen und persönliche Grenzen', () => {
    const desk = { ...DEFAULT_SETTINGS.desk, sitMm: 700, standMm: 1150, personalMaxMm: 1120 };
    const r = checkHeights(desk, { minMm: 720, maxMm: 1200 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/Sitzhöhe liegt außerhalb/);
    expect(r.reasons.join(' ')).toMatch(/Höchsthöhe/);
    expect(checkHeights({ ...desk, sitMm: 740, personalMaxMm: null }, { minMm: 720, maxMm: 1200 }).ok).toBe(true);
  });
});
