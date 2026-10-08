// Step 12: run every test, map them to the 20 InsureBot episodes, write security/ATTACK-REPORT.md.
// Usage (lab running): npm run attack-report
// Exit code 1 if any applicable episode has no passing test, or any test fails.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Episode = { id: number; title: string; owasp: string[]; step: string; defence: string; tests: string[]; notApplicable?: boolean };
type Assertion = { fullName: string; status: "passed" | "failed" | "skipped" | "pending" | "todo" };
type VitestJson = { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: { name: string; assertionResults: Assertion[] }[] };

const root = new URL("..", import.meta.url).pathname;
const episodes: Episode[] = JSON.parse(readFileSync(join(root, "security/episodes.json"), "utf8"));

// 1. Run the whole suite with the JSON reporter
const dir = mkdtempSync(join(tmpdir(), "attack-report-"));
const out = join(dir, "results.json");
console.log("running the full test suite against the lab…");
spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`], { cwd: root, stdio: "ignore" });
const results: VitestJson = JSON.parse(readFileSync(out, "utf8"));
rmSync(dir, { recursive: true, force: true });

const all = results.testResults.flatMap((f) =>
  f.assertionResults.map((a) => ({ ...a, file: f.name.replace(root, "") })),
);

// 2. Match tests to episodes
const rows = episodes.map((ep) => {
  const tests = all.filter((t) => ep.tests.some((needle) => t.fullName.includes(needle)));
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const status = ep.notApplicable ? "n/a" : tests.length === 0 ? "NO TEST" : failed > 0 ? "FAIL" : "blocked";
  return { ep, tests, passed, failed, status };
});
const mapped = new Set(rows.flatMap((r) => r.tests.map((t) => t.fullName)));

// 3. Write the report
const icon: Record<string, string> = { blocked: "✅ blocked", FAIL: "❌ FAIL", "NO TEST": "⚠️ NO TEST", "n/a": "➖ n/a" };
const applicable = rows.filter((r) => !r.ep.notApplicable);
const blocked = applicable.filter((r) => r.status === "blocked").length;
const date = new Date().toISOString().slice(0, 16).replace("T", " ");

let md = `# InsureBot attack report

Generated ${date} UTC by \`npm run attack-report\`, against the running lab.

**${blocked} of ${applicable.length} applicable attacks blocked** · ${results.numPassedTests} of ${results.numTotalTests} tests passed · ${results.numFailedTests} failed

Each row is an attack from the InsureBot story. "Blocked" means every test for it passed. The tests run the real attack
against the real stack (3 pods, gateway, Keycloak, Redis, Postgres, PDP, PayCo, Mailpit, Jaeger).

| # | Attack | OWASP / lesson | Blocked by (step) | Defence | Tests | Result |
|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  md += `| ${r.ep.id} | ${r.ep.title} | ${r.ep.owasp.join(", ")} | ${r.ep.step} | ${r.ep.defence} | ${r.ep.notApplicable ? "—" : `${r.passed}/${r.tests.length}`} | ${icon[r.status]} |\n`;
}

md += `\n## Tests per attack\n`;
for (const r of rows.filter((x) => x.tests.length)) {
  md += `\n### ${r.ep.id}. ${r.ep.title}\n\n`;
  for (const t of r.tests) md += `- ${t.status === "passed" ? "✅" : "❌"} \`${t.file}\` ${t.fullName}\n`;
}

const other = all.filter((t) => !mapped.has(t.fullName));
md += `\n## Other checks (${other.length})\n\nTests that support the defences without being tied to one attack (normal use, setup, discovery).\n\n`;
for (const t of other) md += `- ${t.status === "passed" ? "✅" : "❌"} \`${t.file}\` ${t.fullName}\n`;

md += `
## Mutation checks done during the build

A test that can't fail proves nothing. Each of these was broken on purpose, the tests failed, then the fix was restored:

| Broken on purpose | What the tests caught |
|---|---|
| Quote key without the owner (step 03) | 6 of 8 step 03 tests failed: Bob read Alice's quote |
| No \`Cache-Control\` header (step 05) | Even the correctly configured cache leaked the admin tool list to Bob |
| RLS disabled on \`customers\` (step 06) | Alice's search returned Globex customers |
| \`exec\` instead of \`execFile\` (step 08, demo) | The injected \`touch\` command ran |
| A fake cloud key committed (step 11, throwaway clone) | gitleaks: "leaks found: 2" |
| A rogue MCP server without auth (step 11) | Shadow scan: "UNAUTHENTICATED MCP" |
| PDP stopped (step 10, manual) | Every tool call denied (fail closed) |

## Not covered

- **Episode 12, confused deputy:** InsureBot is not an OAuth proxy to a third-party API, so it can't happen here. It would apply if InsureBot ever used one shared client ID to act on users' Google or GitHub accounts.
- **A real model in the loop:** prompt-injection tests play the "fooled model" by sending what it would send. Connecting Claude is the next step to see it live.
- **Production concerns:** TLS, real secret storage, backups, multi-region, and a real (non-dev) Keycloak.
`;

writeFileSync(join(root, "security/ATTACK-REPORT.md"), md);

for (const r of rows) console.log(`${String(r.ep.id).padStart(2)} ${icon[r.status].padEnd(11)} ${r.ep.title}`);
console.log(`\n${blocked}/${applicable.length} attacks blocked · ${results.numPassedTests}/${results.numTotalTests} tests passed → security/ATTACK-REPORT.md`);
if (applicable.some((r) => r.status !== "blocked") || results.numFailedTests > 0) process.exit(1);
