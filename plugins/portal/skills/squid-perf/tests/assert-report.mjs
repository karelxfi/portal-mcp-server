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
if (!innerHtml.includes('id="global-failures"')) {
  throw new Error("global deployment failure mount is missing");
}
if (!innerHtml.includes("const globalFailures = data.deploymentFailures || [];")) {
  throw new Error("HTML client does not render deployment failures");
}
const openTag = '<script id="__REPORT_DATA__" type="application/json">';
const openAt = innerHtml.indexOf(openTag, innerHtml.indexOf("-->") + 3);
const closeAt = innerHtml.indexOf("</script>", openAt + openTag.length);
if (openAt < 0 || closeAt < 0) throw new Error("report data not found");

const data = JSON.parse(innerHtml.slice(openAt + openTag.length, closeAt));
const service = data.services.find(item => item.name === "api");
if (!service) throw new Error("api service missing");
if (service.tier2.baseline.warns !== 1002 || service.tier2.baseline.errors !== 1) {
  throw new Error(`expected uncapped warning and error totals, got ${JSON.stringify(service.tier2.baseline)}`);
}
if (data.deploymentFailures.length !== 2) {
  throw new Error(`expected two deployment failures, got ${JSON.stringify(data.deploymentFailures)}`);
}
if (!data.fetchFailures.includes("experimental")) {
  throw new Error(`expected experimental fetch failure, got ${JSON.stringify(data.fetchFailures)}`);
}
const warningKinds = new Set(data.warnings.map(warning => warning.kind));
if (!warningKinds.has("fetch-failed") || !warningKinds.has("parse-failed")) {
  throw new Error(`expected fetch and parse warnings, got ${JSON.stringify(data.warnings)}`);
}
