const fs   = require("fs");
const path = require("path");
const { globSync } = require("glob");

module.exports = function (eleventyConfig) {

  // ── Passthrough copies ──────────────────────────────────────────────
  eleventyConfig.addPassthroughCopy("src/assets");

  // ── Shortcodes ──────────────────────────────────────────────────────
  // Inline the brand mark straight from the asset file rather than pasting a
  // second copy of the paths into a template. Duplicated artwork is how the
  // share card ended up still showing the old logo after the mark changed —
  // there is exactly one source of this shape and this reads from it.
  eleventyConfig.addShortcode("inlineMark", () => {
    const svg = fs.readFileSync(
      path.join(__dirname, "src/assets/img/mark-mono.svg"), "utf8");
    return svg
      .replace(/<title[\s\S]*?<\/title>\s*/g, "")   // the link carries the label
      .replace(/<desc[\s\S]*?<\/desc>\s*/g, "")
      .replace(/\s*role="img"\s*/, " ")
      .replace(/\s*aria-labelledby="[^"]*"/, "")
      .replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
  });

  // ── Filters ─────────────────────────────────────────────────────────
  eleventyConfig.addFilter("date_short", (str) => {
    if (!str) return "";
    const d = new Date(str);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  });

  eleventyConfig.addFilter("slugify_simple", (str) =>
    str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  );

  // Trims story body copy to a word budget, cutting at a sentence boundary
  // where possible so the excerpt reads as finished prose rather than a
  // mid-clause snap. Paragraph breaks collapse to single spaces.
  // Tokens that end in a period without ending a sentence
  const ABBREV = new Set([
    "st", "ave", "blvd", "rd", "dr", "ln", "ct", "pl", "sq", "hwy",
    "mr", "mrs", "ms", "jr", "sr", "prof", "gov", "sen", "rep", "supt",
    "inc", "co", "corp", "ltd", "no", "vs", "approx", "est", "dept",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "a.m", "p.m", "u.s",
  ]);

  eleventyConfig.addFilter("excerpt", (str, maxWords = 60) => {
    if (!str) return "";
    const text  = String(str).replace(/\s+/g, " ").trim();
    const words = text.split(" ");
    if (words.length <= maxWords) return text;

    const clipped = words.slice(0, maxWords).join(" ");

    // Walk back for a true sentence end: terminal punctuation followed by a
    // space and a capital letter, where the preceding token isn't an
    // abbreviation ("350 Bay St. inside" must not read as a sentence break).
    const re = /([.!?])\s+(?=[A-Z"“'])/g;
    let cut = -1, m;
    while ((m = re.exec(clipped)) !== null) {
      const head = clipped.slice(0, m.index);
      const prev = (head.split(/[\s(]/).pop() || "").toLowerCase();
      if (ABBREV.has(prev) || /^[a-z]$/.test(prev)) continue; // initials too
      cut = m.index;
    }

    // Only honour it if we keep most of the budget; otherwise clip and ellipse
    if (cut > clipped.length * 0.55) return clipped.slice(0, cut + 1);
    return clipped.replace(/[,;:\s]+$/, "") + "…";
  });

  // Maps a directory entry's "notable" label to a CSS modifier class
  eleventyConfig.addFilter("badgeClass", (notable) => {
    if (!notable) return "";
    if (notable === "New") return "new";
    if (notable === "Coming Soon") return "coming";
    return "landmark";
  });

  // Looks up one edition in clusters.json by slug. Nunjucks cannot assign a
  // variable from inside a {% for %} in a way that survives the loop, so a
  // filter is the practical way to reach the edition record from a template.
  eleventyConfig.addFilter("bySlug", (list, slug) => {
    if (!Array.isArray(list) || !slug) return null;
    return list.find((c) => c && c.slug === slug) || null;
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
