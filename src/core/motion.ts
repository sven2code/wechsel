import type { MotionView, PostureTarget, Settings } from '../shared/types';
import type { Clock, TimerHandle, Timers } from './clock';
import type { AdapterEvent, DeskAdapter } from './device/adapter';
import { checkHeights } from './settings';

export const COUNTDOWN_SECONDS = 5;
const ARRIVAL_TOLERANCE_MM = 10;
const HOLD_WATCHDOG_MS = 600;
const HOLD_MAX_MS = 30_000;
const STOP_GRACE_MS = 1_500;

type State =
  | { kind: 'idle' }
  | { kind: 'countdown'; id: number; target: PostureTarget; targetMm: number; endsMono: number; endsWall: number; stillValid: () => boolean }
  | { kind: 'moving'; id: number; target: PostureTarget | null; targetMm: number | null; mode: 'target' | 'hold'; startedMono: number; sawMoving: boolean }
  | { kind: 'error'; message: string };

export type MotionEvent =
  | { type: 'changed' }
  | { type: 'arrived'; target: PostureTarget }
  | { type: 'failed'; message: string }
  | { type: 'cancelled' }
  | { type: 'log'; message: string };

export type RequestResult = { ok: true } | { ok: false; reason: string };

/**
 * Steuert Tischfahrten. Sicherheitsregeln:
 * - höchstens ein Fahrbefehl gleichzeitig, Mehrfachklicks erzeugen keine zweite Fahrt;
 * - jede Fahrt braucht einen frischen Auftrag und durchläuft einen abbrechbaren Countdown;
 * - vor Fahrtbeginn werden Verbindung, Zielhöhe und Gültigkeit erneut geprüft;
 * - keine Wiederholung, kein Weiterfahren nach Wiederverbindung, keine gespeicherten Befehle;
 * - ohne bestätigte Positionsrückmeldung wird keine Ankunft behauptet.
 */
export class MotionController {
  private state: State = { kind: 'idle' };
  private seq = 0;
  private timer: TimerHandle | null = null;
  private watchdog: TimerHandle | null = null;
  private holdLimit: TimerHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(e: MotionEvent) => void>();

  constructor(
    private clock: Clock,
    private timers: Timers,
    private getSettings: () => Settings,
    private adapter: DeskAdapter | null,
  ) {
    this.attach(adapter);
  }

  on(fn: (e: MotionEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Adapter wechseln (z. B. Manuell ↔ Simulator). Laufende Vorgänge werden verworfen. */
  setAdapter(adapter: DeskAdapter | null) {
    this.invalidate('Tischmodus geändert');
    this.attach(adapter);
  }

  get busy() {
    return this.state.kind === 'countdown' || this.state.kind === 'moving';
  }

  view(): MotionView {
    const s = this.state;
    switch (s.kind) {
      case 'idle':
        return { kind: 'idle' };
      case 'countdown':
        return {
          kind: 'countdown',
          target: s.target,
          targetMm: s.targetMm,
          endsAtWall: s.endsWall,
          secondsLeft: Math.max(0, Math.ceil((s.endsMono - this.clock.mono()) / 1000)),
        };
      case 'moving':
        return { kind: 'moving', target: s.target, targetMm: s.targetMm, mode: s.mode };
      case 'error':
        return { kind: 'error', message: s.message };
    }
  }

  /** Voraussetzungen für automatische Zielfahrten. */
  targetReadiness(): { ok: boolean; reasons: string[] } {
    const a = this.adapter;
    const reasons: string[] = [];
    if (!a) return { ok: false, reasons: ['Kein Tisch angebunden (manueller Modus).'] };
    const caps = a.capabilities();
    if (a.connection() !== 'connected') reasons.push('Tisch ist nicht verbunden.');
    if (!caps.targetMove) reasons.push('Die Schnittstelle unterstützt keine Zielfahrt.');
    if (!caps.stop) reasons.push('Zuverlässiges Stoppen ist über die Schnittstelle nicht möglich.');
    if (!caps.positionFeedback) reasons.push('Keine Positionsrückmeldung – Ankunft wäre nicht überprüfbar.');
    const settings = this.getSettings();
    if (!settings.desk.safetyAcknowledged) reasons.push('Sicherheitshinweis ist noch nicht bestätigt.');
    reasons.push(...checkHeights(settings.desk, a.limits()).reasons);
    return { ok: reasons.length === 0, reasons };
  }

  /** Voraussetzungen für Gedrückthalten-Bedienung. */
  holdReadiness(): { ok: boolean; reasons: string[] } {
    const a = this.adapter;
    const reasons: string[] = [];
    if (!a) return { ok: false, reasons: ['Kein Tisch angebunden (manueller Modus).'] };
    const caps = a.capabilities();
    if (a.connection() !== 'connected') reasons.push('Tisch ist nicht verbunden.');
    if (!caps.holdToMove) reasons.push('Die Schnittstelle unterstützt kein Gedrückthalten.');
    if (!caps.stop) reasons.push('Zuverlässiges Stoppen ist über die Schnittstelle nicht möglich.');
    if (!this.getSettings().desk.safetyAcknowledged) reasons.push('Sicherheitshinweis ist noch nicht bestätigt.');
    return { ok: reasons.length === 0, reasons };
  }

  /**
   * Fahrt anfordern. Startet nur den Countdown – die Fahrt selbst beginnt erst,
   * wenn alle Prüfungen nach Ablauf erneut bestanden sind.
   * @param stillValid wird direkt vor Fahrtbeginn geprüft (z. B. Erinnerung noch offen)
   */
  request(target: PostureTarget, stillValid: () => boolean = () => true): RequestResult {
    if (this.busy) return { ok: false, reason: 'Es läuft bereits eine Fahrt oder ein Countdown.' };
    const ready = this.targetReadiness();
    if (!ready.ok) return { ok: false, reason: ready.reasons[0] };
    const settings = this.getSettings();
    const targetMm = (target === 'stand' ? settings.desk.standMm : settings.desk.sitMm)!;
    const id = ++this.seq;
    this.state = {
      kind: 'countdown',
      id,
      target,
      targetMm,
      endsMono: this.clock.mono() + COUNTDOWN_SECONDS * 1000,
      endsWall: this.clock.wall() + COUNTDOWN_SECONDS * 1000,
      stillValid,
    };
    this.log(`Countdown gestartet (${target === 'stand' ? 'Stehhöhe' : 'Sitzhöhe'} ${targetMm} mm).`);
    this.scheduleCountdownTick(id);
    this.emit({ type: 'changed' });
    return { ok: true };
  }

  /** Countdown abbrechen bzw. laufende Fahrt stoppen. */
  async stop(): Promise<void> {
    const s = this.state;
    if (s.kind === 'countdown') {
      this.clearTimers();
      this.state = { kind: 'idle' };
      this.log('Countdown abgebrochen.');
      this.emit({ type: 'cancelled' });
      this.emit({ type: 'changed' });
      return;
    }
    if (s.kind === 'moving') {
      this.clearTimers();
      this.state = { kind: 'error', message: 'Stopp wird gesendet …' };
      this.emit({ type: 'changed' });
      const ok = await this.sendStop();
      this.state = ok
        ? { kind: 'idle' }
        : { kind: 'error', message: 'Stopp konnte nicht bestätigt werden. Bitte den Tisch am Bedienteil anhalten.' };
      this.log(ok ? 'Fahrt durch Nutzer gestoppt.' : 'Stopp nicht bestätigt.');
      this.emit({ type: 'cancelled' });
      this.emit({ type: 'changed' });
    }
  }

  /**
   * Alle offenen Fahranfragen verwerfen (Sperre, Ruhezustand, Inaktivität, Moduswechsel).
   * Eine laufende Fahrt wird – soweit unterstützt – gestoppt.
   */
  invalidate(reason: string) {
    const s = this.state;
    if (s.kind === 'countdown') {
      this.clearTimers();
      this.state = { kind: 'idle' };
      this.log(`Countdown verworfen: ${reason}.`);
      this.emit({ type: 'cancelled' });
      this.emit({ type: 'changed' });
    } else if (s.kind === 'moving') {
      this.clearTimers();
      // Zustand zuerst verlassen, damit das Anhalten nicht als eigener Fehler gemeldet wird.
      this.state = { kind: 'error', message: `Fahrt abgebrochen: ${reason}.` };
      this.emit({ type: 'changed' });
      void this.sendStop().then((ok) => {
        this.fail(
          ok
            ? `Fahrt abgebrochen: ${reason}.`
            : `Fahrt abgebrochen (${reason}), Stopp aber nicht bestätigt. Bitte den Tisch am Bedienteil prüfen.`,
        );
      });
    }
  }

  dismiss() {
    if (this.state.kind === 'error') {
      this.state = { kind: 'idle' };
      this.emit({ type: 'changed' });
    }
  }

  // ---------- Gedrückthalten ----------

  async holdStart(direction: 'up' | 'down'): Promise<RequestResult> {
    if (this.busy) return { ok: false, reason: 'Es läuft bereits eine Fahrt.' };
    const ready = this.holdReadiness();
    if (!ready.ok) return { ok: false, reason: ready.reasons[0] };
    const id = ++this.seq;
    this.state = { kind: 'moving', id, target: null, targetMm: null, mode: 'hold', startedMono: this.clock.mono(), sawMoving: false };
    this.armWatchdog(id);
    this.holdLimit = this.timers.after(HOLD_MAX_MS, () => void this.holdEnd(id));
    this.emit({ type: 'changed' });
    try {
      await this.adapter!.startHold(direction);
    } catch (e) {
      this.clearTimers();
      this.fail(`Fahrt konnte nicht gestartet werden: ${msg(e)}`);
      return { ok: false, reason: msg(e) };
    }
    return { ok: true };
  }

  /** Muss während des Gedrückthaltens regelmäßig kommen, sonst stoppt der Tisch. */
  holdHeartbeat() {
    const s = this.state;
    if (s.kind === 'moving' && s.mode === 'hold') this.armWatchdog(s.id);
  }

  async holdEnd(id?: number) {
    const s = this.state;
    if (s.kind !== 'moving' || s.mode !== 'hold' || (id !== undefined && s.id !== id)) return;
    this.clearTimers();
    try {
      await this.adapter?.endHold();
    } catch {
      /* Stopp folgt */
    }
    const ok = await this.sendStop();
    this.state = ok ? { kind: 'idle' } : { kind: 'error', message: 'Stopp konnte nicht bestätigt werden. Bitte den Tisch am Bedienteil anhalten.' };
    this.emit({ type: 'changed' });
  }

  dispose() {
    this.clearTimers();
    this.unsubscribe?.();
  }

  // ---------- intern ----------

  private attach(adapter: DeskAdapter | null) {
    this.unsubscribe?.();
    this.adapter = adapter;
    this.unsubscribe = adapter ? adapter.onChange((e) => this.onAdapter(e)) : null;
  }

  private scheduleCountdownTick(id: number) {
    const s = this.state;
    if (s.kind !== 'countdown' || s.id !== id) return;
    const left = s.endsMono - this.clock.mono();
    if (left <= 0) {
      void this.execute(id);
      return;
    }
    this.timer = this.timers.after(Math.min(1000, left), () => {
      this.timer = null;
      this.emit({ type: 'changed' });
      this.scheduleCountdownTick(id);
    });
  }

  private async execute(id: number) {
    const s = this.state;
    if (s.kind !== 'countdown' || s.id !== id) return; // verworfen oder ersetzt
    // Alles erneut prüfen – nichts aus dem Zeitpunkt des Klicks übernehmen.
    const ready = this.targetReadiness();
    const settings = this.getSettings();
    const currentTarget = s.target === 'stand' ? settings.desk.standMm : settings.desk.sitMm;
    let problem: string | null = null;
    if (!ready.ok) problem = ready.reasons[0];
    else if (currentTarget !== s.targetMm) problem = 'Zielhöhe wurde zwischenzeitlich geändert.';
    else if (!s.stillValid()) problem = 'Die Anfrage ist nicht mehr gültig.';
    if (problem) {
      this.fail(`Fahrt nicht gestartet: ${problem}`);
      return;
    }

    const adapter = this.adapter!;
    const from = adapter.position();
    const speed = adapter.expectedSpeedMmPerS() ?? 25;
    const distance = from === null ? 700 : Math.abs(s.targetMm - from);
    const timeoutMs = Math.min(90_000, Math.max(5_000, (distance / speed) * 1500 + 3_000));

    this.state = { kind: 'moving', id, target: s.target, targetMm: s.targetMm, mode: 'target', startedMono: this.clock.mono(), sawMoving: false };
    this.emit({ type: 'changed' });
    this.log(`Fahrt gestartet: ${from ?? '?'} → ${s.targetMm} mm (Timeout ${Math.round(timeoutMs / 1000)} s).`);
    this.timer = this.timers.after(timeoutMs, () => void this.onTimeout(id));
    try {
      await adapter.moveTo(s.targetMm);
    } catch (e) {
      if (this.isMoving(id)) {
        this.clearTimers();
        this.state = { kind: 'error', message: 'Fahrt konnte nicht gestartet werden – Stopp wird gesendet …' };
        await this.sendStop();
        this.fail(`Fahrt konnte nicht gestartet werden: ${msg(e)}`);
      }
      return;
    }
    this.checkArrival();
  }

  private async onTimeout(id: number) {
    if (!this.isMoving(id)) return;
    this.timer = null;
    // Zustand vor dem Stopp verlassen, damit das Anhalten nicht als zweiter Fehler zählt.
    this.state = { kind: 'error', message: 'Zeitüberschreitung – Stopp wird gesendet …' };
    const ok = await this.sendStop();
    this.fail(
      ok
        ? 'Zeitüberschreitung: Zielhöhe wurde nicht erreicht. Stopp gesendet – bitte bei Bedarf am Bedienteil fahren.'
        : 'Zeitüberschreitung, Stopp nicht bestätigt. Bitte den Tisch am Bedienteil anhalten.',
    );
  }

  private onAdapter(e: AdapterEvent) {
    const s = this.state;
    if (e.type === 'connection' && e.state !== 'connected') {
      if (s.kind === 'countdown') this.invalidate('Verbindung verloren');
      else if (s.kind === 'moving') {
        this.clearTimers();
        this.fail('Verbindung während der Fahrt verloren. Es wird nicht automatisch weitergefahren – bitte Bedienteil nutzen.');
      }
      return;
    }
    if (e.type === 'position' && s.kind === 'moving') {
      if (e.moving) s.sawMoving = true;
      this.checkArrival();
    }
    if (e.type !== 'position') this.emit({ type: 'changed' });
  }

  private checkArrival() {
    const s = this.state;
    if (s.kind !== 'moving' || s.mode !== 'target' || !this.adapter) return;
    const pos = this.adapter.position();
    const moving = this.adapter.isMoving();
    if (pos === null || moving === null) return; // ohne Rückmeldung keine Ankunft behaupten
    if (moving) return;
    if (Math.abs(pos - s.targetMm!) <= ARRIVAL_TOLERANCE_MM) {
      this.clearTimers();
      this.state = { kind: 'idle' };
      this.log(`Zielhöhe erreicht (${pos} mm).`);
      this.emit({ type: 'arrived', target: s.target! });
      this.emit({ type: 'changed' });
      return;
    }
    // Stillstand vor dem Ziel (z. B. Kollisionsschutz, Bedienteil) – nach kurzer Anlaufzeit.
    if (s.sawMoving || this.clock.mono() - s.startedMono > STOP_GRACE_MS) {
      this.clearTimers();
      this.fail(`Tisch hat bei ${pos} mm vor der Zielhöhe angehalten. Es wird nicht erneut gefahren.`);
    }
  }

  private async sendStop(): Promise<boolean> {
    if (!this.adapter || !this.adapter.capabilities().stop) return false;
    try {
      await this.adapter.stop();
      return true;
    } catch (e) {
      this.log(`Stopp fehlgeschlagen: ${msg(e)}`);
      return false;
    }
  }

  private fail(message: string) {
    this.clearTimers();
    this.state = { kind: 'error', message };
    this.log(message);
    this.emit({ type: 'failed', message });
    this.emit({ type: 'changed' });
  }

  private isMoving(id: number) {
    return this.state.kind === 'moving' && this.state.id === id;
  }

  private armWatchdog(id: number) {
    this.watchdog?.cancel();
    this.watchdog = this.timers.after(HOLD_WATCHDOG_MS, () => void this.holdEnd(id));
  }

  private clearTimers() {
    this.timer?.cancel();
    this.watchdog?.cancel();
    this.holdLimit?.cancel();
    this.timer = this.watchdog = this.holdLimit = null;
  }

  private log(message: string) {
    this.emit({ type: 'log', message });
  }

  private emit(e: MotionEvent) {
    for (const l of this.listeners) l(e);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
