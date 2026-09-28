# Hosting Passage

## Deployment shape

GitHub Pages serves the interface at `https://myleshamm.github.io/passage/`. A separately deployed Cloudflare Worker serves `/api/...`; one named SQLite Durable Object holds the source cache, reporting history, collector status, and bounded AIS checkpoints.

Background source checks run every five minutes. AIS supervision runs independently of viewers. A fifteen-minute platform cron recovers the same collector after eviction or an alarm problem. Provider refresh intervals and Retry-After deadlines still govern upstream requests. The browser refreshes visible reporting and market panels every minute and received vessel positions every ten seconds.

This is a free-plan design, not a claim of uninterrupted coverage. Keep only one production collector: a continuously active 128 MB object uses approximately 11,059 GB-s/day against a 13,000 GB-s/day free allowance. Incoming requests, AIS WebSocket messages, alarms, and SQLite operations consume other allowances. Inspect actual usage before claiming the workload fits; free-limit exhaustion can stop collection. Position checkpoints and high-frequency snapshot persistence are bounded to reduce writes. Do not run a second hosted preview collector continuously.

Render Free sleeps after fifteen minutes without inbound activity and has ephemeral storage, so it does not satisfy this deployment's requirement to collect when nobody is viewing. No Render service is needed for this design.

## Set up the live collector

1. Sign in to a Cloudflare Free account and authorize the official Wrangler CLI. The user completes account creation, binding agreements, and the requested authorization.
2. Inspect `cloud/wrangler.jsonc`. The allowed browser origin is `https://myleshamm.github.io` (no `/passage/` path). The object name is fixed so all viewers share one collector.
3. Deploy with `npm run cloud:deploy`. Add optional `AISSTREAM_API_KEY`, `EIA_API_KEY`, and approved `RELIEFWEB_APPNAME` through Cloudflare Worker secrets. Never put values in the configuration, repository, Pages variables, or browser code. ACLED credentials are not supported on this public service.
4. Verify `/api/health`, `/api/diagnostics`, `/api/news`, `/api/oil`, and `/api/vessels`. Close all viewers and verify `collection.lastCompletedAt` advances across at least two cycles. Check a restart retains observation times, and confirm failed providers remain visibly degraded.
5. Inspect account usage after a representative day. Review quotas, source errors, missing intervals, and WebSocket reconnects. Passing a local test or a single successful request is not proof of twenty-four-hour reliability.

The public API uses fixed read-only routes. CORS restricts browser access to the configured Pages origin; it is not authentication. Published source metadata can be fetched by other clients. No arbitrary URL proxy, account login, or credential-write route is public.

## Publish Pages after review

1. Create the public `MylesHamm/passage` repository from the reviewed publication export. The initial public history must exclude local `.env`, `.private`, `.cache`, research drafts, and previous private Git history.
2. Set Pages' publishing source to **GitHub Actions**. Add a repository **variable**, `PASSAGE_API_BASE`, containing the collector's public HTTPS address. This is a URL, not a secret.
3. Run **Check Passage**. Review the built interface, working links under `/passage/`, source dates, failure states, globe controls, and account isolation.
4. Manually run **Publish reviewed Passage** on the reviewed commit. The workflow requires passing checks, the correct API/CORS origin, and recent usable data from every configured direct reporting feed. It reads actual source diagnostics: a reachable collector alone cannot pass. Required feeds must be connected without retrieval or persistence errors, contain relevant records, have a successful retrieval within two polling intervals plus two minutes, and a relevant publication within the 72-hour briefing window. Auxiliary source gaps remain visible separately.
5. Verify the actual public URL, including Investigate, Research, and navigation back to the command center. Confirm retrieved source times advance without redeploying Pages.

Ordinary pushes run checks but do not deploy Pages. Worker deployment is also explicit. To roll back, deploy the last reviewed Worker version using Cloudflare's version controls and rerun the Pages workflow on the corresponding reviewed commit. Preserve the existing SQLite migration and data; a rollback is not a database deletion.

## Evidence and limits

Source observation time, publication time, retrieval time, and background-cycle completion are different clocks. A completed collector cycle can contain provider failures. Source-level status is authoritative for each feed. Reporting history retains at most 1,200 metadata records for thirty days since actual retrieval; it is not an exhaustive archive. Browser-saved research stays in that browser and is not uploaded to the collector.

Free Reuters discovery is third-party headline/link discovery. It does not access a Reuters subscription, mirror topic preferences, or guarantee every Reuters report. Open-Meteo use remains subject to its free non-commercial conditions and attribution. Other sources retain their own terms.

Official references checked for this design: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Render Free](https://render.com/docs/free), [AISStream](https://aisstream.io/documentation).
