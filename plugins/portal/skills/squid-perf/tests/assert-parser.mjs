import fs from "node:fs";

const [levelsPath, restartPath] = process.argv.slice(2);
if (!levelsPath || !restartPath) throw new Error("usage: assert-parser.mjs <levels.json> <restart.json>");

const levels = JSON.parse(fs.readFileSync(levelsPath, "utf8"));
const levelService = levels.services.api;
if (levels.meta.parsedLines !== 4) throw new Error(`expected 4 current CLI levels, got ${levels.meta.parsedLines}`);
if (levelService.errorCount !== 2) throw new Error(`expected WARNING and CRITICAL, got ${levelService.errorCount}`);
if (levelService.errors.map(e => e.level).join(",") !== "WARNING,CRITICAL") {
  throw new Error(`unexpected error levels: ${levelService.errors.map(e => e.level).join(",")}`);
}

const restart = JSON.parse(fs.readFileSync(restartPath, "utf8")).services.api;
if (restart.firstBlock !== 5000) throw new Error(`expected chronological first block 5000, got ${restart.firstBlock}`);
if (restart.restarts.length !== 1) throw new Error(`expected one restart, got ${restart.restarts.length}`);
