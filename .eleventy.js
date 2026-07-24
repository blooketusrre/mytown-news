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

  // Groups an array of objects by a named key → { groupName: [items, …] }
  eleventyConfig.addFilter("groupBy", (arr, key) => {
    if (!Array.isArray(arr)) return {};
    return arr.reduce((acc, item) => {
      const group = (item && item[key]) ? String(item[key]).trim() : "Other";
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    }, {});
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

  eleventyConfig.addGlobalData("northWaterfront",         () => latestIssue("north-waterfront"));
  eleventyConfig.addGlobalData("marinaPacificHeights",    () => latestIssue("marina-pacific-heights"));
  eleventyConfig.addGlobalData("russianHillNobHill",      () => latestIssue("russian-hill-nob-hill"));
  eleventyConfig.addGlobalData("presidioRichmond",        () => latestIssue("presidio-richmond"));
  eleventyConfig.addGlobalData("downtownEmbarcadero",     () => latestIssue("downtown-embarcadero"));
  eleventyConfig.addGlobalData("civicCenterHayesValley",  () => latestIssue("civic-center-hayes-valley"));
  eleventyConfig.addGlobalData("somaMissionBay",          () => latestIssue("soma-mission-bay"));
  eleventyConfig.addGlobalData("haightColeValley",        () => latestIssue("haight-cole-valley"));
  eleventyConfig.addGlobalData("castroNoeValley",         () => latestIssue("castro-noe-valley"));
  eleventyConfig.addGlobalData("missionBernalHeights",    () => latestIssue("mission-bernal-heights"));
  eleventyConfig.addGlobalData("theSunset",               () => latestIssue("the-sunset"));
  eleventyConfig.addGlobalData("bayviewExcelsior",        () => latestIssue("bayview-excelsior"));

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
