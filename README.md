# Kehillot: A Digital Atlas of Jewish America, 1840–1870

A static website, digital atlas, and linked-open-data database of Jewish congregations, institutions, people, and events in the mid-nineteenth-century United States.

There's no server, database, or framework, and nothing to install. Node 18+ builds the site from plain JSON files into `dist/`, which any static host can serve (GitHub Pages, Netlify, an S3 bucket, a university web server, a USB stick).

```bash
npm run dev          # build with a localhost base URL and serve at http://localhost:8765/
npm run build   # production build for https://judaicadh.github.io/kehillot/
```

## What gets built

| Output | Purpose |
|---|---|
| `/` `/atlas/` `/database/` `/browse/` `/datasets/` `/about/` `/vocab/` | Site pages |
| `/{congregation,place,person,institution,event,source}/{id}/` | One page per record, with embedded JSON-LD, citation, sources, and a mini map |
| `…/{id}/index.jsonld` | Per-record JSON-LD (linked via `<link rel="alternate">`) |
| `data/kehillot.jsonld`, `data/kehillot.nt` | Full knowledge graph (JSON-LD and N-Triples) |
| `data/*.csv` + `data/csv-metadata.json` | Tables with W3C CSVW metadata |
| `data/atlas.geojson` | Mapped records |
| `data/places.lpf.json` | Gazetteer in Linked Places Format (World Historical Gazetteer) |
| `data/catalog.jsonld` | DCAT + VoID + schema.org `Dataset` description |
| `context.jsonld`, `vocab/` | Published JSON-LD context and SKOS / RDFS project vocabulary |
| `sitemap.xml`, `robots.txt`, `404.html`, `.nojekyll` | Hosting hygiene |

## Editing the data

All content lives in `data/`:

- `places.json`: the city-level gazetteer (lat/lon, state, region)
- `congregations.json`: `founded`, `rite`, `orientation`, `certainty`, `splitFrom`, `dissolved`, `dormant: [from, until]`
- `people.json`: biographical data, plus `roles` linking people to congregations and institutions with dates
- `organizations.json`: institutions (schools, societies, hospitals, fraternal orders)
- `periodicals.json`: newspapers and journals: `language` (BCP 47 codes), `frequency`, `founded`/`ceased`, `orientation`; editors are linked through people's `roles`
- `cemeteries.json`: burial grounds at their own coordinates: `address`, `lat`/`lon`, `precision` (`exact` | `approximate`), `established`, `closed`, `owners` (congregations)
- `sites.json`: places *within* cities, such as synagogue buildings, hospitals, and meeting places: `kind`, `address`, `lat`/`lon`, `precision`, `built`, and `occupants` (`[{org, from, to}]`) so a congregation's moves can be traced. Events can point to a site with `site`.

At national zoom the atlas shows one symbol per city. Past zoom 11 (or when you choose "inside the city" in the place index), it switches to a street basemap and shows sites and cemeteries at their addresses. The build rejects any site or cemetery placed more than about 35 km from its city.
- `events.json`: dated events (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`) with places, people, and organizations
- `sources.json`: the bibliography; every record must cite at least one source
- `wikidata.json`: hand-reviewed Wikidata matches (the only source of `sameAs` links)
- `population.json`: national population estimates shown on the home page

The build **validates** before it writes anything: unique kebab-case ids, every place, person, organization, and source reference resolves, controlled-vocabulary values exist, dates are well formed, and every claim is cited. A broken reference fails the build.

### Wikidata reconciliation

```bash
npm run reconcile    # writes data/wikidata-candidates.json
```

Review the candidates and copy only confirmed matches into `data/wikidata.json`. Unmatched records get no `sameAs` link; the build never guesses one.

## City guides

Every place with mapped sites, cemeteries or geotagged pictures gets a guide at `/city/{place}/`. Each guide has:

- a street map beside a list of sites you can filter and scrub through by year;
- each congregation's sequence of buildings and burial grounds;
- a gallery and a chronology.

Add an introduction and title for a city in `data/cities.json`. The list is plain HTML, so a guide still works without JavaScript.

The Cities directory also includes every locality recorded in the deposited subscriber lists, including places without a congregation or an address-level site. Subscriber-only pages are generated at stable `/city/subscriber-…/` URLs and show the recorded names, years, source citations, and a street map centered on the source locality. They do not assert a subscriber's street address or the existence of a congregation. Matches to existing curated places use reviewed Wikidata IDs; the source data is not changed.

The atlas, feature maps, and Subscribers map all have a city finder with quick jumps, city-guide links, and a National view reset. City and date filters survive in shared map URLs. Place records link directly to street views; city guides provide City center and Fit all recorded sites controls. The directory has a text filter and remains fully readable without JavaScript.

City guides also have a **city journey**: visible address-level records become numbered stops in date order. The selected year and categories determine the stops; Previous/Next moves the map and presents the original note, images when available, and source links. A tour's year, filters, and selected stop are kept in query parameters; Share this stop copies that URL. For example: `city/new-york/?year=1855&tour=1&stop=crosby-street-synagogue#journey`. Earlier fragment-parameter links are still accepted. It is a virtual history tour, not walking directions. Subscriber-only localities do not acquire invented street addresses or tour stops.

**Help locate this place** links on place, site, cemetery, and city-entry pages open the contribution desk with the original record and a reference point. Choosing **Locate a historical place** enables a clickable map and draggable proposed pin. Contributors must supply coordinates, building/block/street/city precision, the source date, a research explanation, and the main source citation. Reference and proposal points remain separate. The downloaded review packet (or configured form POST) includes all these fields; neither changes the curated data automatically.

`data/cities.json` accepts `mapSources: [{ "title": "…", "date": "1855", "url": "https://…" }]` to link to period maps. The default street layer is a neutral Esri Light Gray Canvas with sparse labels; tiles are overzoomed beyond native zoom 16. An optional `historicalMap` with `url` (HTTPS XYZ template containing `{z}`, `{x}`, `{y}`), a dated `label`, `attribution`, `sourceUrl`, and optional `maxZoom` exposes a translucent historical overlay on the guide. No historical tile layer is configured by default; linking a map image alone does not georeference it. Verify alignment and reuse terms before configuring a layer.



## Pictures and documents (linked media)

Add items to `data/media.json`, then fetch their metadata:

```bash
npm run media        # = node scripts/fetch-media.mjs; caches results in data/media-cache.json
```

| `source` | What to paste | What is read |
|---|---|---|
| `flickr` | a Flickr photo page URL | title, caption, date, license, image sizes, geotag |
| `flickr-album` (in `collections`) | a Flickr album URL | every photo in the album, plus the album title and description |
| `iiif` | a IIIF Presentation manifest URL (v2 or v3), e.g. from Penn Libraries or most museum and library repositories | label, metadata, rights statement, attribution, every page's IIIF image service |

For each item or album, list the records it is `about` (e.g. `{ "type": "cemetery", "id": "sonora-hebrew-cemetery" }`). The build checks that each one exists.

How the media layer works:

- **Placement:** geotagged pictures are placed on the matching city's map automatically.
- **Hosting and rights:** images are shown from the holder's server and keep the holder's license or rights statement. The site's CC BY license does not cover them.
- **Pages and data:** each item gets a page at `/media/{id}/` with credit, rights, and links back to the original, and is published as a `schema:ImageObject` with `schema:about` links. Multi-page IIIF items open in a deep-zoom viewer (OpenSeadragon, vendored).
- **Offline builds:** the cache is committed, so builds don't need the network. Run `npm run media -- --refresh` to re-read everything.

## Maps and visualizations

**Maps** (`/maps/`):

- a comprehensive map with every feature as a layer you can toggle;
- one map per feature: congregations, synagogues, cemeteries, clergy, educational institutions, matzah bakeries, hotels and boarding houses, kosher restaurants, Jewish-owned businesses, bookstores, societies, periodicals, events, pictures;
- the congregations Atlas and the Subscribers map.

All feature maps share `data/features.json`, written by the build, and `assets/js/featuremap.js`. To add a feature, add one entry to `FEATURES` in `scripts/build.mjs`: a symbol from `assets/js/symbols.js`, plus a function returning its items. The clergy map can also draw each clergy member's moves from pulpit to pulpit, based on their congregation roles in date order.

**Visualizations** (`/visualizations/`):

- a network of people, congregations, institutions and periodicals (roles, secessions, shared events), drawn with d3-force from `data/network.json`;
- a flow from rite at founding to orientation by 1870;
- congregations founded per decade, by region;
- clergy tenures;
- subscriptions per year, by paper.

The charts are SVG generated at build time, each with a table view and keyboard-accessible tooltips. Their colors are validated for colorblind separation and contrast in both light and dark mode.

## Research datasets and the subscriber layer

`data/media.json` also lists `datasets`, research data deposited elsewhere. Zenodo is supported:

```json
{ "source": "zenodo", "url": "https://zenodo.org/records/24148958", "use": "subscriptions",
  "about": [{ "type": "periodical", "id": "israelite" }] }
```

What `npm run media` does with each deposit:

- **Metadata:** reads the record through Zenodo's API (title, creators, DOI, license, files).
- **Download:** fetches the CSV into `.cache/` (git-ignored) and verifies its checksum.
- **Derivation:** for `use: "subscriptions"`, writes `data/readership/{periodical}.json`. This holds subscriptions by place and year, and the subscriber names.

Places are keyed by their Wikidata ID, so they join to Kehillot places through `data/wikidata.json`. If one ID is attached to different place names in the source, only the majority name keeps the ID, and each conflict is recorded in the derived file's `conflicts` list.

The build then produces:

- the **Subscribers** map (`/subscribers/`);
- subscriber sections on periodical, place and city-guide pages;
- `data/subscriptions-by-place.csv`;
- a `schema:Dataset` node for each deposit, with its DOI as identifier, linked from its periodical by `schema:subjectOf`.

## Contributions from others

Anyone can prepare additions and corrections at `/contribute/` without a GitHub account. The contribution desk downloads a sourced suggestion locally until an HTTPS `contribute.endpoint` is configured in `site.config.json`; with an endpoint, it posts to a review inbox. Editors review these submissions manually. Existing GitHub issue forms remain available from the desk. The site links to the contribution desk from every record ("Suggest a correction"), from the city guides and empty maps, and from the About page. Editors review each suggestion; adding the `accepted` label runs `.github/workflows/suggestions.yml`, which:

1. converts the form into a record (`scripts/issue-to-record.mjs`);
2. validates it with the full build;
3. opens a pull request for approval.

Contributors are credited on records (`contributors`, published as `schema:contributor`) and on `/contributors/`.

The forms in `.github/ISSUE_TEMPLATE/` are generated from `scripts/forms-spec.mjs` and the site's own data. Regenerate them after adding cities or categories:

```bash
npm run build && npm run forms
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the editorial policy and review steps.

## Linked data design

- **URIs**: `{BASE}congregation/emanu-el-ny/#this` identifies the congregation; `{BASE}congregation/emanu-el-ny/` is the page about it (the hash-URI pattern from *Cool URIs for the Semantic Web*, which needs no server-side 303 redirects).
- **Vocabularies**: schema.org (`Organization`, `Person`, `City`, `Event`, `Role`, `GeoCoordinates`), SKOS for rite, orientation, certainty, and category schemes, and a small `kh:` namespace for what schema.org lacks.
- **Time-bounded roles**: use the schema.org `Role` pattern (`Person → memberOf → Role{roleName,startDate,endDate} → memberOf → Organization`).
- **Dates**: typed as `xsd:gYear`, `xsd:gYearMonth`, or `xsd:date`, matching their precision.

## Deploying to GitHub Pages

1. Set `baseUrl` in `site.config.json` (or `BASE_URL` in CI) to the published URL, with a trailing slash.
2. `npm run build`
3. Publish `dist/`. For example, use a GitHub Action that uploads `dist/` with `actions/upload-pages-artifact`.

## Scope and caveats

This is a **seed dataset** drawn from the standard secondary literature (Sarna, Diner, Jick, Marcus, Korn, Sussman, the ISJL Encyclopedia). It is not a census. Records marked `medium` certainty have founding dates that vary between sources and should be checked before citing. Places are recorded at the city level.

## License

- **Code:** MIT. See [LICENSE](LICENSE).
- **Data and text:** CC BY 4.0. See [LICENSE-DATA.md](LICENSE-DATA.md).
- **Third-party material keeps its own terms**, all listed in LICENSE-DATA.md (vendored libraries now also include Leaflet.markercluster, MIT, and d3, ISC):
  - linked pictures and documents (each holder's license);
  - the deposited Zenodo datasets;
  - Leaflet (BSD-2-Clause) and OpenSeadragon (BSD-3-Clause);
  - basemap tiles (© Esri; © OpenStreetMap contributors).

### City and journey identifiers

Record entity URIs retain the existing `/{type}/{id}/#this` pattern, distinct from their HTML documents and `index.jsonld` representations. City-guide documents use their canonical `/city/{id}/` URL. Each publishes an embedded graph plus an alternate `/city/{id}/index.jsonld` representation. Its `#journey` identifies the complete ordered `schema:ItemList`; each `#stop-{type}-{id}` identifies a `schema:ListItem` linked to the original record's entity URI. Stop IDs use record IDs, never mutable stop numbers. A shared filtered journey URL is a view of this data and does not replace its canonical identifiers.

Subscriber-only city pages likewise publish a canonical WebPage and a `#locality` Place with source-dataset citations. Their source locality key is recorded as an identifier; unreviewed source QIDs are not promoted to `sameAs` assertions. These city-document graphs supplement the curated historical entity graph and are available from each guide's alternate link.

### Interface and research flow

The primary navigation is Map → City guides → Find a record → Data, with About and Contribute alongside. Map opens the comprehensive map directly; a secondary navigation links congregation time maps, newspaper subscribers, charts, and the map directory. Per-feature map URLs remain available through the map-view selector, which retains city and date context. Layers, date ranges, and specialized filters live in disclosures outside the map.

City guides have direct search/open controls and explicit guide links on map finders and point records. City journeys show one record at a time; background history, subscriber lists, complete site lists, and linked-data tools remain available behind disclosures. The default maps use a quiet gray canvas, with green accents on white page backgrounds. The mobile menu and controls share the same navigation structure.

Record search starts across all supported record types, including sources and media. Narrowing the type retains the typed query; refinements and CSV export remain available. Exported CSV URIs use the canonical publisher base URL and `#this`, even in a local preview. Data downloads are presented first by intended use, with the complete formats table retained. Chart navigation shows one visualization at a time when JavaScript is enabled; all charts and tables remain available without it.

### Occident article catalogue and claim evidence

`data/occident-articles.json` contains article-link metadata from the ten volume indexes linked at <http://www.theoccident.com/Occident/index.html> (1843–1853). It does not contain article transcriptions or the full 1843–1868 run. Links and their labels, including fragment sections, are retained; issue months come from URL paths. The searchable catalogue is at `sources/occident/`, with stable article-fragment URIs and JSON-LD. City-name title matches are research leads, not reviewed geographic or historical assertions.

To refresh the catalogue, download the ten volume `contents.html` pages as `1.html` through `10.html` into a temporary directory, then run `python3 scripts/import-occident.py /path/to/indexes`. Review the resulting metadata diff before building. Import does not run on visitors’ browsers.

`data/evidence.json` maps `type/id` → field → an array of `{source, locator, note?}`. The source must also occur in the record’s `sources` list; a page, passage, or equivalent locator is mandatory. Keep event dates distinct from issue dates, retain contradictory evidence, and never infer a street address from a locality point. Record pages publish shareable `#claim-FIELD` anchors and distinguish linked passages from record-level references. Evidence contributions use the existing editorial-review workflow, with claim, recorded value, and locator fields in the downloaded packet.

`site.config.json` configures the optional `terrain` overlay independently of default basemaps. It uses modern USGS shaded relief (native zoom through 16), enlarged above that level. `?terrain=1` enables the overlay, including in shared city-journey URLs. Relief is geographic context, not a reconstruction of historical topography.

### Magnes albums

The linked collection directory is at `collections/`. Each album has its own `#this` identity, JSON-LD membership list, source link, rights on individual items, and reviewed city-guide connections. The 15 added albums contain 410 photos. Their complete public photo lists were checked against Flickr’s displayed counts, including images loaded when scrolling; `photoUrls` and `expectedPhotoCount` retain these inventories in `data/media.json`. The importer and build reject incomplete configured collections rather than silently publishing the first page.

Run `node scripts/fetch-media.mjs --albums-only` for album metadata, or `node scripts/fetch-media.mjs --skip-datasets --concurrency=3` to resume missing image metadata without reprocessing readership datasets. The default concurrency remains one, with at most three workers and serialized checkpoints. Images stay on the source servers. `cityGuides` connections are reviewed associations, distinct from a geotag or a claim that every item depicts a location. `displayDate` is used only for an explicitly documented photograph date, preserving Flickr’s separate item date. The Nowinski cemetery surveys are identified as 1984 documentation, not nineteenth-century photographs.

### Institutions documented in the Occident

Institution records can use `documented: YEAR` when a cited report establishes activity but does not give a reliable founding year. Keep `founded` absent in that case. `documented` is exported separately in CSV/CSVW, GeoJSON and JSON-LD (`kh:documentedYear`); it never becomes `schema:foundingDate`. Date filters match the documentary year alone for such records, and city chronologies label it as documentation rather than foundation. Source passage locators are in `data/evidence.json`. Volume I reports supplied 14 additions and contemporary references for two existing Philadelphia institutions. Institutional reports, publication dates, and anniversary arithmetic are not interchangeable with founding dates.

The feature maps now use one record-type picker, a shared two-handle date range with directly editable years, and optional custom category combinations. The type links retain city, dates, name search and terrain state. Map city fields only zoom the map; a separate contextual city-guide link appears below the map after a city is chosen. Supporting pictures remain independent of historical date filtering and are labelled accordingly; many are later photographic documentation.


## Survey evidence in congregation and education datasets

Board of Delegates returns remain dated observations. The build joins their IDs and dates to congregation exports, publishes verbatim organization-date answers in `congregation-organization-reports.csv`, and links them from the time atlas. Adopted founding years are retained when the survey reports another date or event; no survey year becomes a founding year automatically.

Educational records supported by surveys live in `data/organizations.json`, with `surveyIds`, `schoolType`, optional `congregation`, and `documentedYears`. Precise scan locators are recorded in `data/evidence.json`. They appear in the database, education map, city education sections, institution CSV and linked data. `survey-institution-links.csv` exports the joins. Institution pages show dated school observations and link to full transcriptions.

Only explicitly identified Sunday/Sabbath schools are labelled that way. The Mobile day-school proposal is not treated as a completed opening, and the LaPorte report of informal Sabbath teaching alongside an explicit “No” school response does not create a school institution. Boston, Charleston, and Louisville survey-based school identities remain unresolved against earlier school records, as stated in their descriptions; these records must not be used as deduplicated school totals. Numeric snapshots retain the source dataset's extracted figures; missing entries are not zeros, and membership, school enrolment, and estimated Jewish families are distinct measures. The 1872 observations do not imply operation during the atlas's 1840–1870 window.
