import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, PostureTarget, ReminderView } from '../shared/types';
import { useTick, type Ctx } from './App';
import { fmtClock, fmtCm, fmtDuration, fmtTime, holdLabel, nextLabel, phaseLabel } from './format';

export function MainView(ctx: Ctx & { onSettings: () => void }) {
  const { s } = ctx;
  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">Wechsel</div>
        <ModeBadge s={s} />
        <button className="icon-btn" onClick={ctx.onSettings} aria-label="Einstellungen" title="Einstellungen">
          <GearIcon />
        </button>
      </header>
      <main className="content">
        {ctx.error && (
          <div className="banner warn" role="alert">
            <span>{ctx.error}</span>
            <button className="link" onClick={ctx.clearError}>OK</button>
          </div>
        )}
        <MotionPanel {...ctx} />
        <PhaseCard {...ctx} />
        {s.reminder && <ReminderCard r={s.reminder} {...ctx} />}
        <QuickActions {...ctx} />
        <DeskCard {...ctx} />
        <TodayCard s={s} />
        <NotificationHint {...ctx} />
      </main>
    </div>
  );
}

export function ModeBadge({ s }: { s: AppSnapshot }) {
  if (s.desk.mode === 'simulator') return <span className="badge sim" title="Simulierter Tisch – keine echte Hardware">SIMULATOR</span>;
  return <span className="badge manual" title="Ohne Tischanbindung – du stellst den Tisch selbst">Manuell</span>;
}

// ---------- Fahrt ----------

function MotionPanel({ s, send }: Ctx) {
  const m = s.motion;
  if (m.kind === 'idle') return null;
  const sim = s.desk.mode === 'simulator' ? ' (Simulator)' : '';
  if (m.kind === 'countdown') {
    return (
      <section className="motion countdown" aria-live="assertive">
        <div className="motion-text">
          <strong>{m.target === 'stand' ? 'Tisch fährt hoch' : 'Tisch fährt herunter'}{sim}</strong>
          <span>in {m.secondsLeft} s auf {fmtCm(m.targetMm)} · Fahrbereich freihalten</span>
        </div>
        <button className="stop" onClick={() => void send({ type: 'stopMotion' })} autoFocus>
          Abbrechen
        </button>
      </section>
    );
  }
  if (m.kind === 'moving') {
    return (
      <section className="motion moving" aria-live="assertive">
        <div className="motion-text">
          <strong>Tisch fährt{sim} …</strong>
          <span>
            {m.targetMm !== null ? `Ziel ${fmtCm(m.targetMm)} · ` : ''}aktuell {fmtCm(s.desk.heightMm)}
          </span>
        </div>
        <button className="stop" onClick={() => void send({ type: 'stopMotion' })} autoFocus>
          STOPP
        </button>
      </section>
    );
  }
  return (
    <section className="motion error" role="alert">
      <div className="motion-text">
        <strong>Fahrt nicht abgeschlossen</strong>
        <span>{m.message}</span>
        <span className="muted">Der Tisch bleibt am Bedienteil bedienbar. Die Phase ändert sich erst nach deiner Bestätigung.</span>
      </div>
      <button className="secondary" onClick={() => void send({ type: 'dismissMotion' })}>
        Verstanden
      </button>
    </section>
  );
}

// ---------- Phase ----------

function PhaseCard({ s, receivedAt }: Ctx) {
  useTick(s.running);
  const elapsed = s.running ? performance.now() - receivedAt : 0;
  const remaining = s.remainingMs !== null ? Math.max(0, s.remainingMs - elapsed) : null;
  const active = s.phaseActiveMs + elapsed;

  let status: string;
  if (s.hold) status = holdLabel[s.hold];
  else if (s.outsideHours) status = 'Außerhalb der Arbeitszeit – keine Hinweise';
  else if (s.phase === 'unknown') status = 'Bitte bestätige, ob du sitzt oder stehst.';
  else if (s.reminder) status = 'Wartet auf deine Antwort';
  else status = s.quiet ? `Ruhemodus${s.quietUntilWall ? ` bis ${fmtTime(s.quietUntilWall)}` : ''}` : 'läuft';

  return (
    <section className={`card phase phase-${s.phase}`}>
      <div className="phase-head">
        <PhaseIcon phase={s.phase} />
        <div>
          <div className="eyebrow">Aktuelle Phase</div>
          <div className="phase-name">{s.hold === 'user' ? `${phaseLabel[s.phase]} · pausiert` : phaseLabel[s.phase]}</div>
        </div>
      </div>
      {remaining !== null && s.nextKind && (
        <div className="remaining">
          <span className="big">{fmtClock(remaining)}</span>
          <span className="muted">bis {nextLabel[s.nextKind] ?? 'zum nächsten Vorschlag'}</span>
        </div>
      )}
      <div className="phase-meta">
        <span>{status}</span>
        {s.phase !== 'unknown' && <span>· seit {fmtDuration(active)} aktiv</span>}
      </div>
      {s.lastConfirmed && (
        <div className="phase-meta muted">
          Zuletzt bestätigt: {phaseLabel[s.lastConfirmed.phase]} um {fmtTime(s.lastConfirmed.atWall)}
          {s.lastConfirmed.source === 'deskArrival' ? ' (Klick + Ankunft des Tischs)' : ' (dein Klick)'}
        </div>
      )}
    </section>
  );
}

// ---------- Erinnerung ----------

export function ReminderCard({ r, send, s }: Ctx & { r: ReminderView }) {
  const busy = s.motion.kind === 'countdown' || s.motion.kind === 'moving';
  return (
    <section className="card reminder" aria-live="polite">
      <div className="reminder-title">{r.title}</div>
      <p>{r.body}</p>
      {r.hint && <p className="hint">{r.hint}</p>}
      <div className="actions">
        {r.actions.map((a) => (
          <button
            key={a.id}
            className={a.primary ? 'primary' : 'secondary'}
            disabled={busy && (a.id === 'deskUp' || a.id === 'deskDown')}
            onClick={() => void send({ type: 'reminderAction', reminderId: r.id, action: a.id })}
          >
            {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Schnellaktionen ----------

function QuickActions({ s, send }: Ctx) {
  const [manual, setManual] = useState<PostureTarget | null>(null);
  const [quietOpen, setQuietOpen] = useState(false);
  const deskReady = s.desk.targetMoveReady.ok;
  const busy = s.motion.kind === 'countdown' || s.motion.kind === 'moving';

  const posture = (target: PostureTarget) => {
    if (deskReady) void send({ type: 'requestMove', target });
    else setManual(target);
  };

  if (manual) {
    return (
      <section className="card manual-step">
        <p>
          <strong>{manual === 'stand' ? 'Tisch bitte selbst hochstellen.' : 'Tisch bitte selbst herunterstellen.'}</strong>
          <br />
          <span className="muted">Die neue Phase beginnt erst mit deiner Bestätigung.</span>
        </p>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              void send({ type: 'confirmPhase', phase: manual === 'stand' ? 'standing' : 'sitting' });
              setManual(null);
            }}
          >
            {manual === 'stand' ? 'Ich stehe jetzt' : 'Ich sitze jetzt'}
          </button>
          <button className="secondary" onClick={() => setManual(null)}>
            Abbrechen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="quick">
      <button className="tile" disabled={busy} onClick={() => posture('stand')}>
        <span className="tile-title">Jetzt aufstehen</span>
        <span className="tile-sub">{deskReady ? 'Tisch hochfahren' : 'Tisch selbst stellen'}</span>
      </button>
      <button className="tile" disabled={busy} onClick={() => posture('sit')}>
        <span className="tile-title">Jetzt hinsetzen</span>
        <span className="tile-sub">{deskReady ? 'Tisch herunterfahren' : 'Tisch selbst stellen'}</span>
      </button>
      {s.phase === 'movement' ? (
        <button className="tile" onClick={() => void send({ type: 'endMovement' })}>
          <span className="tile-title">Pause beenden</span>
          <span className="tile-sub">zurück an den Tisch</span>
        </button>
      ) : (
        <button className="tile" onClick={() => void send({ type: 'startMovement' })}>
          <span className="tile-title">Bewegungspause</span>
          <span className="tile-sub">{s.settings.routine.movementDurationMinutes} min gehen</span>
        </button>
      )}
      {s.hold === 'user' ? (
        <button className="tile" onClick={() => void send({ type: 'resumeRoutine' })}>
          <span className="tile-title">Fortsetzen</span>
          <span className="tile-sub">Routine weiterführen</span>
        </button>
      ) : (
        <button className="tile" onClick={() => void send({ type: 'pauseRoutine' })}>
          <span className="tile-title">Pausieren</span>
          <span className="tile-sub">keine Hinweise</span>
        </button>
      )}
      <div className="quiet-row">
        {s.quiet ? (
          <button className="secondary wide" onClick={() => void send({ type: 'clearQuiet' })}>
            Ruhemodus beenden{s.quietUntilWall ? ` (bis ${fmtTime(s.quietUntilWall)})` : ''}
          </button>
        ) : quietOpen ? (
          <div className="segmented">
            {[30, 60, 120].map((m) => (
              <button key={m} onClick={() => (void send({ type: 'setQuiet', minutes: m }), setQuietOpen(false))}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </button>
            ))}
            <button onClick={() => (void send({ type: 'setQuiet', minutes: null }), setQuietOpen(false))}>offen</button>
            <button onClick={() => setQuietOpen(false)} aria-label="Schließen">×</button>
          </div>
        ) : (
          <button className="secondary wide" onClick={() => setQuietOpen(true)}>
            Ruhemodus für Meetings …
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- Tisch ----------

const connLabel = { disconnected: 'nicht verbunden', connecting: 'verbinde …', connected: 'verbunden', error: 'Fehler' } as const;

function DeskCard({ s, send }: Ctx) {
  const d = s.desk;
  if (d.mode === 'manual') {
    return (
      <section className="card desk">
        <div className="card-title">Tisch</div>
        <p className="muted">
          Manueller Modus: Der Tisch ist nicht mit der App verbunden. Höhe: <strong>unbekannt</strong>. Du stellst ihn am Bedienteil und
          bestätigst den Wechsel hier.
        </p>
      </section>
    );
  }
  return (
    <section className="card desk sim-stripe">
      <div className="card-title">
        Tisch <span className="badge sim">SIMULATOR</span>
      </div>
      <dl className="kv">
        <dt>Verbindung</dt>
        <dd className={`conn conn-${d.connection}`}>{connLabel[d.connection]}</dd>
        <dt>Höhe</dt>
        <dd>{d.capabilities.positionFeedback ? fmtCm(d.heightMm) : 'unbekannt (keine Rückmeldung)'}</dd>
        <dt>Zielfahrt</dt>
        <dd>{d.targetMoveReady.ok ? 'bereit' : 'gesperrt'}</dd>
      </dl>
      {d.connectionError && <p className="warn-text">{d.connectionError}</p>}
      {!d.targetMoveReady.ok && d.connection === 'connected' && (
        <ul className="reasons">
          {d.targetMoveReady.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        {d.connection === 'connected' ? (
          <button className="secondary" onClick={() => void send({ type: 'disconnectDesk' })}>
            Trennen
          </button>
        ) : (
          <button className="secondary" disabled={d.connection === 'connecting'} onClick={() => void send({ type: 'connectDesk' })}>
            Simulator verbinden
          </button>
        )}
        {d.connection === 'connected' && (
          <button
            className="secondary"
            title="Simuliert eine Fahrt über das Bedienteil am Tisch"
            onClick={() => void send({ type: 'simulateHandsetMove', mm: (d.heightMm ?? 740) < 900 ? 1100 : 740 })}
          >
            Bedienteil-Fahrt simulieren
          </button>
        )}
      </div>
      {d.holdReady.ok && <HoldControls {...{ s, send }} />}
    </section>
  );
}

function HoldControls({ send }: Pick<Ctx, 's' | 'send'>) {
  const beat = useRef<number | null>(null);
  const holding = useRef(false);
  const end = () => {
    if (!holding.current) return;
    holding.current = false;
    if (beat.current) clearInterval(beat.current);
    void send({ type: 'holdEnd' });
  };
  const start = (direction: 'up' | 'down') => {
    holding.current = true;
    void send({ type: 'holdStart', direction });
    beat.current = window.setInterval(() => void send({ type: 'holdHeartbeat' }), 150);
  };
  useEffect(() => {
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('blur', end);
      end();
    };
  }, []);
  const props = (dir: 'up' | 'down') => ({
    onPointerDown: () => start(dir),
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
  });
  return (
    <div className="hold">
      <span className="muted">Gedrückt halten zum Fahren – Loslassen stoppt:</span>
      <div className="actions">
        <button className="secondary" {...props('up')}>▲ Hoch</button>
        <button className="secondary" {...props('down')}>▼ Runter</button>
      </div>
    </div>
  );
}

// ---------- Statistik ----------

function TodayCard({ s }: { s: AppSnapshot }) {
  if (!s.settings.statsEnabled) return null;
  const t = s.today;
  return (
    <section className="card today">
      <div className="card-title">Heute</div>
      <div className="stats">
        <Stat label="Sitzen" value={fmtDuration(t.sittingMs)} />
        <Stat label="Stehen" value={fmtDuration(t.standingMs)} />
        <Stat label="Bewegungspausen" value={String(t.movementBreaksConfirmed)} />
        <Stat label="Bestätigte Wechsel" value={String(t.confirmedSwitches)} />
      </div>
      <p className="footnote">
        Zeiten sind geschätzt: Zeit zwischen deinen bestätigten Wechseln, ohne Pausen. Die App misst keine Körperhaltung.
      </p>
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="stat">
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
  </div>
);

function NotificationHint({ s, send }: Ctx) {
  const n = s.notifications;
  if (n.status !== 'failed' && n.status !== 'unsupported') return null;
  return (
    <section className="banner info">
      <span>
        Systembenachrichtigungen sind nicht verfügbar – Erinnerungen erscheinen stattdessen als kleines Fenster oben rechts.
      </span>
      <button className="link" onClick={() => void send({ type: 'openNotificationSettings' })}>
        Systemeinstellungen
      </button>
    </section>
  );
}

// ---------- Icons ----------

function PhaseIcon({ phase }: { phase: AppSnapshot['phase'] }) {
  const common = { width: 36, height: 36, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (phase === 'standing')
    return (
      <svg {...common} className="phase-icon">
        <circle cx="12" cy="4" r="2" />
        <path d="M12 7v7M12 14l-2.5 7M12 14l2.5 7M8 10.5h8" />
      </svg>
    );
  if (phase === 'sitting')
    return (
      <svg {...common} className="phase-icon">
        <circle cx="9" cy="4" r="2" />
        <path d="M9 7v6h6l1 7M9 10h5M5 21v-8M18 13H6" />
      </svg>
    );
  if (phase === 'movement')
    return (
      <svg {...common} className="phase-icon">
        <circle cx="13" cy="4" r="2" />
        <path d="M11 8l-3 4 3 2-1 7M11 8l3 3 3 1M14 14l2 7" />
      </svg>
    );
  return (
    <svg {...common} className="phase-icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
