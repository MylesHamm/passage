# Passage

[Open Passage](https://myleshamm.github.io/passage/)

An operations-center view of the regional war from the Gulf to the Red Sea, centered on the Strait of Hormuz. It shows received tanker positions, dated war events across the region, daily transits through the straits, oil prices and market odds. Each figure carries its own date and source.

## What you see

Passage is a small site of landing pages. Each page has its own address, one main action and a short set of questions that hold its caveats, so the views themselves stay uncluttered.

- **Overview** (`/`). The live Hormuz map as the hero, with the latest Hormuz transits, Brent close and number of ships dark now beside **Open the live map**, then one card per view with its own real, dated figure.
- **Hormuz live** (`/hormuz/`). 3D terrain with every vessel position received from two free AIS feeds: AISStream, and AISHub contributors relayed by Open Waters AIS about a minute behind. Each ship's card names its feed, the map carries the credit, and the newest report of a ship wins. Tankers are drawn as detailed models turned to their reported heading, with a trail of their last hour of received positions. **Replay the last hour** plays those positions back in twelve seconds. War events from the last seven days inside the view are marked on the map. Below the map: daily PortWatch transits for Hormuz and Bab el-Mandeb against their averages before the war, and the AIS gap record. A gap is a ship that stops reporting for three hours or more while moving deep inside reliable reception; it is evidence that AIS was switched off, not proof.
- **Regional war** (`/war/`). 3D terrain from the Gulf to the Red Sea with dated, source-linked events in three layers: attacks on shipping, missile and drone strikes, and strikes on Iran and Yemen. Naval missions are drawn as approximate areas, only for the days they were under way. Nearby events are drawn as numbered groups, and **Hormuz** and **Red Sea and Yemen** jump to each front. Below the map: the missions under way today and the latest reporting from BBC, Al Jazeera, Middle East Eye, Middle East Monitor, France 24 and UN News.
- **Events** (`/events/`). The full timeline by month, filterable by layer. It includes register incidents whose report gives no usable position: they are listed, never pinned.
- **One event** (`/event/?id=…`). Where it happened, the reports behind it, and Brent and the related Polymarket odds on the day and a few days later, with the window marked on the price chart. This is what happened next, not what caused it. The page is filled from the live list, so a new event has a page as soon as it is reviewed.
- **Oil and odds** (`/oil/`). Daily Brent and WTI spot prices from the U.S. Energy Information Administration with every war event marked on the time axis, and Polymarket probabilities on the war, each linked to its market.
- **Method** (`/method/`). Every source with its status and latest date, how to read each panel, the rules Passage keeps, and its privacy note, terms and credits. The status in the navigation links here.

The design follows the landing page rules recorded in `test/design-system.test.mjs` and `test/site-pages.test.mjs`: Geist type on Tailwind's type scale, fixed spacing steps, flat dark surfaces, one easing curve, and copy without hyphenated words or dashes.

Sections load in once as they scroll into view: cards rise from below and resolve from blur, bars fill and lines draw, in reading order. Each card's chart then acts out a reading of its real data, a highlight stepping along the observed points with each one's own figure and date, and lists highlight one row at a time. The stories run on one clock that stops when they leave the screen. Nothing counts up or shows a value between observations, and with reduced motion every section shows its final state (`dist/site/stories.mjs`, `test/stories.test.mjs`).

When the vessel feeds are connected but nothing arrives from the region, the map says so. The AIS gap count pauses rather than counting silent ships as dark.

Open Waters is read from its event stream, never its vessel snapshot, so every position is a dated, decoded position report (`lib/openwaters.mjs`, `docs/AIS-SNAPSHOT-PROVENANCE.md`). The hosted collector opts in with the `OPENWATERS` variable and connects with the `OPENWATERS_TOKEN` secret; locally it runs without a token unless `OPENWATERS_TOKEN` is set, and `OPENWATERS_DISABLED=true` turns it off.

## What updates

- Vessel positions refresh every ten seconds while the page is open. The collector receives them continuously. Positions older than ten minutes fade, and are dropped after thirty.
- Odds and headlines refresh every minute, war events every five minutes, oil every ten and transits every thirty. An automated review checks for new events every six hours and commits only source-linked ones to the list in this repository. The collector picks the list up within about fifteen minutes, with no site publish. The page shows when the list was last reviewed. See `docs/EVENTS-UPDATE.md`. PortWatch publishes weekly, so the latest transit day is often several days old.
- Nothing is extrapolated. A trail joins positions actually received, and a missing price or count stays missing.

The two free AIS feeds cover most of the Hormuz area and almost none of Bab el-Mandeb. The Hormuz figures count ships received, ships stopped (under 1 knot) and ships moving in the strait (2 knots or more, inside an approximate box over the shipping lanes), so a crowded anchorage is not mistaken for traffic. Ships with AIS switched off are not on the map.

## Run locally

Use Node.js 22.13 or newer:

```sh
npm ci
cp .env.example .env
npm start
```

Add optional keys only to the ignored `.env` file. On macOS, `start.command` starts Passage and opens Firefox.

```sh
npm test
npm run check
```

## Publish

Follow [Hosting](docs/HOSTING.md). Deploy the collector first and check its source health. Then set its HTTPS address in the repository's `PASSAGE_API_BASE` variable and run **Publish reviewed Passage** manually. Publishing is separate from ordinary commits.
