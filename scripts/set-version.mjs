// Set one lockstep version across every workspace package, and rewrite internal
// @whats-my-model/* dependency ranges to match (so e.g. widget keeps requiring a
// core version that actually exists after a bump). Text edits, not parse+restringify,
// so each package.json keeps its existing formatting and the diff stays minimal.
//
// Usage: node scripts/set-version.mjs 0.2.0
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  console.error(`Usage: node scripts/set-version.mjs <semver>  (got: ${JSON.stringify(version)})`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const pkgsDir = join(here, "..", "packages");

let updated = 0;
for (const name of readdirSync(pkgsDir)) {
  const file = join(pkgsDir, name, "package.json");
  if (!existsSync(file)) continue;

  const before = readFileSync(file, "utf8");
  const after = before
    // top-level "version" (first occurrence — it's near the top and these files
    // have no nested "version" keys)
    .replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
    // internal workspace deps -> ^<version>, in any dependency block
    .replace(/("@whats-my-model\/[^"]+":\s*")[^"]+(")/g, `$1^${version}$2`);

  if (after !== before) {
    writeFileSync(file, after);
    updated++;
    console.log(`${name}: version -> ${version}`);
  } else {
    console.log(`${name}: unchanged`);
  }
}
console.log(`Updated ${updated} package.json file(s) to ${version}.`);
