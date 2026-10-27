import type { Ctx } from './App';
import { ModeBadge } from './MainView';

/**
 * Kompaktes Erinnerungsfenster – Ersatz, wenn native Benachrichtigungen fehlen
 * oder so eingestellt ist. Schließen bedeutet: nichts tun, keine Bewegung.
 */
export function ReminderWindow({ s, send }: Ctx) {
  const r = s.reminder;
  if (!r) {
    return (
      <div className="reminder-window">
        <p className="muted">Keine offene Erinnerung.</p>
        <button className="secondary" onClick={() => void send({ type: 'closeReminderWindow' })}>Schließen</button>
      </div>
    );
  }
  return (
    <div className="reminder-window">
      <div className="rw-head">
        <span className="brand small">Wechsel</span>
        <ModeBadge s={s} />
        <button className="icon-btn close" aria-label="Schließen (keine Aktion)" title="Schließen – es passiert nichts" onClick={() => void send({ type: 'closeReminderWindow' })}>
          ×
        </button>
      </div>
      <div className="reminder-title">{r.title}</div>
      <p>{r.body}</p>
      {r.hint && <p className="hint">{r.hint}</p>}
      <div className="actions">
        {r.actions.map((a) => (
          <button key={a.id} className={a.primary ? 'primary' : 'secondary'} onClick={() => void send({ type: 'reminderAction', reminderId: r.id, action: a.id })}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
