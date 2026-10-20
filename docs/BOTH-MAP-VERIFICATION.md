# Both-region map and AIS provenance review

Reviewed locally on 20 October 2026, based on main commit
`bbbd811bd9f9e2873cf902f6962717294156649d`. No deployment is part of this change.

## Confirmed defect and repair

The public release showed only Hormuz when Both was selected, including after
each single-region selection, camera adjustment, resizing and reload. This
was a missing second geographic scene, not a cropped strait label. The public
check recorded 24 observations at desktop 1440×900 and mobile 390×844.

Both now uses two separately fitted, north-up regional frames. The headings,
coordinates, scales and caption identify the separate regions. Single-region
3D views remain available through Focus. Failures loading one reference asset
do not make the other frame unavailable.

## Checks performed

- `npm test -- --test-concurrency=1`: 739 passed, zero failed or skipped.
- `npm run check`: passed.
- `npm run build:pages`: passed, 105 output files.
- `WRANGLER_SEND_METRICS=false npm run cloud:check`: Worker dry-run passed;
  no deployment or authentication change.
- Independent code review covered the map/model integration and source
  provenance corrections. Reported blockers were corrected and reviewed again.
- Isolated browser fixture checks: 75 passed with no page errors on the map
  candidate, including 1440-, 390- and 320-pixel layouts, single/Both switching,
  camera reset, resize/reload, focus handling, failure states, model heading and
  course fallback, unknown direction, supplied position updates and expiration.
- Final-candidate fixture checks: 14 passed with no page errors, covering
  legacy and corrected snapshot responses, source disclosures, collection
  attribution, model rendering and keyboard selection. Source cards and 4×
  model detail were visually inspected.

The final Pages artifact fingerprint is
`0bf23447c3db12aac47c80b8b85a74a47c2e0ed1096837fc7f7e225d1c84d70c`.
The earlier 75-check map artifact fingerprint was
`aadc7ff696eebcd55d6c5196ff20ecccaac26d0ace91e7e253c152a7eceee896`;
the subsequent changes corrected snapshot provenance and source disclosures.
The final focused visual check used the final artifact.

Local logs, manifests, browser results and dashboard-only captures remain
outside the repository in the task's `evidence/both-map-2026-10-20/` directory.
They have not been uploaded. Browsers used temporary isolated profiles and
closed after the checks. No ordinary Chrome profile was modified.

## Release boundaries

The tanker artwork is a generic, enlarged Anatomy model. Production does not
enable the model option; review harnesses enabled it with synthetic data.
No new live provider, credential or event endpoint is introduced.

Open Waters cached geometry has unknown coordinate time and source. Excluding
it from current positions intentionally reduces displayed coverage; it does
not show that a waterway is empty. Last-message metadata and collection credits
are retained separately. Frontend guards cover legacy API responses, while
the full collector/API correction requires a separately authorized backend
deployment. Restoring schema 1 checkpoints skips old position records; fresh
position reports repopulate them, and independently dated static metadata
remains subject to expiry.

Provider permission for the intended public map/API display and retention, and
position-event provenance, remain prerequisites to expanded vessel/model use.
A later public API request returned HTTP 403, so no further live coverage
checks were attempted. Fixture checks do not establish present provider
coverage or production behavior.

MARAD advisory coverage remains unavailable. The MSCIO report link explicitly
describes the 9–16 October 2026 reporting period and is not a live advisory
replacement.

The upstream Anatomy clearance/depth and line-end audit tools are not
vendored and were not run. Dense ordinary vessel symbols may overlap; mobile
hardware performance has not been certified. The existing single-region
renderer selects at most 250 records before viewport filtering, so some later
visible records can be omitted at high density. The detailed model allowance
is capped at eight per visible frame.

Merge, frontend publication, backend deployment and real-provider model
activation remain separate review decisions.
