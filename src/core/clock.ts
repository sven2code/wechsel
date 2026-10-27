/**
 * Zeitquellen. Dauern werden ausschließlich über die monotone Uhr gemessen,
 * damit Änderungen der Systemzeit keine Phasen verlängern oder verkürzen.
 * Die Wanduhr dient nur für Arbeitszeiten, Wochentage und Tagesstatistik.
 */
export interface Clock {
  /** Monotone Millisekunden (springt nie zurück). */
  mono(): number;
  /** Wanduhr in Millisekunden seit Epoch (kann springen). */
  wall(): number;
}

export type TimerHandle = { cancel(): void };

export interface Timers {
  /** Einmaliger Weckruf. Ausgelöste Funktionen müssen den Zustand aus der Uhr neu berechnen. */
  after(ms: number, fn: () => void): TimerHandle;
}

export const systemClock: Clock = {
  mono: () => performance.now(),
  wall: () => Date.now(),
};

export const systemTimers: Timers = {
  after(ms, fn) {
    const h = setTimeout(fn, Math.max(0, ms));
    return { cancel: () => clearTimeout(h) };
  },
};

/** Kontrollierbare Uhr für Tests. */
export class FakeClock implements Clock, Timers {
  private monoMs = 0;
  private wallMs: number;
  private seq = 0;
  private queue: { at: number; seq: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(wallStart: Date | number = new Date(2026, 9, 26, 9, 0, 0)) {
    this.wallMs = typeof wallStart === 'number' ? wallStart : wallStart.getTime();
  }

  mono() {
    return this.monoMs;
  }
  wall() {
    return this.wallMs;
  }

  after(ms: number, fn: () => void): TimerHandle {
    const entry = { at: this.monoMs + Math.max(0, ms), seq: this.seq++, fn, cancelled: false };
    this.queue.push(entry);
    return { cancel: () => void (entry.cancelled = true) };
  }

  /** Lässt Zeit vergehen (beide Uhren) und löst fällige Timer in Reihenfolge aus. */
  advance(ms: number) {
    const end = this.monoMs + ms;
    for (;;) {
      const next = this.queue
        .filter((e) => !e.cancelled && e.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      next.cancelled = true;
      this.wallMs += next.at - this.monoMs;
      this.monoMs = next.at;
      next.fn();
    }
    this.wallMs += end - this.monoMs;
    this.monoMs = end;
    this.queue = this.queue.filter((e) => !e.cancelled);
  }

  advanceMinutes(min: number) {
    this.advance(min * 60_000);
  }

  /** Simuliert eine Systemzeitänderung: nur die Wanduhr springt. */
  jumpWall(ms: number) {
    this.wallMs += ms;
  }

  /** Simuliert Ruhezustand: Wanduhr läuft weiter, monotone Uhr (macOS) nicht. */
  sleep(ms: number) {
    this.wallMs += ms;
  }

  pendingTimers() {
    return this.queue.filter((e) => !e.cancelled).length;
  }
}
