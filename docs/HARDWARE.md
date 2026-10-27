# Tischanbindung – Machbarkeit (Stand 27.10.2026)

## Ergebnis

**Für den SANODESK-Tisch ist derzeit kein vom Hersteller freigegebener Steuerungsweg per Computer belegt.**
Die App läuft deshalb im **manuellen Modus** (Timer, Erinnerungen, Bestätigung per Klick) und bietet einen klar
gekennzeichneten **Simulator**. Eine echte Geräteanbindung ist bewusst nicht implementiert.

## Belegt

| Aussage | Quelle |
|---|---|
| SANODESK-Modelle (z. B. EC4, QS1, EP1) werden mit Handbedienteil geliefert: Auf/Ab-Tasten, LED-Höhenanzeige in cm, Speicherplätze 1–4, Kollisionsschutz (laut Handbuchauszügen). | [EC4-Anleitung (manuals.plus)](https://manuals.plus/asin/B0BZYXHRP6), [EC4-Anleitung, 2. Ausgabe](https://manuals.plus/asin/B0C6QKKKZK), [QS1-Anleitung](https://manuals.plus/asin/B0CDLD56H8), [SANODESK-Handbuchübersicht](https://manuals.plus/category/sanodesk) |
| Höhenbereiche unterscheiden sich je Modell und Quelle (z. B. 60–125 cm, 71–117 cm, 73,5–118 cm). Gerätegrenzen müssen daher vom konkreten Tisch kommen. | wie oben |
| Die Support-Seite des Herstellers nennt keine App-, Bluetooth- oder PC-Steuerung. | [sanodesk.net/customer-help](https://sanodesk.net/customer-help/) |
| Electron-Benachrichtigungen mit Knöpfen: macOS nur bei signierter App mit Hinweisstil „alert“; Windows unterstützt Knöpfe. Unsignierte macOS-Builds melden `failed`. | [Electron Notification](https://www.electronjs.org/docs/latest/api/notification), [NotificationAction](https://www.electronjs.org/docs/latest/api/structures/notification-action) |
| `powerMonitor` liefert Leerlaufzeit sowie `suspend`/`resume`/`lock-screen`/`unlock-screen`. | [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor) |

Einschränkung: Die manuals.plus-Seiten verweigerten den direkten Abruf (HTTP 403). Die Angaben oben stammen aus
Suchergebnis-Auszügen dieser Handbücher und sollten mit dem Handbuch des eigenen Tischs abgeglichen werden.

## Nicht belegt / offene Annahmen

- **Bluetooth, WLAN, App:** In keiner gefundenen Quelle für SANODESK erwähnt. Daraus folgt *nicht*, dass es sie nie gibt –
  nur, dass sie für den konkreten Tisch erst nachgewiesen werden müssen.
- **USB am Bedienteil:** Falls vorhanden, ist ohne Herstellerangabe davon auszugehen, dass er nur lädt.
- **Steuerbox-Hersteller:** Eine Quelle stellt einen Bezug zu FlexiSpot her; das ist unbestätigt. Ebenso gibt es
  keinen Beleg, dass SANODESK LINAK-Komponenten nutzt – die [LINAK Desk Control App](https://cdn.linak.com/-/media/files/data-sheet-source/en/control-desk-control-app-data-sheet-eng.pdf)
  funktioniert nur mit LINAK-Adapter und -Bedienteilen und ist hier nicht übertragbar.
- **Verhalten bei Funkverlust oder App-Absturz:** unbekannt. Es gibt keine garantierte Software-Notabschaltung.
  Der Simulator hält bei Verbindungsverlust an – das ist eine Annahme für die Simulation, keine Aussage über echte Hardware.

## Was für eine echte Anbindung fehlt

1. **Typenschild der Steuerbox** (unter der Tischplatte): Hersteller, Modell, Artikelnummer.
2. **Modell des Bedienteils** und Foto der Vorderseite (Tasten, Display, ggf. Bluetooth-/WLAN-Symbol).
3. **Anschlüsse** an Steuerbox und Bedienteil (z. B. RJ45/RJ12, USB, freie Buchse für Zubehör).
4. **Handbuch oder Verpackungsangaben** zu App, Bluetooth oder Zubehör.
5. Darauf aufbauend: **vom Hersteller dokumentierte Schnittstelle oder freigegebenes Zubehör** mit
   Zielfahrt, Stopp, Positionsrückmeldung und Grenzen.

Erst mit 5. kann ein Adapter (`src/core/device/adapter.ts`) implementiert werden – gefolgt von einem separat
freigegebenen, beaufsichtigten Funktionstest. Ohne verlässliches Stoppen bleiben Zielfahrten gesperrt; bietet die
Schnittstelle nur „Taste gedrückt halten“, wird nur Gedrückthalten angeboten.

## Befund am eigenen Tisch (27.10.2026)

Foto des Bedienteils (vom Nutzer):

- Touch-Glasbedienteil mit Aufschrift „SANODESK“. Tasten: ▲, ▼, M (mit Schloss-Symbol, vermutlich Tastensperre),
  Speicher 1 und 2, Stehen-Symbol, Sitzen-Symbol.
- Auf dem Foto ist **kein Bluetooth-, WLAN- oder App-Symbol** und **kein USB-Anschluss** zu sehen. Ob hinter dem
  Glas eine Höhenanzeige liegt, ist im ausgeschalteten Zustand nicht erkennbar.
- An der Steuerbox gibt es laut Nutzer einen **RJ45/RJ12-Anschluss**.

Einordnung: Eine solche Buchse ist üblicherweise die Kabelverbindung zum Bedienteil (proprietärer Bus) und **kein
dokumentierter PC-Anschluss**. Daran eigene Hardware anzuschließen oder das Protokoll mitzulesen wäre Reverse
Engineering bzw. ein elektrischer Eingriff und ist ausgeschlossen. Nutzbar wäre die Buchse nur für **offizielles
Zubehör des Steuerbox-Herstellers**. Solche Bluetooth-Adapter gibt es bei manchen Antriebsherstellern, sie sind aber
an deren eigene Steuerboxen gebunden, z. B. [LINAK](https://lavorodesign.com/wp-content/uploads/2023/02/Bluetooth-Dongle-App-Instructions.pdf),
[TiMOTION (TWD1)](https://pre.timotion.com/_upload/files/DataSheet_TDH11P_EN-B.pdf) und
[BRC](https://manualmachine.com/brc/dpg1b/23180406-user-manual/). Ob eines davon passt, entscheidet allein das
Typenschild der Steuerbox. Ohne diese Angabe ist keine Kompatibilität belegt.

Nächster Schritt: Typenschild der Steuerbox (Hersteller, Modell) ablesen, alternativ beim SANODESK-Support nach
freigegebenem Bluetooth-/App-Zubehör für dieses Bedienteil fragen.

## Ausdrücklich ausgeschlossen

Keine erfundenen Protokolle oder BLE-UUIDs, kein Reverse Engineering der Steuerbox, keine Motoransteuerung,
keine Firmwareänderung, keine elektrischen Umbauten, keine Bewegung während der Geräteerkennung.
