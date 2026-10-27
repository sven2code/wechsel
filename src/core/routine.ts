import type { HoldReason, Phase, ReminderKind, Settings } from '../shared/types';
import type { Clock } from './clock';
import { isWithinWorkingHours } from './schedule';
import type { Stats } from './stats';

export interface Reminder {
  id: string;
  kind: ReminderKind;
  createdMono: number;
  createdWall: number;
  /** Anlass einer Phasenabfrage (z. B. Rückkehr nach Inaktivität). */
  reason?: 'startup' | 'idle' | 'suspend' | 'lock' | 'resume' | 'hours' | 'manualMove' | 'deskUnconfirmed';
}

export type EngineEvent =
  | { type: 'reminder'; reminder: Reminder }
  | { type: 'reminderCleared'; id: string; why: 'answered' | 'ignored' | 'superseded' }
  | { type: 'changed' };

/** Erinnerungen, die die Zeitmessung blockieren, bis die Phase bestätigt ist. */
const BLOCKING: ReminderKind[] = ['confirmPhase', 'movementOver'];
/** Routinevorschläge – nur diese laufen ab und werden bei Pause/Ruhemodus verworfen. */
const SUGGESTIONS: ReminderKind[] = ['toStand', 'toSit', 'movementBreak'];

const MIN = 60_000;
const MAX_WAKE_MS = 30_000;

/**
 * Routine-Engine: reine Zustandslogik, unabhängig von Electron und Tischhardware.
 *
 * Grundsätze:
 * - Zeit zählt nur in einer bestätigten Phase und nur, solange nichts pausiert.
 * - Dauern über die monotone Uhr; die Wanduhr nur für Arbeitszeiten/Statistik.
 * - Keine Erinnerungsschlange: höchstens eine offene Erinnerung.
 * - Die Engine erzeugt nie Fahrbefehle.
 */
export class RoutineEngine {
  phase: Phase = 'unknown';
  hold: HoldReason | null = null;
  outsideHours = false;
  pending: Reminder | null = null;
  lastConfirmed: { phase: Phase; atWall: number; source: 'user' | 'deskArrival' } | null = null;

  private quietUntilMono: number | null = null;
  private quietIndefinite = false;
  private quietUntilWall: number | null = null;

  private phaseActiveMs = 0;
  private movementActiveMs = 0;
  private runningSince: number | null = null;
  private phaseDueMs: number | null = null;
  private phaseDueIsDefault = true;
  private movementDueMs: number | null = null;
  private movementDueIsDefault = true;
  private previousPostureBeforeMovement: Phase = 'unknown';

  private seq = 0;
  private listeners = new Set<(e: EngineEvent) => void>();

  constructor(
    private clock: Clock,
    private getSettings: () => Settings,
    private stats?: Stats,
  ) {
    this.outsideHours = !isWithinWorkingHours(clock.wall(), getSettings().schedule);
    this.movementDueMs = this.movementInterval();
    if (!this.outsideHours) this.raise('confirmPhase', 'startup');
  }

  on(fn: (e: EngineEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- Abfragen ----------

  get quiet() {
    return this.quietIndefinite || this.quietUntilMono !== null;
  }
  get quietEndsAtWall() {
    return this.quietIndefinite ? null : this.quietUntilWall;
  }

  isRunning() {
    return (
      (this.phase === 'sitting' || this.phase === 'standing' || this.phase === 'movement') &&
      this.hold === null &&
      !this.outsideHours &&
      !(this.pending && BLOCKING.includes(this.pending.kind))
    );
  }

  /** Aktive Zeit in der aktuellen Phase inkl. laufendem Abschnitt. */
  currentPhaseActiveMs() {
    return this.phaseActiveMs + this.liveDelta();
  }

  /** Nächster geplanter Vorschlag und Restzeit (eingefroren, wenn pausiert). */
  next(): { kind: ReminderKind; remainingMs: number } | null {
    if (this.phase === 'unknown' || this.outsideHours || this.pending) return null;
    const live = this.liveDelta();
    if (this.phase === 'movement') {
      return this.phaseDueMs === null ? null : { kind: 'movementOver', remainingMs: Math.max(0, this.phaseDueMs - this.phaseActiveMs - live) };
    }
    const candidates: { kind: ReminderKind; remainingMs: number }[] = [];
    if (this.phaseDueMs !== null) {
      candidates.push({
        kind: this.phase === 'sitting' ? 'toStand' : 'toSit',
        remainingMs: Math.max(0, this.phaseDueMs - this.phaseActiveMs - live),
      });
    }
    if (this.getSettings().routine.movementEnabled && this.movementDueMs !== null) {
      candidates.push({ kind: 'movementBreak', remainingMs: Math.max(0, this.movementDueMs - this.movementActiveMs - live) });
    }
    candidates.sort((a, b) => a.remainingMs - b.remainingMs);
    return candidates[0] ?? null;
  }

  /** Wann die Engine spätestens erneut ausgewertet werden sollte (ms). */
  nextWakeMs(): number {
    let wake = MAX_WAKE_MS; // Arbeitszeitgrenzen und Wanduhrsprünge regelmäßig prüfen
    const n = this.isRunning() && !this.quiet ? this.next() : null;
    if (n) wake = Math.min(wake, n.remainingMs);
    if (this.pending && SUGGESTIONS.includes(this.pending.kind)) {
      const left = this.pending.createdMono + this.getSettings().routine.reminderTimeoutMinutes * MIN - this.clock.mono();
      wake = Math.min(wake, left);
    }
    if (this.quietUntilMono !== null) wake = Math.min(wake, this.quietUntilMono - this.clock.mono());
    return Math.max(50, wake);
  }

  // ---------- Auswertung ----------

  /** Zustand anhand der Uhren neu berechnen. Darf beliebig oft aufgerufen werden. */
  evaluate() {
    this.mutate(() => {
      const settings = this.getSettings();
      const now = this.clock.mono();

      // Arbeitszeiten (Wanduhr)
      const outside = !isWithinWorkingHours(this.clock.wall(), settings.schedule);
      if (outside !== this.outsideHours) {
        this.outsideHours = outside;
        if (outside) {
          this.dropSuggestion('superseded');
        } else if (this.hold === null && !this.pending) {
          this.raise('confirmPhase', 'hours');
        }
      }

      // Ruhemodus beendet?
      if (this.quietUntilMono !== null && now >= this.quietUntilMono) {
        this.quietUntilMono = null;
        this.quietUntilWall = null;
      }

      // Ignorierte Erinnerung: keine Bewegung, frühestens nach dem Intervall erneut.
      if (this.pending && SUGGESTIONS.includes(this.pending.kind)) {
        if (now - this.pending.createdMono >= settings.routine.reminderTimeoutMinutes * MIN) {
          this.stats?.add(this.clock.wall(), 'ignored');
          if (this.pending.kind === 'movementBreak') this.rescheduleMovement(this.movementInterval());
          else this.reschedulePhase(this.phaseInterval());
          this.clearPending('ignored');
        }
      }

      if (!this.isRunning() || this.pending) return;

      if (this.phase === 'movement') {
        if (this.phaseDueMs !== null && this.phaseActiveMs >= this.phaseDueMs) this.raise('movementOver');
        return;
      }
      if (this.quiet) return;
      if (settings.routine.movementEnabled && this.movementDueMs !== null && this.movementActiveMs >= this.movementDueMs) {
        this.raise('movementBreak');
        return;
      }
      if (this.phaseDueMs !== null && this.phaseActiveMs >= this.phaseDueMs) {
        this.raise(this.phase === 'sitting' ? 'toStand' : 'toSit');
      }
    });
  }

  // ---------- Nutzeraktionen ----------

  /** Phase bestätigen. Erst ab hier zählt die Zeit. */
  confirmPhase(phase: 'sitting' | 'standing', source: 'user' | 'deskArrival' = 'user') {
    this.mutate(() => {
      const prev = this.phase === 'movement' ? this.previousPostureBeforeMovement : this.phase;
      if (prev !== 'unknown' && prev !== phase) this.stats?.add(this.clock.wall(), 'confirmedSwitches');
      this.phase = phase;
      this.phaseActiveMs = 0;
      this.phaseDueMs = this.phaseInterval();
      this.phaseDueIsDefault = true;
      this.lastConfirmed = { phase, atWall: this.clock.wall(), source };
      if (this.hold !== 'user') this.hold = null;
      if (this.pending) this.clearPending('answered');
    });
  }

  /** Vorschlag verschieben. Schreibt keine Stehzeit gut. */
  snooze(reminderId: string): boolean {
    if (!this.isPending(reminderId, ['toStand', 'toSit'])) return false;
    this.mutate(() => {
      this.stats?.add(this.clock.wall(), 'snoozed');
      this.reschedulePhase(this.getSettings().routine.snoozeMinutes * MIN);
      this.clearPending('answered');
    });
    return true;
  }

  /** Wechsel überspringen: Phase bleibt, frühestens nach dem Intervall neuer Vorschlag. */
  skip(reminderId: string): boolean {
    if (!this.isPending(reminderId, ['toStand', 'toSit'])) return false;
    this.mutate(() => {
      this.stats?.add(this.clock.wall(), 'skipped');
      this.reschedulePhase(this.phaseInterval());
      this.clearPending('answered');
    });
    return true;
  }

  startMovement() {
    this.mutate(() => {
      if (this.phase !== 'movement') this.previousPostureBeforeMovement = this.phase;
      this.phase = 'movement';
      this.phaseActiveMs = 0;
      this.phaseDueMs = this.getSettings().routine.movementDurationMinutes * MIN;
      this.phaseDueIsDefault = true;
      this.movementActiveMs = 0;
      this.movementDueMs = this.movementInterval();
      this.movementDueIsDefault = true;
      this.stats?.add(this.clock.wall(), 'movementBreaksConfirmed');
      this.lastConfirmed = { phase: 'movement', atWall: this.clock.wall(), source: 'user' };
      if (this.hold !== 'user') this.hold = null;
      if (this.pending) this.clearPending('answered');
    });
  }

  /** Bewegungspause vorzeitig beenden: danach Phase abfragen. */
  endMovement() {
    if (this.phase !== 'movement') return;
    this.mutate(() => {
      this.phaseDueMs = this.phaseActiveMs;
      if (this.pending) this.clearPending('superseded');
      this.raise('movementOver');
    });
  }

  snoozeMovement(reminderId: string): boolean {
    if (!this.isPending(reminderId, ['movementBreak'])) return false;
    this.mutate(() => {
      this.stats?.add(this.clock.wall(), 'snoozed');
      this.rescheduleMovement(this.getSettings().routine.movementSnoozeMinutes * MIN);
      this.clearPending('answered');
    });
    return true;
  }

  skipMovement(reminderId: string): boolean {
    if (!this.isPending(reminderId, ['movementBreak'])) return false;
    this.mutate(() => {
      this.stats?.add(this.clock.wall(), 'skipped');
      this.rescheduleMovement(this.movementInterval());
      this.clearPending('answered');
    });
    return true;
  }

  pauseRoutine() {
    this.mutate(() => {
      this.hold = 'user';
      if (this.pending) this.clearPending('superseded');
    });
  }

  /** Fortsetzen: Haltung kann sich geändert haben, daher erneut bestätigen lassen. */
  resumeRoutine() {
    if (this.hold !== 'user') return;
    this.mutate(() => {
      this.hold = null;
      if (!this.outsideHours) this.raise('confirmPhase', 'resume');
    });
  }

  setQuiet(minutes: number | null) {
    this.mutate(() => {
      if (minutes === null) {
        this.quietIndefinite = true;
        this.quietUntilMono = null;
        this.quietUntilWall = null;
      } else {
        this.quietIndefinite = false;
        this.quietUntilMono = this.clock.mono() + minutes * MIN;
        this.quietUntilWall = this.clock.wall() + minutes * MIN;
      }
      this.dropSuggestion('superseded');
    });
  }

  clearQuiet() {
    this.mutate(() => {
      this.quietIndefinite = false;
      this.quietUntilMono = null;
      this.quietUntilWall = null;
    });
  }

  // ---------- Systemereignisse ----------

  /** Inaktivität, Sperre oder Ruhezustand: Zeit anhalten, Vorschläge verwerfen. */
  systemHold(reason: 'idle' | 'suspend' | 'lock') {
    this.mutate(() => {
      if (this.hold === 'user') return;
      // Ein stärkerer Grund (Sperre/Ruhe) ersetzt Inaktivität.
      if (this.hold === null || this.hold === 'idle') this.hold = reason;
      this.dropSuggestion('superseded');
    });
  }

  /** Rückkehr: keine Erinnerungsschlange, sondern Phase bestätigen lassen. */
  systemReturn(reason: 'idle' | 'suspend' | 'lock') {
    this.mutate(() => {
      if (this.hold === null || this.hold === 'user') return;
      if (reason === 'idle' && this.hold !== 'idle') return; // Aktivität beendet keine Sperre
      const was = this.hold;
      this.hold = null;
      if (!this.outsideHours) {
        if (this.pending) this.clearPending('superseded');
        this.raise('confirmPhase', was as Reminder['reason']);
      }
    });
  }

  /** Telemetrie meldet eine Tischbewegung, die nicht von der App kam. Höhe beweist keine Haltung. */
  manualDeskMoveDetected() {
    if (this.outsideHours || this.hold !== null) return;
    if (this.pending?.kind === 'confirmPhase') return;
    this.mutate(() => {
      if (this.pending) this.clearPending('superseded');
      this.raise('confirmPhase', 'manualMove');
    });
  }

  /** Tischfahrt ohne bestätigte Ankunft: Nutzer soll Phase selbst bestätigen. */
  requestPhaseConfirmation(reason: Reminder['reason']) {
    this.mutate(() => {
      if (this.pending) this.clearPending('superseded');
      this.raise('confirmPhase', reason);
    });
  }

  settingsChanged() {
    this.mutate(() => {
      if (this.phaseDueIsDefault && (this.phase === 'sitting' || this.phase === 'standing')) {
        this.phaseDueMs = this.phaseInterval();
      }
      if (this.phase === 'movement' && this.phaseDueIsDefault) {
        this.phaseDueMs = this.getSettings().routine.movementDurationMinutes * MIN;
      }
      if (this.movementDueIsDefault) this.movementDueMs = this.movementInterval();
      this.outsideHours = !isWithinWorkingHours(this.clock.wall(), this.getSettings().schedule);
      if (this.outsideHours) this.dropSuggestion('superseded');
    });
    this.evaluate();
  }

  isPending(id: string, kinds?: ReminderKind[]) {
    return !!this.pending && this.pending.id === id && (!kinds || kinds.includes(this.pending.kind));
  }

  // ---------- intern ----------

  private phaseInterval() {
    const r = this.getSettings().routine;
    return (this.phase === 'standing' ? r.standMinutes : r.sitMinutes) * MIN;
  }
  private movementInterval() {
    return this.getSettings().routine.movementIntervalMinutes * MIN;
  }

  private reschedulePhase(fromNowMs: number) {
    this.phaseDueMs = this.phaseActiveMs + fromNowMs;
    this.phaseDueIsDefault = false;
  }
  private rescheduleMovement(fromNowMs: number) {
    this.movementDueMs = this.movementActiveMs + fromNowMs;
    this.movementDueIsDefault = false;
  }

  private liveDelta() {
    return this.runningSince === null ? 0 : Math.max(0, this.clock.mono() - this.runningSince);
  }

  /** Laufende Zeit in die Zähler übernehmen. */
  private accumulate() {
    const delta = this.liveDelta();
    if (this.runningSince !== null) this.runningSince = this.clock.mono();
    if (delta <= 0) return;
    this.phaseActiveMs += delta;
    if (this.phase === 'sitting' || this.phase === 'standing') this.movementActiveMs += delta;
    const field = this.phase === 'sitting' ? 'sittingMs' : this.phase === 'standing' ? 'standingMs' : this.phase === 'movement' ? 'movementMs' : null;
    if (field) this.stats?.add(this.clock.wall(), field, delta);
  }

  private mutate(fn: () => void) {
    this.accumulate();
    fn();
    this.accumulate();
    this.runningSince = this.isRunning() ? (this.runningSince ?? this.clock.mono()) : null;
    this.emit({ type: 'changed' });
  }

  private raise(kind: ReminderKind, reason?: Reminder['reason']) {
    this.pending = {
      id: `r${Date.now().toString(36)}-${++this.seq}`,
      kind,
      createdMono: this.clock.mono(),
      createdWall: this.clock.wall(),
      reason,
    };
    if (SUGGESTIONS.includes(kind)) this.stats?.add(this.clock.wall(), 'remindersShown');
    this.emit({ type: 'reminder', reminder: this.pending });
  }

  private dropSuggestion(why: 'superseded' | 'ignored') {
    if (this.pending && SUGGESTIONS.includes(this.pending.kind)) this.clearPending(why);
  }

  private clearPending(why: 'answered' | 'ignored' | 'superseded') {
    const id = this.pending?.id;
    this.pending = null;
    if (id) this.emit({ type: 'reminderCleared', id, why });
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }
}
