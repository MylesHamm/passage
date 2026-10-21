# Third party notices

## 1 IBM Plex Sans

The bundled font files are from the Google Fonts distribution of IBM Plex Sans. The license is retained in `dist/assets/IBM-Plex-OFL.txt`. Original distribution: [Google Fonts IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans).

## 2 WebSocket client

The collector uses [ws](https://github.com/websockets/ws), version 8.21.3, under the MIT license. Its license is reproduced in `licenses/ws-MIT.txt`.

## 3 Anatomy

Tanker models are drawn with the [Anatomy SVG core](https://github.com/wheresryan22/anatomy), copyright (c) 2026 Ryan, under the MIT license. The unmodified core and its license are retained at `dist/vendor/anatomy/`.

## 4 Regional terrain

Locally bundled [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) cover the Strait of Hormuz and the Gulf-to-Red Sea theatre. SRTM and GMTED2010 data are courtesy of the U.S. Geological Survey, with global ETOPO1 data from NOAA. See the [upstream attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Exact tile URLs, hashes and transformations are recorded in `dist/terrain/assets/provenance.json` and `dist/terrain/ATTRIBUTION.txt`. The terrain is static reference geography, not a nautical chart.

## 5 Data sources

Each panel names its source, and the About the data panel lists every source with its status and latest date.

- **Vessel positions:** [AISStream](https://aisstream.io/), received through a server-side connection. Coverage depends on its receiver network.
- **Daily chokepoint transits:** Sources: UN Global Platform; IMF PortWatch ([portwatch.imf.org](https://portwatch.imf.org)). Data are used under the [IMF terms](https://www.imf.org/en/about/copyright-and-terms) with attribution and are not modified.
- **Oil prices:** U.S. Energy Information Administration daily spot prices and [Today in Energy](https://www.eia.gov/todayinenergy/prices.php) closes. EIA data are public domain; EIA notes that its spot prices are republished from Refinitiv.
- **Market odds:** public [Polymarket](https://polymarket.com/) market prices, linked to each market. They express market expectations, not confirmation of events.
- **Incident register:** the [IMO](https://www.imo.org/) Middle East highlighted incidents pages, linked to the original.
- **Headlines:** BBC, Al Jazeera, Middle East Eye, Middle East Monitor, France 24 and UN News. Headlines stay attributable to their publishers and link to the original report; full articles are not reproduced.
