import { Notification } from 'electron';
import type { AppSnapshot, ReminderActionId, ReminderView } from '../shared/types';

type Status = AppSnapshot['notifications'];

/**
 * Native Benachrichtigungen mit Aktionsknöpfen.
 * - macOS: Knöpfe nur bei signierter App mit Hinweisstil „Hinweise“ (alert);
 *   unsignierte Builds melden `failed` → Fallback auf das Erinnerungsfenster.
 * - Windows: Knöpfe über Electron-Toasts.
 * Schließen, Ablaufen oder Ignorieren löst niemals eine Aktion aus.
 */
export class Notifier {
  private status: Status = { status: 'unknown', detail: null };
  private open = new Map<string, Notification>();

  constructor(
    private onAction: (reminderId: string, action: ReminderActionId) => void,
    private onClick: (reminderId: string) => void,
    private onFailed: (reminderId: string, error: string) => void,
    private log: (m: string) => void,
  ) {
    if (!Notification.isSupported()) {
      this.status = { status: 'unsupported', detail: 'Dieses System unterstützt keine Benachrichtigungen.' };
    }
  }

  getStatus(): Status {
    return this.status;
  }

  /** @returns false, wenn native Anzeige sicher nicht möglich ist. */
  show(view: ReminderView): boolean {
    if (this.status.status === 'unsupported') return false;
    this.close(view.id);
    const n = new Notification({
      title: view.title,
      body: view.hint ? `${view.body}\n${view.hint}` : view.body,
      actions: view.actions.map((a) => ({ type: 'button' as const, text: a.label })),
      closeButtonText: 'Schließen',
      silent: false,
      timeoutType: 'default',
    });
    n.on('action', (details) => {
      const action = view.actions[details.actionIndex];
      if (action) this.onAction(view.id, action.id);
    });
    n.on('click', () => this.onClick(view.id));
    n.on('show', () => {
      if (this.status.status !== 'ok') this.log('Systembenachrichtigungen funktionieren.');
      this.status = { status: 'ok', detail: null };
    });
    n.on('failed', (_e, error) => {
      this.status = { status: 'failed', detail: error };
      this.log(`Benachrichtigung fehlgeschlagen: ${error}`);
      this.onFailed(view.id, error);
    });
    n.on('close', () => this.open.delete(view.id));
    this.open.set(view.id, n);
    n.show();
    return true;
  }

  close(id: string) {
    const n = this.open.get(id);
    if (n) {
      this.open.delete(id);
      n.close();
    }
  }

  test() {
    if (this.status.status === 'unsupported') return;
    const n = new Notification({ title: 'Wechsel', body: 'Testbenachrichtigung – so sehen Erinnerungen aus.' });
    n.on('show', () => (this.status = { status: 'ok', detail: null }));
    n.on('failed', (_e, error) => (this.status = { status: 'failed', detail: error }));
    n.show();
  }
}
