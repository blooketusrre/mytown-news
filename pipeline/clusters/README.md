# Cluster Pipeline Configs

Each `.json` file in this directory configures one neighborhood cluster for the weekly content generator.

## Schema

```json
{
  "slug": "slug-matching-src-content-dir",
  "name": "Human-readable cluster name",
  "live": true,
  "neighborhoods": ["Neighborhood A", "Neighborhood B"],
  "accentColor": "#hexcolor",
  "description": "One-sentence description for the homepage.",
  "primarySearchTerms": ["search term 1", "search term 2"],
  "sourceHints": ["https://url1", "https://url2"]
}
```

## Adding a new cluster

1. Create `pipeline/clusters/<slug>.json` using the schema above — set `"live": false` until content and templates are ready.
2. Add the cluster entry to `src/_data/clusters.json` (used by the homepage map and footer).
3. Create `src/<slug>/` directory with:
   - `index.njk` (front matter: layout, clusterSlug, pageTitle, pageDesc)
   - `<slug>.11tydata.js` (copy from north-waterfront, update the path)
4. Set `"live": true` in both config files when ready.
5. The pipeline will begin generating weekly issues automatically on the next Friday run.
