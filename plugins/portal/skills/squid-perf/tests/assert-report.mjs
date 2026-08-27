import fs from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("usage: assert-report.mjs <report.html>");

const lines = fs.readFileSync(reportPath, "utf8").split("\n");
let templateLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('type="__bundler/template"') && lines[i].trim().startsWith("<script")) {
    templateLine = i + 1;
    break;
  }
}
if (templateLine < 0) throw new Error("bundled template not found");

const innerHtml = JSON.parse(lines[templateLine]);
const openTag = '<script id="__REPORT_DATA__" type="application/json">';
const openAt = innerHtml.indexOf(openTag, innerHtml.indexOf("-->") + 3);
const closeAt = innerHtml.indexOf("</script>", openAt + openTag.length);
if (openAt < 0 || closeAt < 0) throw new Error("report data not found");

const data = JSON.parse(innerHtml.slice(openAt + openTag.length, closeAt));
const service = data.services.find(item => item.name === "api");
if (!service) throw new Error("api service missing");
if (service.tier2.baseline.warns !== 1 || service.tier2.baseline.errors !== 0) {
  throw new Error(`expected one warning and no errors, got ${JSON.stringify(service.tier2.baseline)}`);
}
