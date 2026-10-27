# Wechsel

Ruhige Desktop-App, die während der Computerarbeit zum Wechsel zwischen Sitzen und Stehen und zu kurzen
Bewegungspausen einlädt. Läuft lokal in der Menüleiste (macOS) bzw. im System-Tray (Windows). Kein Konto, keine
Cloud, keine KI.

| Plattform | Status |
|---|---|
| macOS 26 (arm64) | entwickelt und geprüft (Entwicklungsmodus + ad-hoc signiertes Paket) |
| Windows | **ungetestet** – Code berücksichtigt Windows (Tray, Toasts, Autostart), aber nicht auf Windows ausgeführt |

| Tischmodus | Status |
|---|---|
| Manuell | fertig – du stellst den Tisch selbst und bestätigst per Klick |
| Simulator | fertig – klar gekennzeichnet, inkl. Fehlerfällen, keine Funk-/USB-Ausgabe |
| Echter SANODESK | **nicht verfügbar** – kein freigegebener Steuerungsweg belegt, siehe [docs/HARDWARE.md](docs/HARDWARE.md) |

## Starten

Voraussetzung: Node.js ≥ 22.

```bash
npm install
npm start            # baut und startet die App
npm test             # 43 Tests der Zeit- und Fahrlogik mit kontrollierbarer Uhr
npm run typecheck
```

Hinweis macOS: Im Entwicklungsmodus (`npm start`) ist die App unsigniert, macOS stellt dann keine Mitteilungen zu.
Erinnerungen erscheinen in diesem Fall automatisch als kleines Fenster oben rechts.

## Paketieren

```bash
npm run package:mac      # release/mac-arm64/Wechsel.app (ad-hoc signiert)
npm run package:mac:dmg  # DMG
npm run package:win      # NSIS-Installer – auf Windows ausführen, ungetestet
```

Beim Test der ad-hoc signierten App auf diesem Mac trat – anders als im Entwicklungsmodus – kein Zustellfehler auf;
ob die Mitteilung samt Knöpfen sichtbar ist, bitte selbst prüfen (Einstellungen → Benachrichtigungen → „Test senden“). Für die Weitergabe an andere Macs wäre eine
Developer-ID-Signatur mit Notarisierung nötig. Für Knöpfe direkt in der Mitteilung unter
Systemeinstellungen → Mitteilungen → Wechsel den Stil „Hinweise“ wählen.

## Bedienung

- **Erster Start:** App fragt „Sitzt oder stehst du gerade?“. Erst nach der Antwort läuft die Zeit.
- **Standardroutine:** 30 min Sitzen → Vorschlag 5 min Stehen → Vorschlag Hinsetzen. Stehphase auf Wunsch
  auf 10–15 min erhöhen (Einstellungen). Keine automatische Steigerung. Produktvoreinstellung, kein medizinisch
  belegter optimaler Rhythmus. Einordnung: [CCOHS](https://www.ccohs.ca/oshanswers/ergonomics/office/sit_stand_desk.html),
  [HSE](https://www.hse.gov.uk/msd/dse/work-routine.htm).
- **Bewegungspause:** etwa stündlich 2–3 min. Eine bestätigte Pause setzt den Zähler zurück.
- **Später / Überspringen / Ignorieren:** Später verschiebt nur den Vorschlag. Überspringen behält die Phase und plant
  frühestens nach dem Intervall neu. Unbeantwortet gilt nach 10 min als ignoriert – nie als Zustimmung.
- **Abwesenheit:** Nach 5 min ohne Eingabe, bei Sperre oder Ruhezustand hält die Zeit an. Bei Rückkehr fragt die App
  nach der aktuellen Phase. Es werden keine verpassten Erinnerungen nachgeholt.
- **Ruhemodus** für Meetings (30 min, 1 h, 2 h, offen) über Hauptansicht oder Menüleiste.
- **Statistik:** geschätzte Zeiten zwischen bestätigten Wechseln. Die App misst keine Körperhaltung.

## Simulator ausprobieren

Einstellungen → Tisch → Modus „Simulator“. Dann Sitz- und Stehhöhe eintragen (z. B. 74 / 110 cm) und den
Sicherheitshinweis bestätigen. In der Hauptansicht auf „Simulator verbinden“ klicken. Danach:

- „Jetzt aufstehen“ → 5-s-Countdown (abbrechbar) → Fahrt mit STOPP-Knopf → Stehphase beginnt bei Ankunft.
- Fähigkeiten: *nur Gedrückthalten*, *ohne Höhenrückmeldung*, *ohne Stopp* → Zielfahrten bleiben gesperrt, mit Begründung.
- Fehler: Verbindung schlägt fehl, Abbruch während der Fahrt, Blockade (Timeout), Stopp nicht bestätigt.
- „Bedienteil-Fahrt simulieren“ → App fragt nach, ändert die Phase aber nicht selbst.

## Grenzen

- Keine echte Tischsteuerung (siehe oben).
- Es gibt keine garantierte Software-Notabschaltung. Bei App-Absturz oder Funkverlust hängt das Verhalten vom Tisch ab.
  Der Tisch bleibt immer am eigenen Bedienteil bedienbar.
- Ob macOS Mitteilungen vom Nutzer deaktiviert wurden, lässt sich nicht zuverlässig abfragen. Die App erkennt nur
  Fehler beim Zustellen und weicht dann auf ihr eigenes Fenster aus.
- Windows-Toasts mit Knöpfen, Autostart und Tray sind implementiert, aber ungetestet.
- Keine Kalenderanbindung (Ruhemodus ist manuell).

Weitere Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/HARDWARE.md](docs/HARDWARE.md).

## Hinweise

Kein Medizinprodukt: Die Zeitvorgaben sind anpassbare Produktvoreinstellungen, keine medizinische Empfehlung.
Wer die App mit einem echten Tisch verbindet, ist selbst dafür verantwortlich, dass der Fahrbereich frei ist; die
App erkennt keine Hindernisse. SANODESK ist eine Marke des jeweiligen Inhabers; dieses Projekt steht in keiner
Verbindung zum Hersteller.

Lizenz: [MIT](LICENSE)

## Entwicklungshilfen

`WECHSEL_USER_DATA=<ordner>` nutzt ein separates Datenverzeichnis. `WECHSEL_SCREENSHOT_DIR=<ordner>` legt Screenshots der
Fenster ab (optional `WECHSEL_SCREENSHOT_STEPS`, siehe `src/main/index.ts`). Beides wirkt nur im Entwicklungsmodus.
