import type { DeepPartial } from '../core/settings';
import type { AppSnapshot, PostureTarget, ReminderActionId, Settings } from './types';

/** Alle Befehle der Oberfläche an den Hauptprozess. */
export type Command =
  | { type: 'confirmPhase'; phase: 'sitting' | 'standing' }
  | { type: 'reminderAction'; reminderId: string; action: ReminderActionId }
  | { type: 'requestMove'; target: PostureTarget }
  | { type: 'stopMotion' }
  | { type: 'dismissMotion' }
  | { type: 'holdStart'; direction: 'up' | 'down' }
  | { type: 'holdHeartbeat' }
  | { type: 'holdEnd' }
  | { type: 'startMovement' }
  | { type: 'endMovement' }
  | { type: 'pauseRoutine' }
  | { type: 'resumeRoutine' }
  | { type: 'setQuiet'; minutes: number | null }
  | { type: 'clearQuiet' }
  | { type: 'updateSettings'; patch: DeepPartial<Settings> }
  | { type: 'captureHeight'; which: 'sit' | 'stand' }
  | { type: 'connectDesk' }
  | { type: 'disconnectDesk' }
  | { type: 'simulateHandsetMove'; mm: number }
  | { type: 'exportData' }
  | { type: 'deleteData' }
  | { type: 'openLogs' }
  | { type: 'openNotificationSettings' }
  | { type: 'testNotification' }
  | { type: 'openLink'; url: string }
  | { type: 'showMain' }
  | { type: 'closeReminderWindow' };

export type CommandResult = { ok: true; message?: string } | { ok: false; reason: string };

export interface WechselApi {
  snapshot(): Promise<AppSnapshot>;
  send(cmd: Command): Promise<CommandResult>;
  onState(fn: (s: AppSnapshot) => void): () => void;
  onNavigate(fn: (view: 'main' | 'settings') => void): () => void;
}

/** Externe Links, die die App öffnen darf. */
export const ALLOWED_LINKS = [
  'https://www.ccohs.ca/oshanswers/ergonomics/office/sit_stand_desk.html',
  'https://www.hse.gov.uk/msd/dse/work-routine.htm',
];

export const IPC = {
  snapshot: 'wechsel:snapshot',
  command: 'wechsel:command',
  state: 'wechsel:state',
  navigate: 'wechsel:navigate',
} as const;
