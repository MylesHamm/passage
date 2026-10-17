# Regional terrain

The main Watch uses controlled regional views of Hormuz and Bab el-Mandeb. The dependency-free renderer uses WebGL where available and a 2D elevation-based plan when it is not. Camera movement is bounded, responds to a user action, then stops. Geographic labels and infrastructure are approximate references. Received positions retain their source timestamps; reporting does not invent map coordinates.

## Source and transformations

Mapzen Terrain Tiles, with SRTM/GMTED2010 data credited to USGS and ETOPO1 to NOAA. See [source rights](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), [encoding](https://github.com/tilezen/joerd/blob/master/docs/formats.md), the bundled [attribution](../dist/terrain/ATTRIBUTION.txt), and exact [provenance manifest](../dist/terrain/assets/provenance.json).

Each region combines 16 zoom 8 Terrarium tiles. The 256×256 mesh uses actual source-grid elevation, and 1024×1024 normal/coast textures preserve more source detail. Relief is exaggerated 4×, water is flat, and the zero-elevation boundary approximates the coastline. Source/mesh spacing is about 0.55/2.2km at Hormuz and 0.60/2.4km at Bab. Source tiles were modified in 2017 and retrieved 17 October 2026; modification is not survey date. Lighting colors do not represent satellite imagery. Source artifacts can remain, including an isolated anomalous Bab source sample described in the attribution.

The reproducible processor is `scripts/terrain/build_assets.py` (Python, Pillow, NumPy, SciPy). Source tiles cache outside the public bundle. Runtime loads only bundled assets. Public publishing narrowly permits the two required elevation binaries; tests and recorded API responses are excluded from Pages.

## Limits

This is static reference geography, not observed traffic, present operating status, bathymetry, a flood model or a navigable chart. GPU rendering can be unavailable due to browser/device capabilities; the UI states its fallback explicitly. Performance and appearance depend on the device and need device-specific review.
