# PR 8 release review — 20 October 2026

The user approved merging and publishing the Both-map and AIS-provenance fixes
after an additional ultra-effort review. Two fresh reviewers ran at ultra
reasoning effort: one examined map/UI behavior, the other AIS/backend behavior.
The backend reviewer also requested an independent storage/cache edge-case
review. Reviewers inspected tests before implementation and did not change
files or run competing test/browser processes.

No release-blocking defect was found. One warning-priority regression was
corrected: Open Waters provenance warnings could displace a cache-save failure
from the summary and panel notice. Cache failure attention now takes priority,
while the snapshot's unknown coordinate clock and provenance label remain.
The regression failed before the fix and passed after it, including the
combined transport-failure case. The fix was independently reviewed.

Serial validation passed 740 tests, syntax checks, the 105-file Pages build
and the Worker dry-run bundle. Twenty final-candidate fixture browser checks
passed with no page errors; source disclosure cards, the model map and 4× detail
were inspected. The isolated browser closed afterward.
The release-candidate artifact fingerprint is
`e20e4435371e1bebbeb408d884aeb0caaafac06e857a034e75959c9006bf1dd5`.
Its manifest hashes each emitted file; the fingerprint hashes the sorted
`path + NUL + sha256 + newline` entries. Build configuration uses `/passage/`
and the existing public `passage-live-api` URL.

The original map/layout validation and remaining limitations are recorded in
`BOTH-MAP-VERIFICATION.md`. New release evidence is kept locally in the task's
`evidence/release-pr8-2026-10-20/` directory. Test fixtures do not establish live
upstream coverage or provider display permission.

## Deployment and rollback boundaries

Use the repository's normal merge, `npm run cloud:deploy` and reviewed Pages
workflow. Preserve Worker `passage-live-api`, class `PassageCollector`, migration
`v1` and singleton `passage-public-collector-v1`. Deployed nonsecret variables
and the existing Durable Object binding matched the reviewed configuration.
No authentication, credentials, provider or security configuration is changed.

Before release, the Worker version was
`ef3302b6-5862-4f77-bf2b-8ceebeecdadb` (deployment
`cd3fe4b8-86ea-4448-a436-1f08b9e59da6`). The prior frontend source was main commit
`bbbd811bd9f9e2873cf902f6962717294156649d`.
A rollback must restore reviewed code without deleting the Durable Object or
its data; Worker-code rollback does not reverse stored-data changes.

The new Open Waters cache key intentionally rejects legacy snapshot semantics.
It also resets an old key's retry deadline once; no evidence established an
outstanding provider cooldown during review. Provider failures after deployment
must remain visible and retain their normal backoff.

Production tanker models remain disabled pending verified public-display rights
and trustworthy position updates. MARAD remains unavailable. Any failed live
verification or publication gate must be reported as a release limitation,
without retrying denied routes or weakening the gate.
