# Passage

[Open Passage](https://myleshamm.github.io/passage/)

An operations-center view of the regional war from the Gulf to the Red Sea, centred on the Strait of Hormuz. It shows received tanker positions, dated war events across the region, daily transits through the straits, oil prices and market odds. Each figure carries its own date and source.

## What you see

- **Hormuz map.** 3D terrain with every vessel position received from the free AIS feed. Tankers are drawn as detailed models turned to their reported heading, with a trail of their last hour of received positions. **Replay last hour** plays those received positions back in twelve seconds. The default view runs from the Dubai and Sharjah anchorages, where the feed's receivers are, to the strait itself.
- **Regional war map.** 3D terrain from the Gulf to the Red Sea with dated, source-linked events in three layers: attacks on shipping, missile and drone strikes, and strikes on Iran and Yemen. Naval missions are drawn as approximate areas, only for the days they were under way. Select an event, in the map, the event list or the chart, and **show me** flies the map to it, marks its date on the price chart, and shows Brent and the related odds on the day and a few days later. Nearby events are drawn as numbered groups, and **Hormuz** and **Red Sea & Yemen** jump to each front.
- **All events.** The full timeline by month, filterable by layer. It includes register incidents whose report gives no usable position: they are listed, never pinned.
- **Daily transits.** IMF PortWatch counts for Hormuz and Bab el-Mandeb, split into tankers and all ships, against a labelled pre-disruption average.
- **Oil prices.** Daily Brent and WTI spot prices from the U.S. Energy Information Administration, including the latest next-day close.
- **Market odds.** Polymarket probabilities for questions about Hormuz, shipping attacks and the conflict, each linked to its market.
- **Headlines.** The latest reporting from BBC, Al Jazeera, Middle East Eye, Middle East Monitor, France 24 and UN News, one click away.
- **About the data.** Every source with its status and latest date, plus how to read each panel. Select the status indicator in the top bar to open it.

## What updates

- Vessel positions refresh every ten seconds while the page is open. The collector receives them continuously. Positions older than ten minutes fade, and are dropped after thirty.
- Odds and headlines refresh every minute, war events every five minutes, oil every ten and transits every thirty. An automated review checks for new events every six hours and commits only source-linked ones to the list in this repository. The collector picks the list up within about fifteen minutes, with no site publish. The page shows when the list was last reviewed. See `docs/EVENTS-UPDATE.md`. PortWatch publishes weekly, so the latest transit day is often several days old.
- Nothing is extrapolated. A trail joins positions actually received, and a missing price or count stays missing.

The free AIS feed covers part of Hormuz and none of Bab el-Mandeb. An empty stretch of water on the map does not mean no ships are there.

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
