# Passage explanatory graphics

## Design contract

Figure-sized refinement of the existing four oil-system objects. The reader selects a channel, identifies the physical component involved, and reads what evidence would establish an effect. The same selection powers the illustration, numbered controls, explanatory text and accessible status. No geometry, animation, highlight or component count represents a current observation, a cargo volume, a premium, or a price forecast.

The approved tanker silhouette and matching terminal, harbor office and market desk are preserved. A cargo-deck inspection reveals schematic compartments only when the reader separates the illustration. The loading outlet, cover documents and price-record desk remain discrete objects. There is no line or arrow from a report or physical object to a price.

## Source and method

The actual Anatomy skill was read from [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy/blob/main/SKILL.md) on 17 October 2026, together with its craft, kit, motion and verification references and dial-indicator example. The official `kit/iso-kit.mjs` is vendored unchanged under `dist/vendor/anatomy/`; its MIT license is adjacent. The original illustrations are Passage artwork. The geometry adapter keeps their accepted camera and proportions while using Anatomy projection, solid geometry and four-tone shading.

Pinned source-content SHA-256: `6d3ecc725d30c3b0346da309cf61dfa5a65017c23620bbd4093009d4fb104018`. The runtime performs no external Anatomy request and installs no dependency. Copyright (c) 2026 Ryan, MIT license.

This is a conceptual source-inspection figure, not a physical flow simulation. There is deliberately no idle tour: the reader's evidence selection must remain stable and source refreshes must not move it. Existing pointer and keyboard controls, hidden-tab/offscreen motion gating, and reduced-motion support remain authoritative. The only added motion opens the selected tanker's deck to expose its structure; no liquid level or operating state animates.

## Parts planned before geometry

- Export terminal: two tank foundations, two cylindrical shells, four weld seams, two roofs, two access hatches, two vents and caps, four ladder rails, fourteen ladder rungs, two access platforms, four pipe supports, two manifold runs, two valve bodies/stems/wheels, pump bed, pump casing, motor top, motor hatch/cap, cooling ribs, four mounting bolts, loading outlet, outlet flange, cabinet, door, grille and handle
- Tanker: long water base and sides, closed hull and waterline, removable inspection deck, twelve schematic cargo cells, central divider and cross-bulkheads, twelve low tank hatches and covers, three cross-manifolds, main manifold, four flange blocks, two deck pipes, forward windlass and bollards, bow rail and supports, accommodation base, stern block, bridge wings, wheelhouse, six windows, roof, two deck seams, funnel/cap, mast/crossbar/radar, stern bollards
- Cover office: foundation and structure, three glazed windows and mullions, three sills, framed door, lintel, handle, kickplate, physical cover notice and its printed rules, roof/overhang, four parapets, ventilation box and four slots, thick shield and seam, two steps, two railings, two quay bollard assemblies
- Market desk: footing, two cabinets, three drawer lines and pulls, equipment recess and four vents, worktop and four screws, two display feet/stems/cases/windows/reflections, two display controls, keyboard and eighteen keys, pointer device, separate physical record folios on the desk. Display glass contains no invented trend or value

## Verification performed · 17 October 2026

- 20 focused art/model/view tests passed, including deterministic finite geometry, common projection, unique stage hooks, no fabricated metric text or directional price connector, safe escaping, source-refresh selection retention and keyboard behavior
- The full application suite passed at the integration checkpoint: 569 tests, no failures. Other implementation work was still in progress, so release review must rerun the complete suite
- A 93-file Pages build included the graphics modules, stylesheet, locally vendored Anatomy core and MIT license. Test fixtures and screenshots remain outside `dist`
- Cloud Chromium visual checks covered all four objects, assembled and separated tanker states, keyboard selection and approximately 4× close-ups. Desktop viewport was 1180 CSS pixels; embedded 390- and 320-pixel browsing contexts exercised the actual narrow-layout rules with no horizontal overflow
- The reduced-motion branch was exercised through the view's explicit `motionPreference` dependency. Its deck transition was zero seconds while the final separated structure remained visible. This is a test harness override, not an operating-system preference change
- The exact integrated Energy view was also exercised using a prominently labeled, local recorded-API review. The oil data recording was unavailable and the app correctly displayed that state. The explainer retained selection, opened its cutaway and contained no duplicate price quote tiles

Screenshots and the isolated test harness are retained under `test-results/anatomy/`. This verifies presentation and interaction, not real-world vessel specifications or facility operating status. No physical iOS/Safari or screen-reader run was performed. The inherited art is not claimed to have passed Anatomy’s full volumetric pipe-clearance audit; a visual check is not a geometry proof.
