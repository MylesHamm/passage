# Map zoom and vessel visibility repair — 20 October 2026

This candidate follows main `b76e2f45eddd2f8c4ccdb2fd9c3f14dcff1e3eda`.
It is prepared for review; no merge or deployment is part of this work.

## Reproduction and changes

Two zoom-out clicks reach the existing minimum zoom, 0.76. The global disabled
button rule then changed the pointer to `wait` indefinitely. The observed public
page remained responsive, with no loading overlay or repeated map download.
Disabled controls now use the normal pointer; actual refresh work uses
`aria-busy`. Zoom limits have explicit titles and visible status, and zooming
back in re-enables the minus control.

The screenshot's AIS layer was off. Its control was inside collapsed terrain
details. The existing control, type filter and received-position inspector are
now directly beneath the map controls. Each frame distinguishes layer off,
filter exclusion, no received observations, observations outside the frame,
paused/failed reception and an unavailable reference map.

Focused scenes previously limited records before projection. Offscreen records
could occupy all 250 slots and suppress a later visible vessel. Focused and Both
views now use the same projection-first bounded selection. Keyed marker nodes
retain selection behavior as the camera moves. Original position clocks,
heading/course fallback, unknown-direction symbols and expiry remain intact.

Map downloads, body reads and decoding share a deadline. The plan fallback is
also bounded, stale completion cannot replace a newer scene, and cancellation
releases images. A failed Both pane cannot hide the other strait. Hidden markers
from the prior scene no longer count as visible while a new scene loads.

`/api/vessels` previously waited for the Open Waters snapshot provider even
though those snapshots cannot contribute current positions. A provider request
could outlast the browser's eight-second deadline. The endpoint now reads
retained snapshot metadata and returns AIS independently of provider refresh.
Worker collection remains on its existing background path; the local server
owns snapshot collection in its startup/five-minute cycle. Original source
errors, cache warnings, timestamps and retry deadlines remain visible.

## Public observation, separate from fixture tests

At 19:49 UTC, the ordinary published page received HTTP 200 and 178 current
position records, including three tankers, all assigned to the broader Hormuz
reporting area. None fell inside the tested default Hormuz/Both frames. Their
aggregate latitude range was 24.7787–25.7126 N, south of the displayed Hormuz
plan frame; the matching plan projection also returned zero. Bab had no received
records. No identities or individual coordinate records were saved by this
aggregate probe. There were no expired, future-dated or snapshot rows in that
current-position response. Separately retained snapshots remain excluded.

This is incomplete reception, not evidence that either strait has no ships.
The repair does not expand geographic coverage or promise that the default
frames contain a received vessel. Wider navigation or fitting a selected
position would require a separate product decision. No denied source route was
retried; these observations came from normal page loading.

## Validation

- 769 repository tests passed serially; none failed or skipped.
- Syntax checks, Worker dry-run and the 106-file Pages build passed.
- Dependency audit found zero vulnerabilities.
- 73 isolated Chrome fixture checks passed, with no page errors, at 1440, 390
  and 320 pixels. They cover repeated min/max zoom, re-enabling controls,
  reset, keyboard input, ordinary wheel scrolling, Both/focused switching,
  missing heading, selection, dense offscreen records, stale/expired positions,
  filtered/empty/failed reception and partial map failure.
- Two synthetic Hormuz tankers and one synthetic Bab tanker were visible in
  their respective frames despite 300 preceding offscreen records. These are
  labeled test observations, not evidence of current provider coverage.
- Independent ultra-effort reviews covered the map, cache/collection and
  failure paths. Review findings were fixed and rechecked.
- Rendered desktop/mobile captures were inspected, including the final failed
  pane disclosure. Browsers used temporary isolated profiles and closed after
  checks. Ordinary Chrome was not used or closed.

The tested Pages build fingerprint is
`28190bb1bbb4c52caad3504462f7fb8a16b13e6e2646703dbb3aa89d1e90a489`:
SHA-256 of sorted `relative path + NUL + file SHA-256 + newline` entries.
Local logs, manifest and captures remain outside the repository in the task's
`evidence/map-repair-2026-10-20/` directory. No captures were uploaded.

## Scope and remaining limits

The existing canvas/WebGL stack, static terrain assets and provider boundaries
remain. Production Anatomy tanker models remain disabled. No provider, data
license, credential, migration, persistent-storage format or dependency changed.
The backend latency correction requires a later reviewed Worker deployment;
the frontend remains compatible with the current API response shape.

Marine references supplied by the separate research pass include
[AvNav](https://github.com/wellenvogel/avnav) and
[Freeboard](https://github.com/SignalK/freeboard-sk) for bounded interaction,
heading fallback and readable vessel symbols. Freeboard's vessel-icon scaling
helper concerns the own vessel; its AIS resource components are the closer
comparison. [Portsviews](https://github.com/jlorow/portsviews) is a visual/replay
reference, not evidence of a live feed. No source code or data from these
projects was imported. A renderer migration and additional providers are
deferred; code licenses do not grant rights to redistribute provider data.

Dense symbols can still overlap and rendering is capped at 250 visible records
per frame. Hardware performance is not certified. MARAD remains unavailable;
the existing dated MSCIO link is not a live-advisory replacement. Coverage and
provider-display prerequisites from the earlier provenance review still apply.
