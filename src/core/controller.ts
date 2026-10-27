import type {
  AppSnapshot,
  PostureTarget,
  ReminderAction,
  ReminderActionId,
  ReminderView,
  Settings,
} from '../shared/types';
import type { Clock, TimerHandle, Timers } from './clock';
import type { DeskAdapter } from './device/adapter';
import { SimulatedDesk } from './device/simulator';
import { MotionController, type RequestResult } from './motion';
import { RoutineEngine, type Reminder } from './routine';
import { mergeSettings, type DeepPartial } from './settings';
import { Stats } from './stats';

export interface PlatformHooks {
  /** Erinnerung anzeigen (native Benachrichtigung und/oder kompaktes Fenster). */
  showReminder(view: ReminderView, opts: { native: boolean }): void;
  clearReminder(id: string): void;
  /** Kompakte App in den Vordergrund holen. */
  openApp(): void;
  changed(): void;
  persistSettings(s: Settings): void;
  persistStats(): void;
  applySystemSettings(s: Settings): void;
  log(message: string): void;
  notificationStatus(): AppSnapshot['notifications'];
  platform: string;
  packaged: boolean;
}

const MANUAL_MOVE_THRESHOLD_MM = 30;
const WALL_JUMP_TOLERANCE_MS = 120_000;

/**
 * Verbindet Routine-Engine, Fahrt-Controller und Geräteadapter.
 * Plattformunabhängig – Electron liefert nur Uhr, Timer und Hooks.
 */
export class AppController {
  readonly engine: RoutineEngine;
  readonly motion: MotionController;
  readonly stats: Stats;
  private settings: Settings;
  private adapter: DeskAdapter | null = null;
  private adapterUnsub: (() => void) | null = null;
  private wakeHandle: TimerHandle | null = null;
  private lastWall: number;
  private lastMono: number;
  private lastSettledMm: number | null = null;
  private lastAppMotionEndMono = -Infinity;
  private manualMoveDetected = false;
  private shownReminderId: string | null = null;

  constructor(
    private clock: Clock,
    private timers: Timers,
    initialSettings: Settings,
    initialStats: unknown,
    private hooks: PlatformHooks,
  ) {
    this.settings = initialSettings;
    this.stats = new Stats(initialStats, () => hooks.persistStats());
    this.stats.enabled = initialSettings.statsEnabled;
    this.engine = new RoutineEngine(clock, () => this.settings, this.stats);
    this.motion = new MotionController(clock, timers, () => this.settings, null);
    this.lastWall = clock.wall();
    this.lastMono = clock.mono();

    this.engine.on((e) => {
      if (e.type === 'reminder') this.deliver(e.reminder);
      if (e.type === 'reminderCleared') {
        if (this.shownReminderId === e.id) this.shownReminderId = null;
        hooks.clearReminder(e.id);
      }
      if (e.type === 'changed') this.changed();
    });
    this.motion.on((e) => {
      if (e.type === 'log') hooks.log(e.message);
      if (e.type === 'arrived') {
        this.lastAppMotionEndMono = this.clock.mono();
        this.stats.add(this.clock.wall(), 'deskMovesSucceeded');
        this.engine.confirmPhase(e.target === 'stand' ? 'standing' : 'sitting', 'deskArrival');
      }
      if (e.type === 'failed') {
        this.lastAppMotionEndMono = this.clock.mono();
        this.stats.add(this.clock.wall(), 'deskMovesFailed');
      }
      if (e.type === 'cancelled') this.lastAppMotionEndMono = this.clock.mono();
      if (e.type === 'changed') this.changed();
    });

    this.applyDeskMode();
    if (this.engine.pending) this.deliver(this.engine.pending);
  }

  start() {
    this.loop();
  }

  dispose() {
    this.wakeHandle?.cancel();
    this.motion.dispose();
    this.adapterUnsub?.();
    this.adapter?.dispose();
  }

  getSettings() {
    return this.settings;
  }

  // ---------- Zeitschleife ----------

  /** Wertet die Engine aus und plant den nächsten Weckruf. Zeit kommt immer aus der Uhr. */
  private loop() {
    this.wakeHandle?.cancel();
    this.detectWallJump();
    this.engine.evaluate();
    this.wakeHandle = this.timers.after(this.engine.nextWakeMs(), () => this.loop());
  }

  private detectWallJump() {
    const wall = this.clock.wall();
    const mono = this.clock.mono();
    const drift = wall - this.lastWall - (mono - this.lastMono);
    this.lastWall = wall;
    this.lastMono = mono;
    if (Math.abs(drift) > WALL_JUMP_TOLERANCE_MS) {
      // Systemzeit verstellt oder nicht gemeldeter Ruhezustand: Fahranfragen verwerfen,
      // Phase neu bestätigen lassen. Dauern bleiben korrekt (monotone Uhr).
      this.hooks.log(`Sprung der Systemzeit erkannt (${Math.round(drift / 1000)} s).`);
      this.motion.invalidate('Systemzeit geändert');
      this.engine.systemHold('suspend');
      this.engine.systemReturn('suspend');
    }
  }

  // ---------- Snapshot ----------

  snapshot(): AppSnapshot {
    const next = this.engine.next();
    const a = this.adapter;
    return {
      phase: this.engine.phase,
      hold: this.engine.hold,
      outsideHours: this.engine.outsideHours,
      quiet: this.engine.quiet,
      quietUntilWall: this.engine.quietEndsAtWall,
      remainingMs: next?.remainingMs ?? null,
      nextKind: next?.kind ?? null,
      phaseActiveMs: this.engine.currentPhaseActiveMs(),
      lastConfirmed: this.engine.lastConfirmed,
      reminder: this.engine.pending ? this.reminderView(this.engine.pending) : null,
      motion: this.motion.view(),
      desk: {
        mode: this.settings.desk.mode,
        label: a ? a.label : 'Manuell',
        connection: a ? a.connection() : 'disconnected',
        connectionError: a ? a.connectionError() : null,
        heightMm: a ? a.position() : null,
        limits: a ? a.limits() : null,
        capabilities: a
          ? a.capabilities()
          : { positionFeedback: false, limits: false, targetMove: false, stop: false, holdToMove: false },
        targetMoveReady: this.motion.targetReadiness(),
        holdReady: this.motion.holdReadiness(),
        manualMoveDetected: this.manualMoveDetected,
      },
      notifications: this.hooks.notificationStatus(),
      today: this.stats.today(this.clock.wall()),
      settings: this.settings,
      platform: this.hooks.platform,
      packaged: this.hooks.packaged,
      running: this.engine.isRunning(),
    };
  }

  // ---------- Erinnerungen ----------

  reminderView(r: Reminder): ReminderView {
    const s = this.settings.routine;
    const deskReady = this.motion.targetReadiness().ok;
    const v = (title: string, body: string, actions: ReminderAction[], hint?: string): ReminderView => ({
      id: r.id,
      kind: r.kind,
      title,
      body,
      hint,
      actions,
      createdAtWall: r.createdWall,
    });
    switch (r.kind) {
      case 'toStand':
        return v(
          'Zeit für einen Wechsel',
          `Möchtest du jetzt ${s.standMinutes} Minuten im Stehen arbeiten?`,
          [
            deskReady
              ? { id: 'deskUp', label: 'Tisch hochfahren', primary: true }
              : { id: 'confirmStanding', label: 'Ich stehe jetzt', primary: true },
            { id: 'snooze', label: `In ${s.snoozeMinutes} Minuten` },
            { id: 'skip', label: 'Diesen Wechsel überspringen' },
          ],
          deskReady ? undefined : 'Tisch bitte selbst hochstellen und dann bestätigen.',
        );
      case 'toSit':
        return v(
          'Stehphase vorbei',
          'Möchtest du wieder im Sitzen arbeiten?',
          [
            deskReady
              ? { id: 'deskDown', label: 'Tisch herunterfahren', primary: true }
              : { id: 'confirmSitting', label: 'Ich sitze jetzt', primary: true },
            { id: 'snooze', label: `${s.snoozeMinutes} Minuten länger stehen` },
            { id: 'pauseRoutine', label: 'Routine pausieren' },
          ],
          deskReady ? undefined : 'Tisch bitte selbst herunterstellen und dann bestätigen.',
        );
      case 'movementBreak':
        return v(
          'Kurze Bewegungspause?',
          `Ein paar Schritte für ${s.movementDurationMinutes} Minuten – Wasser holen, zum Fenster, Treppe.`,
          [
            { id: 'startMovement', label: 'Pause starten', primary: true },
            { id: 'snoozeMovement', label: `In ${s.movementSnoozeMinutes} Minuten` },
            { id: 'skipMovement', label: 'Überspringen' },
          ],
        );
      case 'movementOver':
        return v('Bewegungspause vorbei', 'Wie arbeitest du weiter?', [
          { id: 'confirmSitting', label: 'Ich sitze', primary: true },
          { id: 'confirmStanding', label: 'Ich stehe' },
        ]);
      case 'confirmPhase': {
        const titles: Record<string, string> = {
          startup: 'Willkommen',
          idle: 'Willkommen zurück',
          suspend: 'Willkommen zurück',
          lock: 'Willkommen zurück',
          resume: 'Routine fortgesetzt',
          hours: 'Guten Start',
          manualMove: 'Tisch wurde am Bedienteil bewegt',
        };
        return v(
          titles[r.reason ?? 'startup'] ?? 'Wie arbeitest du gerade?',
          r.reason === 'manualMove'
            ? 'Die Höhe allein verrät nicht, ob du sitzt oder stehst. Wie arbeitest du jetzt?'
            : 'Sitzt oder stehst du gerade? Die Zeit läuft erst nach deiner Bestätigung.',
          [
            { id: 'confirmSitting', label: 'Ich sitze', primary: true },
            { id: 'confirmStanding', label: 'Ich stehe' },
            { id: 'pauseRoutine', label: 'Routine pausieren' },
          ],
        );
      }
    }
  }

  private deliver(r: Reminder) {
    // Nach „Fortsetzen“ ist die App ohnehin offen – keine zusätzliche Systemmeldung.
    const quietNative = r.kind === 'confirmPhase' && r.reason === 'resume';
    this.shownReminderId = r.id;
    this.hooks.showReminder(this.reminderView(r), { native: !quietNative });
  }

  /**
   * Aktion aus Benachrichtigung oder App. Nur gültig für die aktuell offene
   * Erinnerung – alte Benachrichtigungen lösen nichts aus.
   */
  reminderAction(reminderId: string, action: ReminderActionId, origin: 'notification' | 'app'): RequestResult {
    const e = this.engine;
    if (!e.isPending(reminderId)) {
      this.hooks.log(`Veraltete Aktion ignoriert (${action}, ${origin}).`);
      return { ok: false, reason: 'Diese Erinnerung ist nicht mehr aktuell.' };
    }
    const view = this.reminderView(e.pending!);
    const alsoAllowed: ReminderActionId[] =
      view.kind === 'toStand' ? ['confirmStanding'] : view.kind === 'toSit' ? ['confirmSitting'] : [];
    if (!view.actions.some((a) => a.id === action) && !alsoAllowed.includes(action)) {
      return { ok: false, reason: 'Aktion passt nicht zur Erinnerung.' };
    }
    switch (action) {
      case 'deskUp':
      case 'deskDown': {
        this.hooks.openApp();
        return this.requestMove(action === 'deskUp' ? 'stand' : 'sit', reminderId);
      }
      case 'confirmStanding':
        this.confirmPhase('standing');
        return { ok: true };
      case 'confirmSitting':
        this.confirmPhase('sitting');
        return { ok: true };
      case 'snooze':
        return e.snooze(reminderId) ? { ok: true } : { ok: false, reason: 'Nicht möglich.' };
      case 'skip':
        return e.skip(reminderId) ? { ok: true } : { ok: false, reason: 'Nicht möglich.' };
      case 'pauseRoutine':
        e.pauseRoutine();
        return { ok: true };
      case 'startMovement':
        e.startMovement();
        return { ok: true };
      case 'snoozeMovement':
        return e.snoozeMovement(reminderId) ? { ok: true } : { ok: false, reason: 'Nicht möglich.' };
      case 'skipMovement':
        return e.skipMovement(reminderId) ? { ok: true } : { ok: false, reason: 'Nicht möglich.' };
    }
  }

  /** Benachrichtigung angeklickt (ohne Aktion): App öffnen, nichts bewegen. */
  reminderClicked() {
    this.hooks.openApp();
  }

  // ---------- Hauptansicht ----------

  /**
   * Fahrt anfordern (startet Countdown). Ist eine Erinnerung beteiligt,
   * muss sie bei Fahrtbeginn noch offen sein.
   */
  requestMove(target: PostureTarget, reminderId?: string): RequestResult {
    const stillValid = () =>
      !['idle', 'suspend', 'lock'].includes(this.engine.hold ?? '') && (reminderId === undefined || this.engine.isPending(reminderId));
    if (!stillValid()) return { ok: false, reason: 'Die Anfrage ist nicht mehr gültig.' };
    const res = this.motion.request(target, stillValid);
    if (!res.ok) this.hooks.log(`Fahrt abgelehnt: ${res.reason}`);
    return res;
  }

  confirmPhase(phase: 'sitting' | 'standing') {
    this.engine.confirmPhase(phase);
    this.manualMoveDetected = false;
  }

  startMovement() {
    this.engine.startMovement();
  }
  endMovement() {
    this.engine.endMovement();
  }
  pauseRoutine() {
    this.engine.pauseRoutine();
  }
  resumeRoutine() {
    this.engine.resumeRoutine();
  }
  setQuiet(minutes: number | null) {
    this.engine.setQuiet(minutes);
    this.loop();
  }
  clearQuiet() {
    this.engine.clearQuiet();
    this.loop();
  }

  stopMotion() {
    return this.motion.stop();
  }
  dismissMotion() {
    this.motion.dismiss();
  }
  holdStart(dir: 'up' | 'down') {
    return this.motion.holdStart(dir);
  }
  holdHeartbeat() {
    this.motion.holdHeartbeat();
  }
  holdEnd() {
    return this.motion.holdEnd();
  }

  // ---------- Einstellungen ----------

  updateSettings(patch: DeepPartial<Settings>) {
    const prev = this.settings;
    this.settings = mergeSettings(prev, patch);
    this.stats.enabled = this.settings.statsEnabled;
    this.hooks.persistSettings(this.settings);
    this.hooks.applySystemSettings(this.settings);
    const deskChanged =
      prev.desk.mode !== this.settings.desk.mode ||
      JSON.stringify(prev.desk.simulator) !== JSON.stringify(this.settings.desk.simulator);
    if (deskChanged) this.applyDeskMode();
    this.engine.settingsChanged();
    this.loop();
    this.changed();
    return this.settings;
  }

  /** Aktuelle Höhe als Sitz-/Stehhöhe übernehmen – nur mit echter Rückmeldung. */
  captureHeight(which: 'sit' | 'stand'): RequestResult {
    const mm = this.adapter?.position() ?? null;
    if (mm === null) return { ok: false, reason: 'Keine Höhenrückmeldung vorhanden.' };
    this.updateSettings({ desk: which === 'sit' ? { sitMm: mm } : { standMm: mm } });
    return { ok: true };
  }

  async connectDesk(): Promise<RequestResult> {
    if (!this.adapter) return { ok: false, reason: 'Manueller Modus – kein Tisch.' };
    try {
      await this.adapter.connect();
      this.lastSettledMm = this.adapter.position();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
      this.changed();
    }
  }

  async disconnectDesk() {
    this.motion.invalidate('Verbindung getrennt');
    await this.adapter?.disconnect();
    this.changed();
  }

  /** Nur Simulator: Fahrt am Bedienteil nachstellen. */
  simulateHandsetMove(mm: number) {
    if (this.adapter instanceof SimulatedDesk) this.adapter.simulateHandsetMove(mm);
  }

  clearStats() {
    this.stats.clear();
    this.changed();
  }

  // ---------- Systemereignisse ----------

  /** Wird regelmäßig mit der System-Leerlaufzeit aufgerufen (nur Sekundenwert, keine Inhalte). */
  idleSeconds(seconds: number) {
    const threshold = this.settings.routine.idleThresholdMinutes * 60;
    if (seconds >= threshold) {
      // In einer Bewegungspause ist Abwesenheit vom Rechner erwartet.
      if (this.engine.hold === null && this.engine.phase !== 'movement') {
        this.hooks.log('Inaktivität erkannt – Routine angehalten.');
        this.motion.invalidate('Inaktivität');
        this.engine.systemHold('idle');
      }
    } else if (this.engine.hold === 'idle') {
      this.engine.systemReturn('idle');
    }
  }

  suspend() {
    this.motion.invalidate('Ruhezustand');
    this.engine.systemHold('suspend');
  }
  resume() {
    this.lastWall = this.clock.wall();
    this.lastMono = this.clock.mono();
    this.engine.systemReturn('suspend');
    this.loop();
  }
  lock() {
    this.motion.invalidate('Bildschirm gesperrt');
    this.engine.systemHold('lock');
  }
  unlock() {
    this.engine.systemReturn('lock');
    this.loop();
  }
  shutdown() {
    this.motion.invalidate('App wird beendet');
  }

  // ---------- intern ----------

  private applyDeskMode() {
    this.adapterUnsub?.();
    this.adapter?.dispose();
    this.adapter = null;
    this.lastSettledMm = null;
    this.manualMoveDetected = false;
    if (this.settings.desk.mode === 'simulator') {
      this.adapter = new SimulatedDesk(this.settings.desk.simulator, this.clock, this.timers);
      this.adapterUnsub = this.adapter.onChange((e) => {
        if (e.type === 'position') this.onDeskPosition(e.mm, e.moving);
        this.changed();
      });
    }
    this.motion.setAdapter(this.adapter);
    this.hooks.log(`Tischmodus: ${this.settings.desk.mode === 'simulator' ? 'Simulator' : 'Manuell'}.`);
  }

  /** Erkennt Fahrten am Bedienteil. Die Höhe beweist keine Haltung – nur Nachfrage. */
  private onDeskPosition(mm: number | null, moving: boolean | null) {
    if (mm === null || moving !== false) return;
    const appRelated = this.motion.busy || this.clock.mono() - this.lastAppMotionEndMono < 2_000;
    if (!appRelated && this.lastSettledMm !== null && Math.abs(mm - this.lastSettledMm) > MANUAL_MOVE_THRESHOLD_MM) {
      this.hooks.log(`Tischbewegung am Bedienteil erkannt (${this.lastSettledMm} → ${mm} mm).`);
      this.manualMoveDetected = true;
      this.engine.manualDeskMoveDetected();
    }
    this.lastSettledMm = mm;
  }

  private changed() {
    this.hooks.changed();
  }
}
