import { useEffect, useState, type ReactNode } from 'react';
import type { DeepPartial } from '../core/settings';
import { ALLOWED_LINKS } from '../shared/ipc';
import type { Settings, SimulatorSettings } from '../shared/types';
import type { Ctx } from './App';
import { fmtCm } from './format';

const DAYS = [
  [1, 'Mo'],
  [2, 'Di'],
  [3, 'Mi'],
  [4, 'Do'],
  [5, 'Fr'],
  [6, 'Sa'],
  [0, 'So'],
] as const;

export function SettingsView(ctx: Ctx & { onBack: () => void }) {
  const { s, send } = ctx;
  const st = s.settings;
  const update = (patch: DeepPartial<Settings>) => void send({ type: 'updateSettings', patch });
  const r = st.routine;

  return (
    <div className="app">
      <header className="titlebar">
        <button className="link back" onClick={ctx.onBack}>‹ Zurück</button>
        <div className="brand">Einstellungen</div>
        <span />
      </header>
      <main className="content settings">
        {ctx.error && (
          <div className="banner warn" role="alert">
            <span>{ctx.error}</span>
            <button className="link" onClick={ctx.clearError}>OK</button>
          </div>
        )}

        <Section title="Routine">
          <p className="footnote">
            Vorsichtiger Einstieg: 30 Minuten Sitzen, 5 Minuten Stehen. Wenn es angenehm ist, kannst du die Stehphase auf 10–15 Minuten
            erhöhen – die App steigert nichts automatisch. Das ist eine Produktvoreinstellung, kein medizinisch belegter optimaler Rhythmus.
            Bei Unwohlsein jederzeit zurückwechseln.
          </p>
          <NumberField label="Sitzphase" unit="min" value={r.sitMinutes} min={5} max={240} onCommit={(v) => update({ routine: { sitMinutes: v } })} />
          <NumberField label="Stehphase" unit="min" value={r.standMinutes} min={1} max={120} onCommit={(v) => update({ routine: { standMinutes: v } })} />
          <div className="presets">
            {[5, 10, 15].map((m) => (
              <button key={m} className={r.standMinutes === m ? 'chip active' : 'chip'} onClick={() => update({ routine: { standMinutes: m } })}>
                {m} min stehen
              </button>
            ))}
          </div>
          <NumberField label="„Später“ verschiebt um" unit="min" value={r.snoozeMinutes} min={1} max={60} onCommit={(v) => update({ routine: { snoozeMinutes: v } })} />
          <NumberField
            label="Unbeantwortet gilt als ignoriert nach"
            unit="min"
            value={r.reminderTimeoutMinutes}
            min={1}
            max={60}
            onCommit={(v) => update({ routine: { reminderTimeoutMinutes: v } })}
          />
          <NumberField
            label="Anhalten nach Inaktivität"
            unit="min"
            value={r.idleThresholdMinutes}
            min={1}
            max={60}
            onCommit={(v) => update({ routine: { idleThresholdMinutes: v } })}
          />
          <p className="footnote">
            Grundlagen zur Einordnung (die konkreten Werte sind unsere anpassbare Umsetzung):{' '}
            <button className="link" onClick={() => void send({ type: 'openLink', url: ALLOWED_LINKS[0] })}>CCOHS – Sit/Stand Desk</button>
            {' · '}
            <button className="link" onClick={() => void send({ type: 'openLink', url: ALLOWED_LINKS[1] })}>HSE – Work routine and breaks</button>
          </p>
        </Section>

        <Section title="Bewegungspausen">
          <Toggle label="Bewegungspausen vorschlagen" checked={r.movementEnabled} onChange={(v) => update({ routine: { movementEnabled: v } })} />
          <NumberField label="Etwa alle" unit="min" value={r.movementIntervalMinutes} min={15} max={240} onCommit={(v) => update({ routine: { movementIntervalMinutes: v } })} />
          <NumberField label="Dauer" unit="min" value={r.movementDurationMinutes} min={1} max={15} onCommit={(v) => update({ routine: { movementDurationMinutes: v } })} />
          <NumberField label="„Später“ verschiebt um" unit="min" value={r.movementSnoozeMinutes} min={1} max={60} onCommit={(v) => update({ routine: { movementSnoozeMinutes: v } })} />
          <p className="footnote">Bloßes Stehen ersetzt keine Bewegung, und eine Tischfahrt beweist keine Bewegungspause.</p>
        </Section>

        <Section title="Arbeitszeiten">
          <Toggle label="Nur innerhalb der Arbeitszeit erinnern" checked={st.schedule.enabled} onChange={(v) => update({ schedule: { enabled: v } })} />
          <div className="days">
            {DAYS.map(([d, label]) => {
              const on = st.schedule.days.includes(d);
              return (
                <button
                  key={d}
                  className={on ? 'chip active' : 'chip'}
                  aria-pressed={on}
                  onClick={() => update({ schedule: { days: on ? st.schedule.days.filter((x) => x !== d) : [...st.schedule.days, d] } })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="row">
            <label>
              Von <input type="time" value={st.schedule.start} onChange={(e) => e.target.value && update({ schedule: { start: e.target.value } })} />
            </label>
            <label>
              bis <input type="time" value={st.schedule.end} onChange={(e) => e.target.value && update({ schedule: { end: e.target.value } })} />
            </label>
          </div>
        </Section>

        <DeskSection {...ctx} update={update} />

        <Section title="Benachrichtigungen">
          <Select
            label="Erinnerungen anzeigen als"
            value={st.notifications.style}
            options={[
              ['native', 'Systembenachrichtigung'],
              ['window', 'Kleines App-Fenster'],
              ['both', 'Beides'],
            ]}
            onChange={(v) => update({ notifications: { style: v as Settings['notifications']['style'] } })}
          />
          <p className="footnote">
            Status:{' '}
            {{ unknown: 'noch nicht geprüft', ok: 'funktioniert', failed: 'nicht verfügbar', unsupported: 'vom System nicht unterstützt' }[s.notifications.status]}
            {s.notifications.detail ? ` (${s.notifications.detail})` : ''}. Fehlen Systembenachrichtigungen, erscheint automatisch das kleine
            App-Fenster.
          </p>
          {s.platform === 'darwin' ? (
            <p className="footnote">
              macOS: Systemeinstellungen → Mitteilungen → Wechsel → „Mitteilungen erlauben“. Für Knöpfe direkt in der Mitteilung den Stil
              „Hinweise“ wählen. Ohne Code-Signatur zeigt macOS keine Mitteilungen dieser App – dann gilt das App-Fenster.
            </p>
          ) : (
            <p className="footnote">Windows: Einstellungen → System → Benachrichtigungen → Wechsel aktivieren. Fokus-Assist kann Meldungen unterdrücken.</p>
          )}
          <div className="actions">
            <button className="secondary" onClick={() => void send({ type: 'testNotification' })}>Test senden</button>
            <button className="secondary" onClick={() => void send({ type: 'openNotificationSettings' })}>Systemeinstellungen öffnen</button>
          </div>
        </Section>

        <Section title="Darstellung & Start">
          <Select
            label="Erscheinungsbild"
            value={st.appearance.theme}
            options={[
              ['system', 'Wie System'],
              ['light', 'Hell'],
              ['dark', 'Dunkel'],
            ]}
            onChange={(v) => update({ appearance: { theme: v as Settings['appearance']['theme'] } })}
          />
          <Toggle label="Beim Anmelden automatisch starten" checked={st.autostart} onChange={(v) => update({ autostart: v })} />
          {!s.packaged && <p className="footnote">Hinweis: Autostart wird nur in der gepackten App eingerichtet, nicht im Entwicklungsmodus.</p>}
        </Section>

        <Section title="Daten & Datenschutz">
          <p className="footnote">
            Alles bleibt lokal auf diesem Rechner: kein Konto, keine Cloud. Für die Inaktivität wird nur die Leerlaufdauer des Systems
            abgefragt – keine Tastatureingaben, Screenshots oder Fensterinhalte. Protokolle werden nach 7 Tagen gelöscht.
          </p>
          <Toggle label="Tagesstatistik speichern" checked={st.statsEnabled} onChange={(v) => update({ statsEnabled: v })} />
          <div className="actions">
            <button className="secondary" onClick={() => void send({ type: 'exportData' })}>Als JSON exportieren</button>
            <button className="secondary" onClick={() => void send({ type: 'openLogs' })}>Protokolle öffnen</button>
            <button className="danger" onClick={() => void send({ type: 'deleteData' })}>Alle Daten löschen</button>
          </div>
        </Section>
      </main>
    </div>
  );
}

function DeskSection({ s, send, update }: Ctx & { update: (p: DeepPartial<Settings>) => void }) {
  const d = s.settings.desk;
  const live = s.desk;
  const sim = d.simulator;
  const updSim = (p: Partial<SimulatorSettings>) => update({ desk: { simulator: p } });
  return (
    <Section title="Tisch">
      <Select
        label="Modus"
        value={d.mode}
        options={[
          ['manual', 'Manuell – ich stelle den Tisch selbst'],
          ['simulator', 'Simulator – zum Ausprobieren, keine Hardware'],
        ]}
        onChange={(v) => update({ desk: { mode: v as Settings['desk']['mode'] } })}
      />
      <div className="banner info">
        <span>
          <strong>Echte Tischsteuerung: noch nicht verfügbar.</strong> Für deinen SANODESK ist bisher kein vom Hersteller freigegebener
          Steuerungsweg (Bluetooth, USB, App) belegt. Sobald Modell und Bedienteil geklärt sind, wird das geprüft.
        </span>
      </div>

      <div className="subhead">Gespeicherte Höhen</div>
      <p className="footnote">
        Stelle die Höhen am Tisch ein und übernimm sie hier. Die App berechnet keine Höhe aus der Körpergröße.
      </p>
      <HeightField label="Sitzhöhe" value={d.sitMm} onCommit={(v) => update({ desk: { sitMm: v } })} />
      <HeightField label="Stehhöhe" value={d.standMm} onCommit={(v) => update({ desk: { standMm: v } })} />
      {live.capabilities.positionFeedback && live.heightMm !== null && (
        <div className="actions">
          <button className="secondary" onClick={() => void send({ type: 'captureHeight', which: 'sit' })}>
            Aktuelle Höhe ({fmtCm(live.heightMm)}) als Sitzhöhe
          </button>
          <button className="secondary" onClick={() => void send({ type: 'captureHeight', which: 'stand' })}>
            … als Stehhöhe
          </button>
        </div>
      )}
      <HeightField label="Persönliche Mindesthöhe (optional)" value={d.personalMinMm} onCommit={(v) => update({ desk: { personalMinMm: v } })} />
      <HeightField label="Persönliche Höchsthöhe (optional)" value={d.personalMaxMm} onCommit={(v) => update({ desk: { personalMaxMm: v } })} />
      {live.limits && <p className="footnote">Gerätebereich laut Rückmeldung: {fmtCm(live.limits.minMm)} – {fmtCm(live.limits.maxMm)}</p>}

      <label className="check">
        <input type="checkbox" checked={d.safetyAcknowledged} onChange={(e) => update({ desk: { safetyAcknowledged: e.target.checked } })} />
        <span>
          Ich halte den Fahrbereich frei (Stühle, Rollcontainer, Kabel, Personen, Haustiere). Die App erkennt keine Hindernisse; der
          Kollisionsschutz des Tischs bleibt unverändert aktiv. Der Tisch bleibt am eigenen Bedienteil bedienbar.
        </span>
      </label>

      {d.mode !== 'manual' && (
        <>
          <div className="subhead">Zielfahrt-Voraussetzungen</div>
          {live.targetMoveReady.ok ? (
            <p className="ok-text">Alle Prüfungen bestanden – Zielfahrten mit 5-s-Countdown sind freigeschaltet.</p>
          ) : (
            <ul className="reasons">
              {live.targetMoveReady.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {d.mode === 'simulator' && (
        <>
          <div className="subhead">Simulator</div>
          <NumberField label="Fahrgeschwindigkeit" unit="mm/s" value={sim.speedMmPerS} min={5} max={200} onCommit={(v) => updSim({ speedMmPerS: v })} />
          <Select
            label="Fähigkeiten"
            value={sim.profile}
            options={[
              ['full', 'Voll: Zielfahrt, Stopp, Höhenrückmeldung'],
              ['holdOnly', 'Nur Gedrückthalten (keine Zielfahrt)'],
              ['noTelemetry', 'Ohne Höhenrückmeldung'],
              ['noStop', 'Ohne zuverlässigen Stopp'],
            ]}
            onChange={(v) => updSim({ profile: v as SimulatorSettings['profile'] })}
          />
          <Select
            label="Fehler simulieren"
            value={sim.failure}
            options={[
              ['none', 'Keiner'],
              ['connectFails', 'Verbindung schlägt fehl'],
              ['disconnectDuringMove', 'Verbindungsabbruch während der Fahrt'],
              ['stall', 'Tisch blockiert (Zeitüberschreitung)'],
              ['stopIgnored', 'Stopp wird nicht bestätigt'],
            ]}
            onChange={(v) => updSim({ failure: v as SimulatorSettings['failure'] })}
          />
          <p className="footnote">Änderungen am Simulator trennen die simulierte Verbindung. Der Simulator sendet nichts über Bluetooth, USB oder Netzwerk.</p>
        </>
      )}
    </Section>
  );
}

// ---------- Formularbausteine ----------

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card settings-section">
    <div className="card-title">{title}</div>
    {children}
  </section>
);

function NumberField(p: { label: string; unit: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(p.value));
  useEffect(() => setText(String(p.value)), [p.value]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n >= p.min && n <= p.max) p.onCommit(Math.round(n));
    else setText(String(p.value));
  };
  return (
    <label className="field">
      <span>{p.label}</span>
      <span className="input-unit">
        <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        <span>{p.unit}</span>
      </span>
    </label>
  );
}

function HeightField(p: { label: string; value: number | null; onCommit: (mm: number | null) => void }) {
  const toText = (v: number | null) => (v === null ? '' : (v / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 }));
  const [text, setText] = useState(toText(p.value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(toText(p.value)), [p.value]);
  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      return p.onCommit(null);
    }
    const cm = Number(text.replace(',', '.'));
    if (!Number.isFinite(cm) || cm < 40 || cm > 160) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    p.onCommit(Math.round(cm * 10));
  };
  return (
    <label className="field">
      <span>{p.label}</span>
      <span className="input-unit">
        <input
          inputMode="decimal"
          aria-invalid={invalid}
          placeholder="—"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span>cm</span>
      </span>
    </label>
  );
}

const Toggle = (p: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="toggle">
    <span>{p.label}</span>
    <input type="checkbox" role="switch" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
  </label>
);

const Select = (p: { label: string; value: string; options: (readonly [string, string])[]; onChange: (v: string) => void }) => (
  <label className="field column">
    <span>{p.label}</span>
    <select value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      {p.options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </label>
);
