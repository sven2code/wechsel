import type { ConnectionState, DeskCapabilities, SimulatorSettings } from '../../shared/types';
import type { Clock, TimerHandle, Timers } from '../clock';
import { UnsupportedError, type AdapterEvent, type DeskAdapter } from './adapter';

const TICK_MS = 100;

/**
 * Simulierter Tisch – rein im Speicher. Erzeugt keinerlei Funk-, USB- oder
 * Netzwerkausgabe. Dient zum Vorführen von Normalbetrieb und Fehlerfällen.
 */
export class SimulatedDesk implements DeskAdapter {
  readonly kind = 'simulator' as const;
  readonly label = 'Simulator';

  private conn: ConnectionState = 'disconnected';
  private connError: string | null = null;
  private pos: number;
  private motion: { dir: 1 | -1; target: number | null; startMono: number; startPos: number; byApp: boolean } | null = null;
  private tickHandle: TimerHandle | null = null;
  private disconnectArmed = false;
  private listeners = new Set<(e: AdapterEvent) => void>();

  constructor(
    private cfg: SimulatorSettings,
    private clock: Clock,
    private timers: Timers,
    startMm = 740,
  ) {
    this.pos = Math.min(cfg.maxMm, Math.max(cfg.minMm, startMm));
  }

  capabilities(): DeskCapabilities {
    const p = this.cfg.profile;
    return {
      positionFeedback: p !== 'noTelemetry',
      limits: p !== 'noTelemetry',
      targetMove: p !== 'holdOnly',
      stop: p !== 'noStop',
      holdToMove: true,
    };
  }
  connection() {
    return this.conn;
  }
  connectionError() {
    return this.connError;
  }
  limits() {
    return this.capabilities().limits ? { minMm: this.cfg.minMm, maxMm: this.cfg.maxMm } : null;
  }
  position() {
    return this.capabilities().positionFeedback && this.conn === 'connected' ? Math.round(this.pos) : null;
  }
  isMoving() {
    return this.capabilities().positionFeedback ? this.motion !== null : null;
  }
  expectedSpeedMmPerS() {
    return this.cfg.speedMmPerS;
  }
  /** Nur für Tests/Anzeige: tatsächliche simulierte Höhe, auch ohne Telemetrie. */
  truePositionForTests() {
    return this.pos;
  }

  async connect() {
    if (this.conn === 'connected') return;
    this.setConn('connecting', null);
    await this.delay(300);
    if (this.cfg.failure === 'connectFails') {
      this.setConn('error', 'Simulierter Fehler: Verbindung fehlgeschlagen.');
      throw new Error('Simulierter Fehler: Verbindung fehlgeschlagen.');
    }
    this.setConn('connected', null);
    this.emitPosition();
  }

  async disconnect() {
    this.halt();
    this.setConn('disconnected', null);
  }

  async moveTo(targetMm: number) {
    if (!this.capabilities().targetMove) throw new UnsupportedError('Zielfahrt');
    this.requireConnected();
    if (targetMm < this.cfg.minMm || targetMm > this.cfg.maxMm) throw new Error('Zielhöhe außerhalb des Gerätebereichs.');
    if (Math.abs(targetMm - this.pos) < 1) return;
    this.begin(targetMm > this.pos ? 1 : -1, targetMm, true);
  }

  async startHold(direction: 'up' | 'down') {
    this.requireConnected();
    this.begin(direction === 'up' ? 1 : -1, null, true);
  }

  async endHold() {
    if (this.motion && this.motion.target === null) this.halt();
  }

  async stop() {
    if (!this.capabilities().stop) throw new UnsupportedError('Stopp');
    if (this.cfg.failure === 'stopIgnored' && this.motion) {
      throw new Error('Simulierter Fehler: Stopp wurde vom Tisch nicht bestätigt.');
    }
    this.halt();
  }

  /** Simuliert eine Fahrt über das Bedienteil am Tisch (nicht durch die App). */
  simulateHandsetMove(targetMm: number) {
    if (this.motion) return;
    const t = Math.min(this.cfg.maxMm, Math.max(this.cfg.minMm, targetMm));
    this.begin(t > this.pos ? 1 : -1, t, false);
  }

  onChange(fn: (e: AdapterEvent) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  dispose() {
    this.halt();
    this.listeners.clear();
  }

  // ---------- intern ----------

  private begin(dir: 1 | -1, target: number | null, byApp: boolean) {
    this.halt();
    this.motion = { dir, target, startMono: this.clock.mono(), startPos: this.pos, byApp };
    this.disconnectArmed = byApp && this.cfg.failure === 'disconnectDuringMove';
    this.emitPosition();
    this.schedule();
  }

  private schedule() {
    this.tickHandle = this.timers.after(TICK_MS, () => this.tick());
  }

  private tick() {
    this.tickHandle = null;
    const m = this.motion;
    if (!m) return;
    const stalled = m.byApp && this.cfg.failure === 'stall';
    const elapsedS = (this.clock.mono() - m.startMono) / 1000;
    if (!stalled) {
      let next = m.startPos + m.dir * this.cfg.speedMmPerS * elapsedS;
      const end = m.target ?? (m.dir > 0 ? this.cfg.maxMm : this.cfg.minMm);
      next = m.dir > 0 ? Math.min(next, end) : Math.max(next, end);
      this.pos = next;
      if (next === end) {
        this.motion = null;
        this.emitPosition();
        return;
      }
    }
    if (this.disconnectArmed && elapsedS > 1.5) {
      // Simuliertes Verhalten bei Funkverlust: der Simulator hält an.
      // Wie sich ein echter Tisch verhält, muss an echter Hardware geprüft werden.
      this.disconnectArmed = false;
      this.motion = null;
      this.setConn('error', 'Simulierter Fehler: Verbindung während der Fahrt verloren.');
      return;
    }
    this.emitPosition();
    this.schedule();
  }

  private halt() {
    this.tickHandle?.cancel();
    this.tickHandle = null;
    if (this.motion) {
      this.motion = null;
      this.emitPosition();
    }
  }

  private requireConnected() {
    if (this.conn !== 'connected') throw new Error('Tisch ist nicht verbunden.');
  }

  private setConn(state: ConnectionState, error: string | null) {
    this.conn = state;
    this.connError = error;
    this.emit({ type: 'connection', state });
  }

  private emitPosition() {
    this.emit({ type: 'position', mm: this.position(), moving: this.isMoving() });
  }

  private emit(e: AdapterEvent) {
    for (const l of this.listeners) l(e);
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => this.timers.after(ms, resolve));
  }
}
