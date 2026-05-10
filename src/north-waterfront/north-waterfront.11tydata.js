const path = require("path");
const { globSync } = require("glob");

module.exports = function () {
  // Always load the latest issue file for this cluster
  const pattern = path.join(__dirname, "../content/north-waterfront/*.json");
  const files = globSync(pattern).sort().reverse();
  if (!files.length) return { issue: null };
  const issue = require(files[0]);
  return { issue };
};
