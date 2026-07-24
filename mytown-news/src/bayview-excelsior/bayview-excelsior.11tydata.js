const path = require("path");
const { globSync } = require("glob");

module.exports = function () {
  const pattern = path.join(__dirname, "../content/bayview-excelsior/*.json");
  const files = globSync(pattern).sort().reverse();
  if (!files.length) return { issue: null };
  return { issue: require(files[0]) };
};
