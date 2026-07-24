const path = require("path");
const { globSync } = require("glob");

module.exports = function () {
  const pattern = path.join(__dirname, "../content/marina-pacific-heights/*.json");
  const files = globSync(pattern).sort().reverse();
  if (!files.length) return { issue: null };
  const issue = require(files[0]);
  return { issue };
};
