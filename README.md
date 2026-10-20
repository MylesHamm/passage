# Passage

[Open Passage](https://myleshamm.github.io/passage/)

An evidence-first regional watch for maritime security, regional oil supply, and the relationship between reporting and energy markets. Covers Bab el-Mandeb, Hormuz, and related regional infrastructure.

The interface runs on GitHub Pages. A separate Cloudflare Worker and one SQLite Durable Object collect public-source metadata in the background, retain source timestamps, and provide a read-only API. Pages does not run a server or contain API keys.

## Explore the watch

- **Watch**: start with recent publisher reporting and new links, then use compact regional geography and dated Brent/WTI observations for context.
- **Reporting**: search and filter the source stream. New links wait in a visible notice until applied, preserving your reading position.
- **Energy**: compare dated daily prices, inspect the interactive oil-system diagram, and read separately labelled market expectations. Select export availability, passage/freight, security/insurance or benchmarks to see the evidence needed to connect a development to oil.
- **Evidence**: review official records, regional infrastructure, marine/conflict context, and source coverage.

The neutral light interface gives reporting priority over geographic and energy reference material. Historical exposure remains supporting context: the H1 2025 oil-flow figures are dated baselines, not current throughput or available bypass capacity. Default reporting uses working publisher feeds; historical and retired-source records remain available through an explicit archive option.

Theatre and reporting filters carry across workspaces. Select a report or place to open one evidence inspector; Escape closes it. A report keeps its original headline and source link before three progressive views: Claim, Confirm, and Oil connection. Publication, event, discovery and retrieval dates remain separate. Reports can open the oil-system anatomy with possible channels clearly distinguished from measured effects, and stay attached while you explore.

The compact terrain view focuses on Hormuz and Bab el-Mandeb, with geographic focus and reporting scope controlled separately. It uses static elevation and a derived coastline from attributed Mapzen Terrain Tiles. Relief is exaggerated 4×; lighting and colors are designed rather than satellite imagery. It is not a navigation chart or current-conditions layer. Controlled camera moves explain selection and then stop. WebGL provides the 3D view where available, with a truthful 2D reference fallback. There is no idle rotation, animated traffic simulation or invented incident coordinate. See [terrain sources and limits](docs/REGIONAL-TERRAIN.md).

Keyboard users can switch workspaces, inspector tabs and diagram parts with arrow, Home and End keys, and inspect price dates with the chart slider. The optional Quick tour explains the same workspaces at your pace. Refreshes preserve reading state and do not replay entrance motion; reduced-motion preferences remove animated transitions.

## What updates

- Reporting and official maritime notices are collected on a five-minute background cycle, subject to each provider's refresh interval and retry instructions. The open dashboard checks for updates every minute.
- Received AIS positions stream into the collector continuously when configured; the dashboard checks every ten seconds. Coverage can be incomplete. Positions expire after thirty minutes.
- EIA daily spot observations and weekly supply statistics retain their observation dates. Rechecking them does not create a newer market observation. The Watch pulse and Energy chart share the same dated-observation contract; they never imply intraday or event-driven price changes.
- Polymarket provides up to five relevant active prediction markets through free public snapshots. Exact questions, deadlines, liquidity and resolution rules remain visible; these are market expectations, not event confirmation.
- The live briefing links to The Hormuz Letter as a preferred source. Its X account is not automatically collected; examples shared for context are not pinned as a fixed watchlist.
- Weather is a dated model forecast. Geography, infrastructure locations, and possible oil-impact mechanisms are reference context.

Reports, events, and market movements remain distinct. A graph connection is not proof that an actor caused an incident or that an incident moved oil prices. Provider failures show retained, unavailable, or delayed states rather than fabricated replacements.

## Run locally

Use Node.js 22.13 or newer:

```sh
npm ci
cp .env.example .env
npm start
```

Add optional keys only to the ignored `.env` file. On macOS, `start.command` starts Passage and opens Firefox. Local ACLED account connections remain local; the public collector never reads or shares them.

## Publish

Follow [Hosting](docs/HOSTING.md). Deploy the collector first, check unattended collection and source health, configure its HTTPS address in the repository's `PASSAGE_API_BASE` variable, then manually run **Publish reviewed Passage**. Publishing is separate from ordinary commits.

```sh
npm test
npm run check
npm run cloud:check
```

The free deployment is designed for a personal public watch, not guaranteed uninterrupted service. Cloudflare quotas and provider limits can interrupt collection. See [source and dependency notices](THIRD-PARTY-NOTICES.md). No full paid articles are bundled or republished.
