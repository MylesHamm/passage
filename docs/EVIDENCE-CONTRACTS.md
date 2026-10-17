# Passage evidence contracts

## Evidence is not a threat score

Priority selection uses editorial headline-relevance rules, not severity, probability or a verified event classification. Titles and attribution remain unchanged. Category labels name reporting topics. Financial phrases such as “stocks sink” cannot acquire a physical-disruption category merely because the headline also mentions oil.

The default brief selects direct publisher records with publication clocks. Discovery-only records remain searchable in Reporting and Evidence; an explicit model option can inspect discovery separately. Matching headlines can supply additional original links, never independent confirmation or more severity.

## Independent clocks and coverage

Publication, event, discovery, source retrieval, first-seen, last-seen, forecast vintage and advisory validity are independent clocks. Day-only publication keeps day precision. Calendar-day filters use UTC calendar dates; comparisons may use a UTC midnight anchor without claiming a publication hour. A successful retry cannot re-date retained records.

Source health exposes separate transport/data status, successful-check age, content age, clock completeness and bounds. An unknown publication clock is not current reporting. A source can respond successfully while its content is old, undated or capped. Checked-empty requires an actual successful retrieval. Missing source metadata never means refreshed or clear waters.

Coverage summaries and exports retain source/query bounds, the 1,200-record reporting archive cap, local selection limits, unknown publication counts and historical-retention counts. Complete coverage is never claimed.

## One price-gap policy

Watch pulse, Energy and legacy Research use the same normalization and segmentation helpers. An explicit missing observation or an omitted interval longer than four calendar days breaks the line. Short omitted intervals, including ordinary weekends, may connect observed endpoints, with no interpolated price exposed. Singleton observations remain visible. Brent and WTI preserve their own dates. Report markers can remain visible when the price layer is unavailable.

A missing event date means no event-day price comparison. Even an exact calendar-day comparison does not measure a post-event reaction or causality.

## Retained undated evidence

Valid source links without publication dates remain in the evidence library, graph navigation and vessel-name research leads. They are excluded only from publication-axis placement. Timeline models expose reason-specific omitted records and reconciled counts, and the legacy view links to those records. Analyst event dates remain explicitly analyst supplied.

## Stable evidence kinds

The stable `recordKind` field distinguishes publisher reports, official register incidents, official statements, official advisories, agency assessments, independent analysis, forecasts, market observations, structured events and user notes. Display labels are generated centrally rather than used as model discriminators. Legacy records are normalized at the boundary without rewriting their original source text. Explicit validated kinds and forecast-completed dates survive actual archive persistence and restart; older v1 archives without these optional fields remain loadable.

## Collection changes

- Keep the five direct regional publisher feeds, UN/EIA analysis and existing independent analysis
- Retire CENTCOM's repeatedly failing default collector; preserve its adapter for rollback, cached diagnostics and archived evidence
- Retire GDELT Reuters-only, broad regional-export and general energy/diplomacy collection
- Keep two bounded GDELT maritime-route families at a 30-minute interval with shared provider backoff; the original discovery attribution and unknown publication status remain explicit
- Add only MARAD-hosted U.S. maritime advisory metadata as a complementary validity/status source; keep it separate from incidents and incident counts
- Do not enable UKMTO/JMIC as another default source: the sampled public JSON has unresolved revision, cancellation and date-consistency limitations

Retired source identities remain visible as retired. Retired caches are not fetched again and are not relabeled as current collection. Their records enter display only through the bounded archive using the original successful retrieval clock, subject to its ordinary retention and capacity policies. Missing retrieval clocks cannot establish retention eligibility. A caller without a reporting archive does not reinsert retired snapshots into live results. Original cache files remain preserved. No credentials, local user notes or saved preferences are deleted by this policy change.

See [advisory verification and reuse boundaries](source-advisories.md). Advisory expiry is recomputed when cached metadata is served. A failed refresh preserves the last successful retrieval time and exposes a retained state; a fresh fetch cannot make an expired advisory active.

## Release and regression gates

The public API readiness check requires recent successful checks for five direct publisher feeds, the two existing IMO sources, and Brent/WTI. Official-source event dates may be old; daily spot observations use the existing ten-calendar-day lag policy so weekends do not trigger a false failure. Supporting discovery/advisory/weather/account-backed gaps remain visible separately.

`test/evidence-contracts.test.mjs` exercises the fourteen audit scenarios through shared models, plus the exact audited financial-metaphor headline and partial-publication coverage. Detailed parser, retained-cache, expiry, path-segmentation, timeline, provenance, local-persistence and UI regressions remain in their focused test files.

A passing local suite is not proof of deployment, provider uptime, complete incident coverage, or a measured oil-market effect. The collector and Pages deployments remain separate release steps.
