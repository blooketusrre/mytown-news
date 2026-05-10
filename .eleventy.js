const path = require("path");
const { globSync } = require("glob");

module.exports = function (eleventyConfig) {

  // ── Passthrough copies ──────────────────────────────────────────────
  eleventyConfig.addPassthroughCopy("src/assets");

  // ── Filters ─────────────────────────────────────────────────────────
  eleventyConfig.addFilter("date_short", (str) => {
    if (!str) return "";
    const d = new Date(str);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  });

  eleventyConfig.addFilter("slugify_simple", (str) =>
    str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  );

  // Maps a directory entry's "notable" label to a CSS modifier class
  eleventyConfig.addFilter("badgeClass", (notable) => {
    if (!notable) return "";
    if (notable === "New") return "new";
    if (notable === "Coming Soon") return "coming";
    return "landmark";
  });

  // ── Global data: load latest issue for each cluster ──────────────────
  // The pipeline writes dated JSON files to src/content/<cluster>/.
  // This picks up the newest file each build so archives accumulate naturally.
  function latestIssue(clusterSlug) {
    const pattern = path.join(__dirname, `src/content/${clusterSlug}/*.json`);
    const files = globSync(pattern).sort().reverse();
    if (!files.length) return null;
    return require(files[0]);
  }

  eleventyConfig.addGlobalData("northWaterfront", () => latestIssue("north-waterfront"));

  // Add more clusters here as they go live:
  // eleventyConfig.addGlobalData("marinaAndPacificHeights", () => latestIssue("marina-pacific-heights"));

  // ── Collection: all cluster issues for archive ───────────────────────
  eleventyConfig.addCollection("allIssues", () => {
    const pattern = path.join(__dirname, "src/content/**/*.json");
    const files = globSync(pattern).sort().reverse();
    return files.map((f) => {
      const data = require(f);
      const parts = f.split(path.sep);
      const cluster = parts[parts.length - 2];
      const filename = parts[parts.length - 1].replace(".json", "");
      return { ...data, clusterSlug: cluster, weekOf: filename, filePath: f };
    });
  });

  // ── Config ───────────────────────────────────────────────────────────
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
