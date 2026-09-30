# Passage

[Open Passage](https://myleshamm.github.io/passage/)

A globe-led watch for maritime security, regional oil supply, and the relationship between reporting and energy markets. Covers Bab el-Mandeb, Hormuz, and related regional infrastructure.

The interface runs on GitHub Pages. A separate Cloudflare Worker and one SQLite Durable Object collect public-source metadata in the background, retain source timestamps, and provide a read-only API. Pages does not run a server or contain API keys.

## What updates

- Reporting and official maritime notices are collected on a five-minute background cycle, subject to each provider's refresh interval and retry instructions. The open dashboard checks for updates every minute.
- Received AIS positions stream into the collector continuously when configured; the dashboard checks every ten seconds. Coverage can be incomplete. Positions expire after thirty minutes.
- EIA daily spot observations and weekly supply statistics retain their observation dates. Rechecking them does not create a newer market observation. The separate embedded oil chart is attributed to its own provider.
- Polymarket provides up to five relevant active prediction markets through free public snapshots. Exact questions, deadlines, liquidity and resolution rules remain visible; these are market expectations, not event confirmation.
- The Hormuz Letter preferred-source watch rechecks explicitly tracked links through public X excerpts. It does not discover new posts automatically. Original posts and maps remain linked; satellite observations are not yet collected.
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
