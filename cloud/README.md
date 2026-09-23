# Passage live API candidate

This local candidate separates the GitHub Pages dashboard from its background data collector. **Nothing in this folder has been deployed.** Publishing and enabling the cloud account remain a review checkpoint.

One Worker accepts the dashboard's fixed public GET routes. It forwards them to one named SQLite Durable Object shared by both theaters. The object stores source snapshots, retry deadlines and bounded reporting metadata, runs a collection cycle every five minutes, and maintains one AISStream connection even when nobody is viewing. A fifteen-minute platform cron reaches the same object to recover scheduling after a failed alarm or runtime restart. Source-specific refresh intervals and provider backoff remain in force; a scheduled cycle does not mean every provider publishes new data.

| Data | Persistence and freshness |
| --- | --- |
| Reporting | Up to 1,200 metadata records, retained for 30 days; bounded public previews only. No full subscribed articles. |
| Source snapshots | Original check, retrieval, publication and retry timestamps survive a restart. |
| AIS positions | Latest received position per vessel, at most 2,000; removed after 30 minutes and shown stale after 10. |
| Ship classification | At most 2,000 static records; type/name clocks expire independently after 24 hours. Static data never refreshes a position. |
| AIS checkpoint | Every completed or failed five-minute collection cycle. An unexpected restart can lose messages received since the last checkpoint. |
| Open Waters | Ten-second in-memory refresh when requested, with at most one durable checkpoint per five minutes. |
| Archive/storage limits | Individual file limit 10 MiB, total logical file limit 128 MiB, at most 128 files. These are application bounds, not Cloudflare billed storage estimates. |

The AIS supervisor checks transport state approximately every fifteen seconds, retries with exponential backoff/jitter, and rotates the connection at fourteen minutes. Runtime or provider interruptions can cause gaps. Native Worker WebSockets do not expose the Node client's ping/pong verification, so diagnostics do not claim a verified heartbeat. Compression is requested by the runtime and the provider's confirmation is recorded. AISStream explicitly requires a backend connection and warns that uncompressed connections can drop messages under bandwidth limits; it offers no durable replay or uptime guarantee. [AISStream documentation](https://aisstream.io/documentation), [Cloudflare WebSocket compatibility](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#websocket-compression), [outbound connection lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

## Local validation

From the repository root:

```sh
npm test
npm run cloud:check
npm run cloud:dev
```

`cloud:check` builds the Worker locally with Wrangler's dry-run option. `cloud:dev` starts a local Worker runtime; it does not prove hosted alarms or quotas work in a real Cloudflare account. The unit/contract suite includes actual SQLite transactions, source-cache and reporting-archive restart, two no-viewer collection cycles, persisted AIS age/type restoration, transport failures, HTTP slot limits, and public API security boundaries.

For local source access, Wrangler reads ignored `.dev.vars` files next to its configuration. Only these optional settings are used:

```dotenv
EIA_API_KEY=your_eia_key
AISSTREAM_API_KEY=your_aisstream_key
RELIEFWEB_APPNAME=your_approved_reliefweb_appname
```

Do not put account credentials, ACLED settings, cookies or Reuters subscription credentials here. Without an EIA key, public EIA tables remain available. Without an AISStream key, its source stays unconfigured and the public snapshot fallback remains independently labeled.

## Reviewed deployment sequence

These commands are documented for the later approved deployment. They have not been executed as part of building this candidate.

1. Confirm `cloud/wrangler.jsonc` uses the intended Cloudflare account and exact Pages origin. The current origin is `https://myleshamm.github.io`; CORS origins have no repository path. Other projects under that same origin share the browser origin boundary.
2. Authenticate Wrangler to the chosen account with the required permissions and review its free-plan limits. After release approval, create the Worker with `npm run cloud:deploy`. Keep the singleton name and migration class unchanged so both theaters continue to share one subscription and database. Renaming these can create another object and abandon the previous archive.
3. After the Worker exists and the user has approved transferring the specific source keys to Cloudflare, set its optional secrets interactively. Only set ReliefWeb's app name if one has been approved by that provider:

   ```sh
   npx wrangler secret put EIA_API_KEY --config cloud/wrangler.jsonc
   npx wrangler secret put AISSTREAM_API_KEY --config cloud/wrangler.jsonc
   npx wrangler secret put RELIEFWEB_APPNAME --config cloud/wrangler.jsonc
   ```

4. Set `PASSAGE_API_BASE` to the deployed Worker HTTPS origin, then run `node scripts/check-hosted-api.mjs` and `npm run build:pages`. The static frontend build contains the API origin, never source keys.
5. Before calling the deployment ready, confirm two completed collection cycles with all dashboards closed, retained reporting after an object restart, current source timestamps, AIS compression/position receipt, and the error behavior of an unavailable source. Monitor Cloudflare's account usage over a full day. Live-host verification is distinct from local contract tests.

The public surface is intentionally read-only and public. CORS is not authentication: non-browser clients can read the same metadata. Fixed paths and bounded query values prevent arbitrary proxy requests. Request credentials/headers are discarded before forwarding. ACLED is forcibly disabled in the shared hosted service; credential connection and disconnection routes are absent. Exceptions return generic errors. `/api/health` exposes collector timing and bounded storage statistics; `/api/diagnostics` preserves source-specific errors, freshness and backoff.

## Free hosting limits and operations

The free tier currently includes 100,000 Durable Object requests/day, 13,000 GB-s/day, five million SQL rows read/day, 100,000 SQL rows written/day and 5 GB stored across the account. One continuously active 128 MB object alone is approximately 11,000 GB-s/day, leaving limited room for other account workloads. Additional viewers, SQL indices and checkpoints also consume quotas. These figures are planning limits, **not an uptime or zero-cost guarantee**. Exhausting a daily free limit can interrupt collection until reset. Cloudflare's dashboard is the authority for account usage. [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The thin Worker delegates source work to the object because Worker and Durable Object execution limits differ. Four concurrent HTTP bodies plus the AIS socket fit below the object's six outgoing connection limit. SQL files use 256 KiB chunks below the 2 MB SQL row limit. Heavy provider responses, parsing and graph generation still need hosted CPU/memory verification. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Alarms have at-least-once delivery. Collection coalesces overlapping alarms/cron calls, obeys per-source retry deadlines and awaits discovery before saving its archive. Cron recovery is configured separately because alarm retries are finite. The reported next-attempt time is a schedule, not evidence that the run occurred. [Alarm semantics](https://developers.cloudflare.com/durable-objects/api/alarms/), [Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

`/api/health.storage.logicalBytes` excludes SQL indices and internal storage; `databaseBytes` uses the runtime's actual SQLite size where available. `observedSqlRows`, when supplied by the runtime, counts this object's SQL operations since its last start; it excludes alarm bookkeeping and is not the account billing total. Check for stale `lastCompletedAt`, checkpoint errors, rising provider backoff, repeated reconnects, and actual quota usage.

To pause deliberately, set `COLLECTOR_PAUSED` to `"true"` in the reviewed configuration and deploy that change. It closes AIS, deletes the object's alarm, returns a paused health status and blocks further provider requests while preserving stored metadata. The recovery cron remains inert; set the flag back to `"false"` and deploy to resume. Closing the browser intentionally does not stop collection. Deleting an object or its migration can destroy retained metadata and needs a separate backup/review decision.
