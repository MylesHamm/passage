# Third party notices

## 1 IBM Plex Sans

The bundled font files are from the Google Fonts distribution of IBM Plex Sans. The accompanying license is retained in `dist/assets/IBM-Plex-OFL.txt`. Original distribution: [Google Fonts IBM Plex Sans](https://github.com/google/fonts/tree/main/ofl/ibmplexsans). The dashboard serves these fonts locally.

## 2 Reference geography

`dist/assets/region.json` is a region-specific subset of Natural Earth’s 1:50m country polygons. Unneeded properties and countries were removed. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) describe the data as public domain. Original GeoJSON: [Natural Earth country boundaries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson).

Port reference points and dashed corridors are approximate context. The data is not a nautical chart.

## 3 Reporting and environmental data

News headlines remain attributable to their publishers. The dashboard links to the original report and does not reproduce full articles. Open-Meteo and DWD attribution appears in the marine panel. See [Open-Meteo licensing](https://open-meteo.com/en/licence) and [pricing](https://open-meteo.com/en/pricing) for data attribution and API-use conditions. Price observations are attributed to the U.S. Energy Information Administration.

## 4 Design reference

The supplied World Monitor archive identifies its package as version 2.10.0 with AGPL-3.0-only licensing. Its map-led organization and reporting concepts informed the design comparison. This repository contains an independently written application, with no World Monitor source code, copied logos, or proprietary assets. The original project is available at [koala73/worldmonitor](https://github.com/koala73/worldmonitor).

Cyberhill palette and typography values were supplied as design guidance. Passage uses its own working title and simple interface mark; it does not reproduce the Cyberhill logo in the application.

## 5 WebSocket client and AISStream

The application uses [ws](https://github.com/websockets/ws), version 8.21.3, under the MIT license. Its license is retained with the installed package and reproduced in `licenses/ws-MIT.txt`.

The vessel layer receives data from [AISStream](https://aisstream.io/), with source attribution in the map, vessel list, and detail view. Consult its [documentation](https://aisstream.io/documentation) for access and delivery limits. This integration does not promise complete vessel coverage or verify AIS identity.

## 6 Globe rendering

The browser serves a pinned local copy of [D3 7.9.0](https://github.com/d3/d3/tree/v7.9.0), under ISC. The license is retained in `licenses/d3-ISC.txt` and ships with the Pages bundle at `dist/vendor/d3-ISC.txt`. The vendored distribution is `dist/vendor/d3-7.9.0.min.js` (SHA-256 `f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539`).

`dist/assets/world-land.json` is Natural Earth's public-domain 1:110m land geometry, downloaded from its [maintained source repository](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson) on 13 September 2026. SHA-256: `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`. The geography and rendering library are served locally; the globe does not request a remote atlas, map API key, font service or tile server at runtime.

## 7 Anatomy explanatory SVG geometry

The conceptual oil-system figures use the [Anatomy SVG core](https://github.com/wheresryan22/anatomy), copyright (c) 2026 Ryan, under the MIT license. The unmodified core is retained at `dist/vendor/anatomy/iso-kit.mjs`, with its license at `dist/vendor/anatomy/LICENSE.txt`. SHA-256: `6d3ecc725d30c3b0346da309cf61dfa5a65017c23620bbd4093009d4fb104018`. [Graphics provenance and verification scope](docs/ANATOMY-GRAPHICS.md) records the source and adaptation. It is served locally without a remote runtime dependency. The original Passage objects are conceptual illustrations, not observed facility status, measured cargo flow, insurance premiums, or price effects.

## Discovery metadata

Bounded headline/link discovery is attributed to [The GDELT Project](https://www.gdeltproject.org/), using its public [DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/). Consult [GDELT's terms](https://www.gdeltproject.org/about.html#termsofuse). Article text and images retain their publishers' rights; Passage does not fetch or republish full article bodies through this integration. Only two maritime-route query families remain active. A discovery timestamp is not a publication or event timestamp, and capped results are not complete coverage.

## U.S. maritime advisory metadata

Official advisory metadata is attributed as “U.S. Maritime Advisories · MARAD host,” with each [original advisory](https://www.maritime.dot.gov/msci-advisories) linked. The [MSCI description](https://www.maritime.dot.gov/msci/maritime-security-communications-industry-msci-web-portal) identifies a coordinated government system; the advisories should not be attributed to a single originating agency.

Passage retains identifying metadata, source status, validity dates, geographic/threat labels, superseded IDs and links. It does not return advisory guidance bodies, contact details, logos, images or linked third-party documents. No blanket public-domain, bulk-redistribution, numerical-rate or uptime entitlement is claimed. Consult [MARAD web policies](https://www.maritime.dot.gov/about-us/web-policies/web-policies) and [USAGov copyright guidance](https://www.usa.gov/government-copyright). The implementation's source verification, reduced-fixture provenance and limitations are documented in `docs/source-advisories.md`. Advisory metadata is separate from incident coverage; effective and expiry dates are not publication or event timestamps.

## Regional terrain

Locally bundled [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) cover Hormuz and Bab el-Mandeb; SRTM/GMTED2010 are courtesy of the U.S. Geological Survey, with global ETOPO1 from NOAA. Downloaded 17 October 2026. Consult the [upstream attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Exact tile URLs, hashes, source metadata and transformations are recorded in `dist/terrain/assets/provenance.json`; public attribution and limitations are in `dist/terrain/ATTRIBUTION.txt`. This adds zero JavaScript dependencies. The regional terrain is static reference geography, with no bathymetry or navigation claim.
