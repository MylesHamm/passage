# Observed tanker marker

## Concept written before geometry

Figure tier, adapting Passage's existing tanker: a small, detailed tanker symbol
marks a reported AIS position. Its bow follows a valid reported heading, or a
clearly identified course fallback. With neither, a circular marker preserves
the position without inventing a bow direction. The geographic map, not this
illustration, places the symbol and transforms its bearing into screen space.

The illustration is a generic tanker, not a reconstruction of the particular
vessel. Its constant 24–36 CSS-pixel size does not describe vessel dimensions,
cargo, loading, draft, navigable clearance or scale on the map. Position changes
come only from new accepted observations. There is no extrapolation, wake, idle
sailing, repeating motion or animated cargo.

## Parts planned before geometry

Reuse the accepted long hull, pointed bow, stern accommodation and low tanker
deck fittings from `dist/oil-system-art.mjs`. The map symbol omits its presentation
plinth and inspection cutaway.

Planned parts: hull and deck; twelve low hatch bases and twelve hatch covers;
three transverse deck manifolds and one main manifold; two longitudinal deck
runs and four flange blocks; windlass foundation and two windlass drums; two bow
bollards and two stern bollards; accommodation foundation, accommodation block,
bridge wings, wheelhouse and bridge roof; five bridge windows; funnel and cap;
mast and radar bar. These 57 parts are schematic and have no per-vessel counts.

## Skill and license provenance

The actual [Anatomy skill](https://github.com/wheresryan22/anatomy/blob/main/SKILL.md)
was read on 20 October 2026, along with applicable sections of its
`references/craft.md`, `references/kit.md`, `references/motion.md` and
`examples/dial-indicator/build.mjs`. This was a read of upstream `main`, not a
pinned skill revision; no assertion is made that its instructions are identical
to the 17 October read recorded in `ANATOMY-GRAPHICS.md`.

The unchanged, already vendored `dist/vendor/anatomy/iso-kit.mjs` provides the
projection and solid geometry. Its SHA-256 is
`6d3ecc725d30c3b0346da309cf61dfa5a65017c23620bbd4093009d4fb104018`.
Its adjacent MIT license and Copyright (c) 2026 Ryan remain required. No
additional dependency, upstream implementation or runtime request is added.

## Integration contract

`tankerPresentation(vessel, now)` is pure; `now` is epoch milliseconds. It uses
`positionTime`, coordinates, `shipTypeCode` and type-metadata provenance from the
existing normalized vessel record. Only explicit AIS tanker codes 80–89 qualify.
The string `shipType: 'tanker'`, vessel name, dimensions and speed never establish
that category. Explicitly expired, future or invalid type dates are rejected;
undated type metadata cannot be borrowed from another provider.

Position age always comes from `positionTime`, never API refresh or caller
supplied `ageSeconds`. Positions become stale at ten minutes and disappear at
thirty minutes. Missing, future or invalid position times and coordinates are
ineligible. `timestampBasis` and `timestampLabel` distinguish provider time,
receipt time and an unknown basis; fresh receipt does not prove fresh upstream
observation.

The return value exposes `visible`, `marker` (`tanker`, `neutral`, `none`),
`point`, `bearingDegrees`, `bearingBasis`, `orientationLabel`, `ageSeconds`,
`stale`, `expired`, `positionTime`, `expiresAt`, `timestampBasis`,
`timestampLabel`, and `typeStatus`. `headingDegrees` in [0, 360) takes precedence
over valid `courseDegrees`. AIS unavailable codes, nulls, strings and malformed
angles never become a direction.

`tankerSvg(presentation, {size: 32})` returns static, self-contained SVG markup,
or an empty string for an ineligible presentation. Size is bounded to 24–36 CSS
pixels. The unrotated bow points straight up; the geographic map must project
the reported bearing and rotate the symbol about its centered anchor. This is
an oriented map symbol, not a camera-aligned physical 3D reconstruction.
The SVG is decorative inside the existing accessible vessel button; the caller
must include orientation, age and timestamp-basis disclosures in its accessible
label or inspector. A neutral circle has no bow. No vessel text enters the SVG.

## Release and verification limits

The parent integration keeps this feature off in production until public-display
rights and timestamp provenance for the actual provider are verified. Drawing
permission and data-redistribution permission are separate.

Tests cover eligibility, exact expiry boundaries, heading precedence, unknown
direction, metadata age, timestamp disclosures, immutability, deterministic art,
size limits and absence of active content. The complete serial repository suite
passed all 739 tests on 20 October 2026.

The full upstream Anatomy clearance/depth and line-end audit tools are not
vendored. This implementation does not claim those audits passed. Isolated
desktop/mobile fixture checks covered map rendering, heading and course
orientation, keyboard selection, position updates, stale/expired positions and
reduced-motion settings. The 4× model detail was also visually inspected.
Dense ordinary symbols can overlap; these checks are not physical-device
performance certification or live-provider validation. See
`BOTH-MAP-VERIFICATION.md` for candidate provenance and remaining release gates.

The geographic integration is opt-in only through the renderer's third
argument `{tankerModels: true}`. The application does not supply that option.
The local review harness injects it alongside clearly labeled synthetic data.
At most eight detailed models are drawn per frame; other received positions
keep ordinary glyphs. Four cached SVG-image appearances avoid copying the
57-part geometry into every marker's DOM. Snapshot-only Open Waters records
are excluded even when their last-message time is recent.
