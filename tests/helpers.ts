import { FakeClock } from '../src/core/clock';
import { AppController, type PlatformHooks } from '../src/core/controller';
import { mergeSettings, type DeepPartial } from '../src/core/settings';
import { DEFAULT_SETTINGS, type ReminderView, type Settings } from '../src/shared/types';

export const MIN = 60_000;

export const flush = () => new Promise<void>((r) => setImmediate(r));

/** Uhr vorstellen und dabei Promise-Ketten (Adapter-Verzögerungen) abarbeiten. */
export async function run(clock: FakeClock, ms: number, step = 100) {
  for (let t = 0; t < ms; t += step) {
    clock.advance(Math.min(step, ms - t));
    await flush();
  }
}

export function makeApp(patch: DeepPartial<Settings> = {}, start = new Date(2026, 9, 26, 9, 0, 0)) {
  const clock = new FakeClock(start);
  const shown: { view: ReminderView; native: boolean }[] = [];
  const cleared: string[] = [];
  const logs: string[] = [];
  let opened = 0;
  const hooks: PlatformHooks = {
    showReminder: (view, opts) => shown.push({ view, native: opts.native }),
    clearReminder: (id) => cleared.push(id),
    openApp: () => void opened++,
    changed: () => {},
    persistSettings: () => {},
    persistStats: () => {},
    applySystemSettings: () => {},
    log: (m) => logs.push(m),
    notificationStatus: () => ({ status: 'ok', detail: null }),
    platform: 'test',
    packaged: false,
  };
  const settings = mergeSettings(DEFAULT_SETTINGS, patch);
  const app = new AppController(clock, clock, settings, undefined, hooks);
  app.start();
  return { app, clock, shown, cleared, logs, opened: () => opened };
}

export const SIM_READY: DeepPartial<Settings> = {
  desk: { mode: 'simulator', sitMm: 740, standMm: 1100, safetyAcknowledged: true },
};
