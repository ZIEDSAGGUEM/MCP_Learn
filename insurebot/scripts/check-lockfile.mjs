// Step 11, MCP04 / LLM03: every package in package-lock.json must come from the official npm registry
// over HTTPS and carry a sha512 integrity hash, so `npm ci` installs exactly what was reviewed.
// Usage: node scripts/check-lockfile.mjs   (exit code 1 on any problem)
import { readFileSync } from "node:fs";

const REGISTRY = "https://registry.npmjs.org/";

export function checkLockfile(path = new URL("../package-lock.json", import.meta.url)) {
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const problems = [];
  if (lock.lockfileVersion < 3) problems.push(`lockfileVersion ${lock.lockfileVersion} (expected 3)`);
  let count = 0;
  for (const [name, pkg] of Object.entries(lock.packages ?? {})) {
    if (name === "" || pkg.link) continue; // the project itself, local links
    count++;
    if (!pkg.resolved?.startsWith(REGISTRY)) problems.push(`${name}: resolved from ${pkg.resolved ?? "nowhere"}`);
    if (!pkg.integrity?.startsWith("sha512-")) problems.push(`${name}: no sha512 integrity hash`);
  }
  return { count, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count, problems } = checkLockfile();
  if (problems.length) {
    console.error(`${problems.length} lockfile problem(s):\n` + problems.join("\n"));
    process.exit(1);
  }
  console.log(`lockfile OK: ${count} packages, all from ${REGISTRY} with sha512 integrity`);
}
