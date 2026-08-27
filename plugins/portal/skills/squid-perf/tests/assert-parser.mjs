import fs from "node:fs";

const [levelsPath, restartPath, smallRestartPath, sameTimestampRestartPath, reverseSameTimestampRestartPath] = process.argv.slice(2);
if (!levelsPath || !restartPath || !smallRestartPath || !sameTimestampRestartPath || !reverseSameTimestampRestartPath) {
  throw new Error(
    "usage: assert-parser.mjs <levels.json> <restart.json> <small-restart.json> <same-timestamp-restart.json> <reverse-same-timestamp-restart.json>",
  );
}

const levels = JSON.parse(fs.readFileSync(levelsPath, "utf8"));
const levelService = levels.services.api;
if (levels.meta.parsedLines !== 4) throw new Error(`expected 4 current CLI levels, got ${levels.meta.parsedLines}`);
if (levelService.errorCount !== 2) throw new Error(`expected WARNING and CRITICAL, got ${levelService.errorCount}`);
if (levelService.errors.map(e => e.level).join(",") !== "WARNING,CRITICAL") {
  throw new Error(`unexpected error levels: ${levelService.errors.map(e => e.level).join(",")}`);
}

const restart = JSON.parse(fs.readFileSync(restartPath, "utf8")).services.api;
if (restart.firstBlock !== 5000) throw new Error(`expected chronological first block 5000, got ${restart.firstBlock}`);
if (restart.lastBlock !== 4500) throw new Error(`expected chronological last block 4500, got ${restart.lastBlock}`);
if (restart.restarts.length !== 1) throw new Error(`expected one restart, got ${restart.restarts.length}`);

const smallRestart = JSON.parse(fs.readFileSync(smallRestartPath, "utf8")).services.api;
if (smallRestart.lastBlock !== 4950) {
  throw new Error(`expected chronological last block 4950, got ${smallRestart.lastBlock}`);
}
if (smallRestart.restarts.length !== 1) {
  throw new Error(`expected a 50-block rollback to count as one restart, got ${smallRestart.restarts.length}`);
}

const sameTimestampRestart = JSON.parse(fs.readFileSync(sameTimestampRestartPath, "utf8")).services.api;
if (sameTimestampRestart.restarts.length !== 1 || sameTimestampRestart.restarts[0].rowIndex !== 2) {
  throw new Error(`expected same-timestamp restart at row 2, got ${JSON.stringify(sameTimestampRestart.restarts)}`);
}
if (sameTimestampRestart.lastBlock !== 4500) {
  throw new Error(`expected same-timestamp chronological last block 4500, got ${sameTimestampRestart.lastBlock}`);
}

const reverseSameTimestampRestart = JSON.parse(fs.readFileSync(reverseSameTimestampRestartPath, "utf8")).services.api;
if (reverseSameTimestampRestart.restarts.length !== 1 || reverseSameTimestampRestart.restarts[0].rowIndex !== 2) {
  throw new Error(`expected reverse same-timestamp restart at row 2, got ${JSON.stringify(reverseSameTimestampRestart.restarts)}`);
}
if (reverseSameTimestampRestart.progressRows.map(row => row[1]).join(",") !== "5000,8000,4000,4500") {
  throw new Error(`unexpected reverse same-timestamp order: ${JSON.stringify(reverseSameTimestampRestart.progressRows)}`);
}
const reverseRows = reverseSameTimestampRestart.progressRows;
const reverseMulticall = reverseSameTimestampRestart.multicall[0];
if (!(reverseRows[1][7] < reverseMulticall.sequence && reverseMulticall.sequence < reverseRows[2][7])) {
  throw new Error(`reverse same-timestamp sequence was not normalized: ${JSON.stringify(reverseSameTimestampRestart)}`);
}
