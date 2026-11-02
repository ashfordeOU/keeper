# Places & Tracks

One private place to see where your things, people and activities have been: a timeline (day, week, month, year), trips built by themselves, maps, live positions and activities with their numbers. Everything stays on your computer.

- Page: **Places & Tracks** in the sidebar (under Weather). Tabs: Timeline, Trips, Activities, Live, Places, Sources, Settings.
- Elsewhere, each one optional under *Places & Tracks → Settings → Where it appears*:
  - **Command palette**: "Places & Tracks", "Trips", "Activities", "Import Tracks…", "When Was I Last In…", and one "Where Is My …?" per device, item and person.
  - **File browser**: right-click a GPX, FIT, TCX, KML/KMZ, GeoJSON file or a photo → **Show on Map** (read without keeping it; *Add to Places & Tracks* keeps it).
  - **Tray / menu bar**: *Where Things Are* lists devices, items and people with place, last-seen time and battery.
  - **Island**: "Arriving" (someone marked as you, or a phone, moving towards home) and "Workout running" (your own tracker at running or riding pace, shown against your usual time).
  - **Sidebar**: the page itself.
- Features (Settings → Features): `tracks` (on; does nothing until you add a source or import a file), `tracksLive` (off; every live receiver needs it), `tracksServices` (off; Strava, Polar, Fitbit).
- Command line (asks the running app; your locations stay encrypted inside it):
  ```
  keeper tracks import <file>…
  keeper tracks list
  keeper tracks export --from 2026-05-01 --to 2026-05-31 --format gpx [--out file.gpx]
  keeper tracks where <device>
  ```

## Sources

Every source has its own switch and starts **off**. Live receivers also need the *live sharing* feature.

| Source | What it gives | Platforms | How | Needs |
|---|---|---|---|---|
| Files you import | Tracks, visits, raw positions, photos, bookings | macOS, Windows, Linux | GPX 1.0/1.1 (tracks, routes, timed waypoints, Garmin TrackPointExtension), KML/KMZ (gx:Track, LineString with TimeSpan, timed Point), GeoJSON (LineString/MultiLineString with `coordTimes`, timed Points), TCX (activities, courses), FIT (own reader: file_id, session, record incl. compressed timestamps), Google Timeline (on-device export from Android and iPhone, Takeout Semantic Location History, Records.json), Apple Health `export.zip` (HKWorkout + `workout-routes/*.gpx`), photos (EXIF GPS), booking mails (`.eml`/`.html` with JSON-LD) | – |
| Watched folders | New FIT, GPX and TCX files | macOS, Windows, Linux | Looks every 15 min (through the governor, paused when locked) | – |
| Photos | Where and when photos were taken | macOS, Windows, Linux | Reads the first 256 KB of each new photo in the folders you choose, every 6 h | – |
| Find My (Mac cache) | Your Apple devices and items as Find My last cached them | macOS 10.15–14.3 only (not available on 14.4 and later) | Reads `~/Library/Caches/com.apple.findmy.fmipcore/{Items,Devices}.data` every 10 min | live sharing |
| OwnTracks (HTTP) | Live positions from the OwnTracks app | macOS, Windows, Linux | Built-in receiver, `POST /owntracks`, HTTP Basic with the receiver token as password | live sharing |
| OwnTracks (MQTT) | Live positions through your own broker | macOS, Windows, Linux | MQTT 3.1.1 subscriber (own small client), TLS optional, reconnects with back-off | live sharing |
| GPS trackers (OsmAnd protocol) | Live positions from trackers, Traccar Client, OsmAnd | macOS, Windows, Linux | Same receiver, `/osmand?id=…&lat=…&lon=…&token=…` (query, form or Traccar Client JSON) | live sharing |
| Traccar server | Devices and positions from your own server | macOS, Windows, Linux | REST `GET /api/devices`, `/api/positions`, every minute | live sharing |
| Phone companion | Your phone’s position while Keeper’s companion page is open and its location switch is on | Any phone browser | Link companion op `tracks.position` | live sharing |
| Your paired devices (Link) | Where your other Keeper devices are, when each has turned on *Share my location* for this one | macOS, Windows, Linux | Keeper Link `pairedPositions()` (`loc.get`), through the governor: every minute while the Live view is open, every 10 min when the tray or Island shows positions, not at all otherwise | live sharing |
| Strava | Activities with GPS streams, saved routes | macOS, Windows, Linux | Strava API v3 with **your own** API app (OAuth, loopback redirect), every 6 h | services |
| Polar Flow | Exercises with GPS routes | macOS, Windows, Linux | Polar AccessLink v3 with your own client (`/v3/exercises`, `/gpx`) | services |
| Fitbit | Activities with GPS as TCX | macOS, Windows, Linux | Fitbit Web API with your own app (PKCE), activity log + `.tcx` | services |
| Calendar | Events with a place, on the timeline and in trips | macOS, Windows, Linux | Keeper’s calendar service (`pim.occurrences`), read-only | Calendar feature |
| Booking mails | Flights, hotels, events, car hire, trains | macOS, Windows, Linux | Keeper’s mail service, read-only, every 6 h; schema.org JSON-LD | Mail set up in Keeper |

### What each service allows (honestly)

- **Strava**: the public API v3 needs an API application you create at strava.com/settings/api; Keeper uses your client ID and secret (kept in the keychain), asks for `read,activity:read_all`, and fetches activities, streams and routes. Strava’s terms limit how API data may be shown and shared; it stays on your computer here.
- **Garmin Connect**: its API is only for approved business partners. Keeper does **not** scrape Garmin Connect. Use the Garmin data export, or watch the `GARMIN/Activity` folder of a watch plugged in by USB, or the folder your export goes to: FIT and GPX files come in through *Watched folders*.
- **Polar AccessLink**: open to anyone who registers a client at admin.polaraccesslink.com. Keeper registers your account with AccessLink once after sign-in, then reads exercises from the last 30 days (the API keeps no longer history).
- **Suunto**: the Suunto API is partner-only. Export FIT/GPX from the Suunto app and import them, or use a watched folder.
- **Fitbit Web API**: register a "personal" app at dev.fitbit.com; Keeper uses PKCE. GPS comes as TCX per activity.
- **Komoot**: no public API for people. Export GPX from komoot and import it (planned routes come in as planned).
- **Wahoo**: the Wahoo cloud API needs an approved developer app; bike computers write FIT files you can export, sync to a folder, or import.
- **Google Timeline**: Google moved Timeline onto phones in 2024. On Android: Settings → Location → Location services → Timeline → Export Timeline data (a `Timeline.json` with `semanticSegments`, `rawSignals`, `userLocationProfile`). On iPhone (Google Maps → Your Timeline → ⋯ → Export) the file is an array with `geo:` points. Older Takeout exports (Semantic Location History per month, Records.json) still import.
- **Apple Health**: Health → your picture → Export All Health Data gives `export.zip`. Keeper scans `export.xml` for `<Workout>` blocks (not a full XML tree, so large exports work) and joins `workout-routes/*.gpx`. Exports are unpacked in memory, so a single `export.zip` must be under 1 GB.
- **Find My on a Mac**: see below.
- **OwnTracks, OsmAnd/Traccar protocol, Traccar**: open protocols and your own server; nothing goes through anyone else.

### Find My on a Mac: what works on which macOS

| macOS | `Items.data` / `Devices.data` | What Keeper does |
|---|---|---|
| 10.15 – 14.3 | Plain JSON, readable by your own account (macOS may ask for Full Disk Access, because it is another app’s cache) | Reads items (AirTags and other Find My items) and devices with place, accuracy, time, address and battery, every 10 minutes while live sharing and the source are on. Only as fresh as the last time the Find My app was open. |
| 14.4 and later | Encrypted by macOS with a key in the system keychain that only Apple’s own apps may use | The source shows as “Not available on this version of macOS”, with no switch, and Keeper does not read the files at all. It does **not** look for or use that key, and does not decrypt the files. Apple offers no other way in (there is no public Find My API). The row offers what works instead: **Open Find My**, and **Share your phone’s location with Keeper** (OwnTracks, the phone companion or a GPS tracker). |

Keeper decides by the macOS version (Darwin 23.4 = macOS 14.4) and, on older systems, by the content of the file (JSON or not).

A source that needs a feature switch (live sharing, sports services) shows a one-click **Turn on …** in its row, with what that starts, instead of pointing to Settings → Features.

## The timeline, places and trips

- **Stays** come from imported visits (Google) and from raw positions: points in time order that stay within 120 m for at least 10 minutes (a DBSCAN-like pass; one stray fix or a fix less precise than 250 m does not end a stay); stays 150 m and 45 minutes apart are joined.
- **Moves** are imported activity segments, or the points between two stays. The way of travel comes from speed and distance: walk below 2.2 m/s, ride below 7 m/s, drive above, flight above 55 m/s over more than 80 km.
- **Places**: name a stay (Home, Work, Gym…), edit its radius, merge several. Places you go often are listed with visits and time spent. Google’s HOME/WORK labels become Home and Work when you have not named them yourself.
- **Trips** are found by themselves: a run of stays more than 50 km (setting) from home that lasts at least 18 hours. Each has a day-by-day itinerary, a map, distance, flights, drives, photos, countries, calendar events and bookings, *Print summary* (a plain HTML page) and GPX export.
- **Search**: "when was I last in Tallinn" matches names (yours, Google’s, looked-up names) and country names; with *Look up names* on, it asks Nominatim where an unknown place is and looks within 25 km.
- **Countries** come from Keeper’s offline Natural Earth outline (point in outline, else nearest coast or border point; outlines are rounded to 0.1°, so a spot right at a border or coast can be put in the neighbour). With *Look up names* on, Nominatim’s country wins.
- **Names** (optional, off by default): reverse geocoding through a Nominatim server you choose (default nominatim.openstreetmap.org), one request a second at most, at most 60 per pass, every answer kept, with a User-Agent naming Keeper. Turning it on sends the coordinates of your stays to that server.

## Activities

List with distance, time, pace or speed, climb and heart rate; a detail page with the map coloured by speed, height or heart rate, height/heart-rate/speed charts (Keeper’s own chart component), splits per kilometre; personal records (best 1 km, 5 km, 10 km, half and full marathon for runs; 10/40/100 km for rides; longest; most climbing); a heatmap of every activity; compare two (side by side, with the gap at each kilometre).

Moving time counts gaps of up to two minutes where speed is above 0.5 m/s; climb ignores changes under 3 m (hysteresis).

## Map

- **Offline by default**: Keeper’s world outline. **Online map** (setting, or the link on the map) loads raster tiles from an OpenStreetMap-compatible tile server; you can set your own server and credit line.
- The OpenStreetMap tile usage policy is followed: tiles are fetched by Keeper’s main process with a User-Agent that names Keeper, cached on disk for 7 days (200 MB at most, oldest first), only for what you look at (no prefetching), and the © OpenStreetMap contributors credit is shown. After six failures in a row Keeper stops asking for a minute. Heavy use should go to your own tile server.
- Tracks are SVG polylines coloured by speed, height or heart rate (5th–95th percentile, so one GPS spike does not wash out the colours); markers are clustered per 40 px cell; the heatmap is drawn on a canvas.
- Dark mode darkens the tiles (a filter) and the outline follows the theme.
- Tests use a stub tile server: `KEEPER_TRACKS_TILE_URL` is honoured **only by unofficial builds** (`__KEEPER_OFFICIAL__` false).

## Privacy

- Everything stays on your computer. Nothing is uploaded; the only network requests are the ones a source you switched on needs (your broker, your Traccar server, the services you connected), map tiles when the online map is on, and names when *Look up names* is on.
- **At rest**: locations, tracks, places and zones are in `<profile>/tracks/data.bin`, gzip then AES-256-GCM with a random 32-byte key that the system keychain holds (Electron `safeStorage`, the same pattern Keeper Link uses). On a Linux desktop without a keyring Electron can only offer a fixed key, which is no protection; Keeper then stores the data **compressed but not encrypted** and says so at the top of the page. Settings (no locations) are in `tracks/config.json`; passwords, client secrets and service tokens are in the keychain.
- **Privacy zones**: home and work (at least 200 m) plus any you add. Nothing inside a zone is ever exported (GPX, KML, GeoJSON, CSV); tracks are cut where they enter a zone, so no line crosses the hidden part. *Save a copy* (backup) is yours and keeps everything.
- **Each source is its own switch**; the live receivers are off by default and need the *live sharing* feature too. The HTTP receiver listens on this computer only unless you allow your local network, and every request needs its token.
- **One switch deletes everything**: Settings → *Delete everything* stops the receivers, deletes `tracks/` (data, settings, cached tiles) and every Places & Tracks secret in the keychain.
- **To do**: when location history from at least one source exists and no copy was saved in 60 days, the To do list says "Location history from N sources isn’t backed up".
- The keeper command and AI agents reach it only through `keeper/tracks` on Keeper’s local socket, while Places & Tracks is on.

## Idle cost

Nothing runs while no source is on: no timers, no sockets, and the data file is not even read (the sidebar, palette and tray use a call that reads only the small settings file). Each check goes through the governor (`poll`, paused while the screen is locked, slower when you are away) and stops when its feature is switched off. The MQTT client keeps one connection with a ping every 50 s only while that source is on.

## Integration notes (for other parts of Keeper)

- **Keeper Link** (`electron/services/link/location.ts`): Places & Tracks reads paired devices with `pairedPositions()` and gives Link this device’s own position through `setOwnPositionSource()`: the newest of the companion phone and the live sources you marked as you (last 30 minutes), else your Home place. It answers only while live sharing and *Your paired devices* are on; Link itself answers a device only when *Share my location* is on for it, and logs each answer.
- **Phone companion**: the companion page sends `tracks.position` (`{lat, lon, acc, t, battery}`) while its location switch is on; Keeper takes it only while live sharing and *Phone companion* are on.
- **Mail**: the mail service has a read-only `structuredData(id)` (in `electron/services/pim/index.ts`) that returns a message’s raw `<script type="application/ld+json">` blocks, which the sanitised view drops. Booking mail is searched (reservation, booking, confirmation, itinerary, boarding; 40 messages each) every 6 hours only when a mail account is set up and *Booking mails* is on; nothing is marked read. Importing an `.eml` still works.
- **Brain / knowledge graph**: neither has a public "add these documents" registration API (the brain indexes files; the graph is built from files). Tracks are not added to either; agents can query them through `keeper/tracks`.
- **Island**: activities arrive on the existing `progress` channel with the tasks `arriving` and `workout` (titles and icons added to `core/island-activities.ts`).

## Verified and not verified

Verified here (Linux, Electron under xvfb, and unit tests with recorded fixtures):

- Every parser against fixtures: GPX, KML, KMZ, GeoJSON, TCX, FIT (including compressed timestamps, CRC, round trip), Google on-device (Android and iPhone), Semantic Location History, Records.json, Apple Health export.zip, photo EXIF GPS, booking mails (quoted-printable `.eml`).
- Stay and move detection, places, trips (the Berlin → Tallinn → Berlin fixture gives one trip, two flights, Estonia), the stats maths, privacy zones on every export format, search, deduplication, AES-GCM sealing.
- Strava, Polar and Fitbit mapping against recorded JSON; OAuth URL and token parsing.
- The HTTP receiver (OwnTracks with Basic auth, OsmAnd query, token refused) and the MQTT client against an in-test broker (QoS 1 with PUBACK).
- Own position for Link (phone, your trackers, Home; stale positions ignored) and bookings from the mailbox with a stubbed mail reader.
- Two apps paired over Keeper Link (`test/e2e/tracks-link.cjs`): no position before *Share my location*, then the laptop’s Live view shows the desk at its Home place, and the desk’s audit log records it.
- Find My cache parsing for plain JSON and encrypted files, from fixtures.
- End to end (`test/e2e/tracks.cjs`): importing a GPX and a Google Timeline export, stays and a flight on the timeline, the trip view, track polylines on the map with tiles from a local stub (User-Agent checked), an OwnTracks post shown in Live, the palette’s "Where Is My …?", "Show on Map" from the file browser, the Island’s "Arriving", a GPX export compared point by point with the input, and *Delete everything*.

Not verified:

- **Real services**: no live Strava, Polar or Fitbit account was used; only recorded JSON. The OAuth round trip against the real sign-in pages is untested.
- **Find My on a real Mac**: not run on macOS 13/14.3 (plain) or 14.4+ (encrypted); behaviour comes from the fixtures and the file formats as documented publicly.
- **Real trackers and apps**: the OwnTracks app, Traccar Client, a hardware OsmAnd-protocol tracker and a real MQTT broker (Mosquitto) were not connected; a real Traccar server was not used.
- **Phone companion positions** from a real phone browser (the op is unit-shaped and the companion page is another owner’s; not driven in an e2e).
- **Bookings from a real mailbox**: `structuredData` was type-checked and the reading logic tested with a stub, not against a real IMAP account.
- **Keychain encryption on macOS and Windows**: the e2e machine has no keyring, so it exercised the unencrypted fallback; the AES-GCM path is unit-tested.
- **Real tile servers**: only the stub; the OSM policy points above are by design, not measured against the real servers.
- **Very large imports** (multi-GB Records.json or Health exports) and FIT files with developer fields from every vendor.
- **The tray menu** is built but was not opened in the e2e (Electron does not expose tray menus to tests).
