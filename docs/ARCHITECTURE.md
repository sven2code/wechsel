# Architektur

## Stack: Electron 45 + TypeScript + React

Geprüft auf dem vorgefundenen System (macOS 26.6, arm64, Node 24, kein Rust, nur Xcode Command Line Tools).

| Kriterium | Electron | Alternativen |
|---|---|---|
| Native Benachrichtigungen | `Notification` mit Knöpfen auf macOS und Windows (offiziell dokumentiert) | Tauri: nicht im Detail geprüft |
| Hintergrundbetrieb, Tray/Menüleiste | `Tray`, `LSUIElement`, Fenster bleiben im Speicher | Swift: nur macOS |
| Suspend/Sperre/Leerlauf | `powerMonitor` auf beiden Plattformen | Tauri: nicht im Detail geprüft |
| Bluetooth/USB für später | Web Bluetooth, WebHID, Web Serial im Chromium; Node-Module | Tauri: Rust-Crates |
| Paketierung | `electron-builder` (dmg/zip, NSIS) | Tauri: Rust-Toolchain fehlt hier |
| Wartbarkeit | ein Stack (TypeScript) für alles, Kern ohne Electron testbar | Swift + C#: zwei Codebasen |

Nachteil: größere App (265 MB entpackt, gemessen auf macOS arm64) und höherer Speicherbedarf als Tauri. Für eine lokal laufende
Einzelnutzer-App wurde das zugunsten belastbarer Plattform-APIs in Kauf genommen.

## Schichten

```
src/shared/       Typen, Standardwerte, IPC-Befehle
src/core/         plattformunabhängig, vollständig mit Fake-Uhr getestet
  clock.ts        monotone Uhr + Wanduhr, Timer-Abstraktion, FakeClock
  routine.ts      Routine-Engine (Phasen, Vorschläge, Pausen) – erzeugt nie Fahrbefehle
  motion.ts       Fahrt-Controller (Countdown, Einzelbefehl, Timeout, Stopp, Invalidierung)
  device/         Geräteadapter-Schnittstelle + Simulator
  controller.ts   verbindet Engine, Fahrten, Erinnerungstexte, Systemereignisse
  settings.ts     Validierung/Normalisierung, Höhenprüfung
  stats.ts        Tagesstatistik (geschätzte Zeiten)
src/main/         Electron: Tray, Fenster, Benachrichtigungen, powerMonitor, Persistenz, Logs
src/preload/      schmale IPC-Brücke (contextIsolation, sandbox)
src/renderer/     React-Oberfläche: Hauptansicht, Einstellungen, Erinnerungsfenster
```

## Zustände

- **Routine** (`RoutineEngine`): `phase` (sitting/standing/movement/unknown), `hold` (user/idle/suspend/lock),
  `outsideHours`, Ruhemodus, höchstens eine offene Erinnerung (`pending`).
  Zeit zählt nur, wenn Phase bestätigt, nichts pausiert und keine Phasenabfrage offen ist.
- **Fahrt** (`MotionController`): idle → countdown → moving → idle/error. Getrennt von der Routine.
- **Gerät** (`DeskAdapter`): Verbindung, Position (oder `null`), Fähigkeiten.

## Zeit

- Dauern ausschließlich über die monotone Uhr (`performance.now()`), nie durch Zählen von Ticks.
- Der Hauptprozess plant per `setTimeout` den nächsten Auswertezeitpunkt (max. 30 s) und berechnet dann alles aus der Uhr.
- Wanduhr nur für Arbeitszeiten und Statistik. Sprünge > 2 min (Zeitumstellung, nicht gemeldeter Ruhezustand)
  verwerfen Fahranfragen und lassen die Phase neu bestätigen.
- Auf macOS läuft die monotone Uhr im Ruhezustand nicht weiter; die Engine pausiert zusätzlich explizit bei `suspend`.

## Sicherheit von Fahrten

Siehe Kommentare in `src/core/motion.ts`. Kurz: nur nach frischem Klick, 5-s-Countdown, Neuprüfung vor Start,
ein Befehl gleichzeitig, Timeout mit Stopp, keine Wiederholung, keine gespeicherten Befehle, Ankunft nur mit
Positionsrückmeldung, Zielfahrt nur mit Stopp + Telemetrie + Sicherheitsbestätigung + gültigen Höhen.

## Datenschutz

Lokal in `~/Library/Application Support/Wechsel` bzw. `%APPDATA%\Wechsel`: `settings.json`, `stats.json`, `logs/`
(7 Tage). Keine Eingaben, Inhalte oder Screenshots; für Inaktivität nur `powerMonitor.getSystemIdleTime()`.
Zugangsdaten werden derzeit nicht benötigt (sonst: Systemschlüsselbund über Electron `safeStorage`).
