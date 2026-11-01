<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Open with: your own apps

Keeper doesn't rebuild maps, weather, calendars or phone apps. It hands things off to the apps you already have. A place opens in Apple Maps on a Mac, a forecast opens in Weather, a Find My device opens in Find My, and an email address opens in your mail app. If Google Maps is installed as an app, places open there instead. Anything that doesn't answer falls back to a web page that always works.

The rules live in `core/native-apps.ts`. That file is pure and covered by tests in `test/native-apps.test.ts`. The main process (`electron/services/native-apps.ts`) looks for the apps and opens them. Every page calls the same IPC, `native.open(kind, params)`, through `openNative()` in `src/lib/native.ts`, so every page follows the setting.

## The setting

**Settings → Open with** has one row for each kind that has more than one choice on this computer:

- **Automatic** opens the first app found, in the order in the tables below. That's the system's own app, unless Google Maps is installed as an app.
- **An app found on this computer**, by name.
- **A web page** (Google Maps, OpenStreetMap, Gmail and so on).

Keeper looks for apps the first time a kind is used and remembers what it found. It checks a few files and asks the system which app answers a link scheme (Launch Services, the registry, or xdg-mime). Nothing runs on a timer. **Look for apps again** in Settings clears what was remembered. If the chosen app fails to open, Keeper tries the next one, and the web page comes last.

## Kinds

Links marked † are documented by the vendor. The others are long-established bundle ids or desktop ids. Where one is less certain, the table says so.

### Maps (show a place, directions)

| System | In preference order |
|---|---|
| macOS | Google Maps app (Chrome, Edge or Safari web app in `~/Applications/Chrome Apps.localized`, `~/Applications/Edge Apps.localized`, `~/Applications` or `/Applications`; opened with `open -a <app> <url>`) · Apple Maps `maps://?q=…&ll=lat,lon`, `maps://?daddr=…&dirflg=d/w/r` † · Google Maps on the web · OpenStreetMap |
| Windows | Google Maps app (Start menu shortcut, including Chrome Apps; the link goes to the default browser, which opens the app when it captures links) · Windows Maps `bingmaps:?cp=lat~lon&lvl=16&collection=point.lat_lon_name`, `bingmaps:?rtp=~pos.lat_lon` † (Windows Maps is being retired; if nothing answers `bingmaps:`, it is skipped) · Google Maps on the web · OpenStreetMap |
| Linux | Google Maps web app (a browser's `.desktop` file named Google Maps) · whatever answers `geo:lat,lon?q=lat,lon(name)` (GNOME Maps, Marble; no directions, so directions go to the web) · Google Maps on the web · OpenStreetMap |

Web: `https://www.google.com/maps/search/?api=1&query=…` and `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=…` †.

### Weather

| System | Apps |
|---|---|
| macOS | Weather (`open -b com.apple.weather`; it takes no place in a link) |
| Windows | MSN Weather `msnweather://forecast?la=…&lo=…` † |
| Linux | GNOME Weather (`gtk-launch org.gnome.Weather`) |
| Web | `https://weather.com/weather/today/l/lat,lon` |

### Find My

macOS: Find My (`open -b com.apple.findmy`). Find My has no public link for a single device, so the app opens on its own list. Everywhere else, and as the fallback: `https://www.icloud.com/find`.

### Calendar (an event or a day)

| System | Apps |
|---|---|
| macOS | Calendar. An event from the Mac's own calendar opens itself with `ical://ekevent/<id>?method=show&options=more`. Anything else opens Calendar (`open -b com.apple.iCal`), which takes no date in a link. |
| Windows | Outlook (`outlookcal:`). The old Calendar app was retired in 2024. |
| Linux | GNOME Calendar (`org.gnome.Calendar`), KOrganizer (`org.kde.korganizer`) |
| Web | Google Calendar, `https://calendar.google.com/calendar/r/day/Y/M/D` |

### Email, messages and calls

| Kind | macOS | Windows | Linux | Web |
|---|---|---|---|---|
| Email | `mailto:` (your mail app) | `mailto:` | `mailto:` when something answers it | Gmail compose, Outlook on the web compose |
| Messages | Messages: `sms:<number>`, `imessage:<address>`, else `open -b com.apple.MobileSMS` | whatever answers `sms:` (Phone Link when set up) | whatever answers `sms:` | Google Messages |
| Calls | FaceTime: `tel:`, `facetime:`, `facetime-audio:` | whatever answers `tel:` (Phone Link) | whatever answers `tel:` | none |

If nothing on the computer can make a call, the number is copied to the clipboard.

### The rest

| Kind | macOS | Windows | Linux | Web |
|---|---|---|---|---|
| Contacts | Contacts (`com.apple.AddressBook`) | People (`ms-people:`, if it is still installed) | GNOME Contacts | iCloud / Google Contacts |
| Notes | Notes (`com.apple.Notes`) | none | none | iCloud Notes / OneNote / Google Keep |
| Reminders | Reminders (`com.apple.reminders`) | none | none | iCloud Reminders / Microsoft To Do |
| Music | Music (`com.apple.Music`), Spotify (`spotify:search:…`) | Spotify | Spotify | Apple Music / Spotify |
| Photos | Photos (`com.apple.Photos`) | Photos (`ms-photos:`) | none | iCloud / Google Photos |
| Clock | Clock (`com.apple.clock`, macOS 13 and later) | Clock (`ms-clock:`) | GNOME Clocks | time.is |
| Settings | `x-apple.systempreferences:…` | `ms-settings:…` | `gnome-control-center <panel>` | none |

## Where it is used

- **Weather page and the Island**: Open in Weather, and Show on map. Click the Island's weather tile, or double-click a weather widget.
- **Places & Tracks**: Open in Maps and Directions for timeline stays, saved and frequent places, trips (the middle of the trip's area) and live positions. Find My devices and people also get Open in Find My.
- **Photo location** in Quick Look, and the **Coordinates** tool.
- **Calendar**: Open in Calendar and Show on map in the event window and the Island's agenda. Event locations in a previewed `.ics` file open in Maps.
- **Contact cards** (`.vcf` previews): phone numbers call, email addresses open a new email, and street addresses open in Maps.
- **Command palette**: Open the Weather App, Show the weather place on a map, Open Find My (Mac), Open Today in the Calendar App, Open the Contacts App, Open the Clock App, Open With settings. Places & Tracks adds "Open … in Find My" for Find My devices and "Show … in Maps" for other live positions.

## Safety

The interface sends only a kind and plain fields. `cleanParams` drops anything malformed. Coordinates must be in range. Event links must start with `ical://`, `outlookcal:` or `https://`. Settings pages must look like `x-apple.systempreferences:…`, `ms-settings:…` or a plain panel name. Commands come only from the registry: `open`, `gtk-launch` and `gnome-control-center`, with fixed arguments.

## Not tested on real hardware

These were built and unit-tested on Linux. On macOS and Windows they rely on documented behaviour, and if an app doesn't answer, Keeper falls back to the web:

- Opening a Chrome or Edge Google Maps web app with a link (`open -a`) on a Mac. If the app ignores the link it still opens, just at its start page.
- Phone Link answering `sms:` and `tel:` on Windows.
- `ms-people:` on current Windows 11, where People has been folded into Outlook.
