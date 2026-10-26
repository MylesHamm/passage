# Open Waters snapshot provenance

The existing `/v1/vessels` integration returns cached vessel state, not a
position-report event. In the reviewed upstream implementation, any accepted
message can advance `seen`, `source`, `station` and `msg_type` while cached
coordinates remain unchanged. The internal position clock is not exported.
Requiring `msg_type: PositionReport` does not repair that missing provenance.

Source reviewed:
[aiscast `server/vessels.go`, commit 6439a98](https://github.com/openwatersio/aiscast/blob/6439a98b2e8df94a2a416ada87ef4980ab4722b5/server/vessels.go).

`parseOpenWaters` therefore marks every row `positionEvidence: 'snapshot'`.
`lastMessageAt`, `lastMessageSource`, `lastMessageStation` and `lastMessageType`
retain the supplied message metadata. `positionObservedAt` and `positionSource`
remain null. A coordinate-bearing snapshot is not eligible as a current
position observation merely because its last message is recent.

For existing retention callers, `positionTime` remains an alias of
`retentionTime`, using valid last-message time or the local snapshot receipt
time. `sourceAt` aliases `lastMessageAt`; `providerSource` aliases the latest
message source when supplied. Those compatibility fields do not establish
coordinate age or origin. `timestampBasis` and `timestampNote` state that limit.

`parseOpenWatersAttribution` extracts the response-level credits as bounded
plain text. The data service preserves that map once on the
source envelope and reports snapshotCount separately from current recordCount. Collection credits are not a per-coordinate license or a
permission filter: the latest-message source may differ from the source of
the cached geometry.

No new endpoint, event subscription or credential is introduced by this change.
Activating an event-based integration requires separately verified provider
permissions and provenance from actual decoded position payloads. No backend
deployment is included.

The shared position merger, both geographic renderers and tanker-model
presentation exclude these snapshots. The frontend also excludes legacy
Open Waters rows from the current deployed backend and explains their absence.
A last-message clock cannot replace an AISStream position or enrich its type.
AISStream now requires coordinates in the actual position payload, preserves
providerReportAt separately from receivedAt, and rejects metadata-only geometry.
Provider report time is not represented as verified GNSS observation time.

## Update, 26 October 2026: the event stream

Passage now reads Open Waters from its native event stream
(`wss://ais.openwaters.io/v1/stream`, `lib/openwaters.mjs`), not from
`/v1/vessels`. Each stream event is one decoded AIS message with its own
receive time, `source`, `license` and `attribution`. Only the decoded `message`
reaches the shared `VesselStore`, through the same validation as AISStream:
coordinates from the position payload only, provider time, the 30 minute
expiry, out of order rejection and the 60 knot track rule. The event's own
`lat`/`lon` fields are never used. The subscription asks for `snapshot: true`,
which replays each tracked ship's last messages first; each is still a dated
message and is checked the same way, so an old one is rejected rather than
shown as current. The snapshot endpoint remains excluded for the reason above.
