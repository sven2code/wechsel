// Gemeinsame Typen für Kern, Electron-Hauptprozess und Oberfläche.
// Keine Abhängigkeit zu Electron oder DOM.

export type Phase = 'sitting' | 'standing' | 'movement' | 'unknown';
export type PostureTarget = 'sit' | 'stand';

/** Warum die Routine gerade nicht zählt. */
export type HoldReason =
  | 'user' // vom Nutzer pausiert
  | 'idle' // Inaktivität erkannt
  | 'suspend' // Ruhezustand
  | 'lock'; // Bildschirm gesperrt

export type ReminderKind =
  | 'toStand'
  | 'toSit'
  | 'movementBreak'
  | 'movementOver'
  | 'confirmPhase';

export type ReminderActionId =
  | 'deskUp'
  | 'deskDown'
  | 'confirmStanding'
  | 'confirmSitting'
  | 'snooze'
  | 'skip'
  | 'pauseRoutine'
  | 'startMovement'
  | 'snoozeMovement'
  | 'skipMovement';

export interface ReminderAction {
  id: ReminderActionId;
  label: string;
  primary?: boolean;
}

export interface ReminderView {
  id: string;
  kind: ReminderKind;
  title: string;
  body: string;
  hint?: string;
  actions: ReminderAction[];
  createdAtWall: number;
}

export type DeskMode = 'manual' | 'simulator';

export interface SimulatorSettings {
  /** Fahrgeschwindigkeit des simulierten Tischs in mm/s. */
  speedMmPerS: number;
  profile: 'full' | 'holdOnly' | 'noTelemetry' | 'noStop';
  failure: 'none' | 'connectFails' | 'disconnectDuringMove' | 'stall' | 'stopIgnored';
  minMm: number;
  maxMm: number;
}

export interface Settings {
  version: 1;
  routine: {
    sitMinutes: number;
    standMinutes: number;
    snoozeMinutes: number;
    movementEnabled: boolean;
    movementIntervalMinutes: number;
    movementDurationMinutes: number;
    movementSnoozeMinutes: number;
    /** Nach dieser Zeit ohne Antwort gilt eine Erinnerung als ignoriert. */
    reminderTimeoutMinutes: number;
    idleThresholdMinutes: number;
  };
  schedule: {
    enabled: boolean;
    /** 0 = Sonntag … 6 = Samstag (wie Date.getDay()). */
    days: number[];
    start: string; // "HH:MM"
    end: string; // "HH:MM"
  };
  desk: {
    mode: DeskMode;
    sitMm: number | null;
    standMm: number | null;
    personalMinMm: number | null;
    personalMaxMm: number | null;
    /** Nutzer hat bestätigt: Fahrbereich frei halten, App erkennt keine Hindernisse. */
    safetyAcknowledged: boolean;
    simulator: SimulatorSettings;
  };
  notifications: {
    style: 'native' | 'window' | 'both';
  };
  appearance: {
    theme: 'system' | 'light' | 'dark';
  };
  autostart: boolean;
  statsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  routine: {
    sitMinutes: 30,
    standMinutes: 5,
    snoozeMinutes: 5,
    movementEnabled: true,
    movementIntervalMinutes: 60,
    movementDurationMinutes: 3,
    movementSnoozeMinutes: 10,
    reminderTimeoutMinutes: 10,
    idleThresholdMinutes: 5,
  },
  schedule: {
    enabled: true,
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '18:00',
  },
  desk: {
    mode: 'manual',
    sitMm: null,
    standMm: null,
    personalMinMm: null,
    personalMaxMm: null,
    safetyAcknowledged: false,
    simulator: {
      speedMmPerS: 35,
      profile: 'full',
      failure: 'none',
      minMm: 620,
      maxMm: 1270,
    },
  },
  notifications: { style: 'native' },
  appearance: { theme: 'system' },
  autostart: false,
  statsEnabled: true,
};

export interface DayStats {
  /** Geschätzte Zeit je Phase: Zeit zwischen bestätigten Wechseln, ohne Pausen. */
  sittingMs: number;
  standingMs: number;
  movementMs: number;
  confirmedSwitches: number;
  movementBreaksConfirmed: number;
  remindersShown: number;
  snoozed: number;
  skipped: number;
  ignored: number;
  deskMovesSucceeded: number;
  deskMovesFailed: number;
}

export interface StatsData {
  version: 1;
  days: Record<string, DayStats>;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DeskCapabilities {
  positionFeedback: boolean;
  limits: boolean;
  targetMove: boolean;
  stop: boolean;
  holdToMove: boolean;
}

export type MotionView =
  | { kind: 'idle' }
  | { kind: 'countdown'; target: PostureTarget; targetMm: number; endsAtWall: number; secondsLeft: number }
  | { kind: 'moving'; target: PostureTarget | null; targetMm: number | null; mode: 'target' | 'hold' }
  | { kind: 'error'; message: string };

export interface DeskView {
  mode: DeskMode;
  label: string;
  connection: ConnectionState;
  connectionError: string | null;
  heightMm: number | null; // nur bei echter (bzw. simulierter) Rückmeldung
  limits: { minMm: number; maxMm: number } | null;
  capabilities: DeskCapabilities;
  targetMoveReady: { ok: boolean; reasons: string[] };
  holdReady: { ok: boolean; reasons: string[] };
  manualMoveDetected: boolean;
}

export interface AppSnapshot {
  phase: Phase;
  hold: HoldReason | null;
  outsideHours: boolean;
  quietUntilWall: number | null;
  quiet: boolean;
  /** Restzeit bis zum nächsten Vorschlag; null wenn keiner geplant ist. */
  remainingMs: number | null;
  nextKind: ReminderKind | null;
  phaseActiveMs: number;
  lastConfirmed: { phase: Phase; atWall: number; source: 'user' | 'deskArrival' } | null;
  reminder: ReminderView | null;
  motion: MotionView;
  desk: DeskView;
  notifications: { status: 'unknown' | 'ok' | 'failed' | 'unsupported'; detail: string | null };
  today: DayStats;
  settings: Settings;
  platform: string;
  /** Läuft die gepackte App (Autostart nur dort sinnvoll)? */
  packaged: boolean;
  /** Läuft die Zeit gerade (für die Live-Anzeige der Restzeit)? */
  running: boolean;
}
