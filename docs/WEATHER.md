# Weather

The Weather page (Desktop section), the Island's temperature and rain alerts, the
weather widget, the menu-bar summary and Journal entries all read one forecast.

## Where forecasts come from

| What | From | Terms |
|---|---|---|
| Forecasts (now, hourly, ten days, rain soon) | **MET Norway** Locationforecast 2.0 (`api.met.no`), the default | Free for any use, including commercial; data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Forecasts, if the person chooses it | Open-Meteo (`api.open-meteo.com`) | Its free tier is for non-commercial use |
| Place search, air quality, climate averages | Open-Meteo (geocoding, air-quality and archive services) | as above |
| Official alerts | US National Weather Service (US places only) | public domain |
| Rain radar | RainViewer's public radar frames, OpenStreetMap tiles | see THIRD-PARTY-NOTICES.md |

Settings → General → Weather → *Forecasts from* (under More settings) switches between
MET Norway and Open-Meteo (`weatherSource`: `met` | `open-meteo`).

### MET Norway's terms, and how Keeper follows them

`core/met.ts` holds everything specific to MET Norway; it is pure and unit-tested
(`test/met.test.ts`).

- **Identifying User-Agent.** Every request carries `Keeper/<version> https://keeper.ashforde.org`
  (`metUserAgent`), so MET can reach Ashforde.
- **Coordinates with at most four decimals** (`metCoord`); more are refused.
- **Caching.** An answer is kept until its `Expires` time and never asked for again before
  it (`metGet`). After that Keeper asks with `If-Modified-Since` (the answer's `Last-Modified`),
  and a `304 Not Modified` keeps the copy. A `429` makes Keeper wait for the next regular
  look. The cache is shared by the Island and the Weather page, so the page opening does not
  add requests.
- **How often.** The Island looks every 15 minutes at most, and the page's forecasts are
  kept 10 minutes; with the `Expires` rule most of those looks never leave the computer.
- **Attribution.** The Weather page's footer says "Weather data from MET Norway (CC BY 4.0)",
  linking to met.no and the licence, whenever the forecast shown came from MET.

### Turning MET's answer into Keeper's forecast

`parseMet` makes the same `Weather` shape Open-Meteo's answers become, so every view stays
as it was:

- **Symbols.** MET's 41 symbol codes (`clearsky`, `lightrainshowers`, `heavysleetandthunder`…,
  with `_day`, `_night` or `_polartwilight`) map to the WMO codes the views already draw
  (`metSymbol`); the ending sets day or night. An unknown symbol is read by its words.
- **Units.** MET sends °C, m/s and mm; Keeper converts to km/h or °F, mph and inches.
- **Days.** Steps are grouped into days in the place's own time zone (from the place
  search; places saved before that use a zone worked out from the longitude). A day's look is
  MET's twelve-hour symbol from the morning, its range includes the six-hour highs and lows,
  and its rain adds up the hours without counting any twice.
- **Feels like** is worked out from temperature, humidity and wind (MET does not send it).
- **Sunrise and sunset** are worked out on the computer (`core/astro.ts`).
- **UV** is MET's clear-sky UV index.
- **Rain soon.** MET's minute-by-minute nowcast covers only the Nordic countries, so the
  "Rain starting in about 40 minutes" line comes from the hourly steps (`hourlyNowcast`).
- **Not sent by MET:** visibility (left out of the pressure tile), air quality (still from Open-Meteo).

## Privacy

Only the coordinates of places the person added are sent, and only to the services above.
The User-Agent names Keeper and its version; nothing else about the computer is sent.
