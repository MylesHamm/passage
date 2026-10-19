# U.S. Maritime Advisories: retired collection and historical metadata

Collection retired on 19 October 2026. The production Worker consistently received HTTP 403 while the same ordinary requests succeeded from the connected Mac. No access restriction was bypassed. Passage no longer polls this source or lists it as an active feed. Current official advisory coverage is explicitly unavailable; this is not an all-clear.

The parser and original fixtures remain to preserve the meaning of any validated historical snapshots. Retired records keep their original retrieval dates, source links and validity dates; calendar expiry is recomputed without treating it as a new source check. The earlier evaluation below records the evidence behind the original adapter, not a claim of current availability.

Verified 17 October 2026, approximately 04:47–04:49 UTC. No account, credentials, stored cookies, proxy workaround, or access-denial bypass was used. These are point-in-time access observations, not an uptime or completeness guarantee.

## Why this source

The [MARAD-hosted advisory index](https://www.maritime.dot.gov/msci-advisories) and the two relevant active detail pages returned ordinary HTTP 200 HTML to unauthenticated GET requests. Their useful fields are server-rendered. This is a narrow addition for warning validity/status, not another incident counter.

- [2026-011, Persian Gulf / Strait of Hormuz / Gulf of Oman](https://www.maritime.dot.gov/msci/2026-011-persian-gulf-strait-hormuz-and-gulf-oman-iranian-attacks-commercial-vessels): source status Active, effective 9 September 2026, expiry 8 March 2027, explicitly supersedes and cancels 2026-004
- [2026-013, Red Sea / Bab el Mandeb and adjacent waters](https://www.maritime.dot.gov/msci/2026-013-red-sea-bab-el-mandeb-strait-gulf-aden-arabian-sea-and-somali-basin-houthi-attacks): Active, effective 23 September 2026, expiry 22 March 2027, explicitly supersedes and cancels 2026-006
- [2026-006](https://www.maritime.dot.gov/msci/2026-006-red-sea-bab-el-mandeb-strait-gulf-aden-arabian-sea-and-somali-basin-houthi-attacks) is marked Cancelled in both index and detail

## Attribution and reuse boundary

Use the attribution “U.S. Maritime Advisories · MARAD host,” with the original advisory link and ID. The [MSCI explanation](https://www.maritime.dot.gov/msci/maritime-security-communications-industry-msci-web-portal) identifies a coordinated U.S. government system and explicitly says messages should not be attributed to a single originating agency. An advisory provides guidance; an alert provides more basic reported-threat information. Neither label establishes comprehensive incident coverage.

The adapter republishes only bounded identifying metadata, source status, geographic/threat labels, calendar validity dates, superseded IDs, and links. It does not return guidance text, descriptions, contacts, logos, images, or linked third-party documents. No MARAD-specific bulk redistribution licence, API contract, rate entitlement, or SLA was verified. [MARAD web policies](https://www.maritime.dot.gov/about-us/web-policies/web-policies) describe a public information site and possible maintenance outages. [USAGov copyright guidance](https://www.usa.gov/government-copyright) warns that appearance on a federal website alone does not establish unrestricted reuse, particularly for third-party material and logos. This implementation therefore makes no blanket public-domain or commercial-republication claim.

## Parser and lifecycle contract

- `MARAD_SOURCE`: fixed index URL, source ID `marad-advisories`, historical interval 3,600 seconds; collection is now disabled
- `parseMaradAdvisoriesIndex(html, now)`: validates separate Active/Cancelled tables and four named columns, then selects titles mentioning the two supported theatres
- `parseMaradAdvisoryPage(html, indexRecord, now)`: validates matching title, ID, status, date labels and machine-date calendar components; returns metadata only
- `loadMaradAdvisories(fetchText, now)`: fixed index plus relevant active detail URLs, sequentially and bounded to 12 details. Returns `{advisories, recordCount, coverage, url, access, latest:null, sourceUpdatedDate:null}`
- `maradValidity(record, now)`: returns `active`, `not-yet-effective`, `expired`, `cancelled`, `superseded`, or `unknown`. Recompute this for retained cached records when serving them; an ingestion-time state must not outlive its calendar validity

`sourceStatus` is the publisher's status. `validityState` is separately derived. Explicit supersession preserves both IDs even when the previous record is absent from the first cancelled-index page. No disappearance-based cancellation or supersession inference is made. Cancelled history is deliberately partial and labelled as such.

Effective/expiry dates are day precision. The HTML contains noon UTC machine timestamps but presents calendar dates to readers; the adapter does not claim a precise expiry instant. Publication, event, and publisher update dates remain unknown. HTTP Last-Modified and retrieval time are not substituted for those dates.

Empty/challenge pages, zero matching active records, changed columns, truncated rows, duplicate IDs, unsafe links, impossible dates, conflicting index/detail fields, and failed detail retrieval throw. The caller should retain the last good snapshot with its original retrieval clock and visible failure/staleness state. A failure or empty parse is never an all-clear. Advisories must stay separate from incident records and counts.

## Fixtures and limits

`test/fixtures/marad/` contains reduced metadata fixtures derived from the actual responses, with source URLs, response types, raw hashes, fixture hashes, and sanitization notes in `provenance.json`. Advisory prose and transport cookies are excluded. The tests cover active/cancelled/superseded states, previous IDs, unknown/invalid dates, expiry, access failures, schema drift, and ambiguous zero results.

UKMTO/JMIC was not enabled alongside this source. Its public page-owned JSON routes proved readable without credentials, correcting the earlier empty-HTML extraction limitation. However, the sampled incident JSON has no explicit revision/cancellation contract and conflicts between some structured times/types and narrative. It needs a separate evidence-quality review before adoption. The selected MARAD adapter does not claim to close that incident-coverage gap.
