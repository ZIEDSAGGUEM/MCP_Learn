// Step 11, MCP03 (tool poisoning): a reviewed fingerprint of every tool InsureBot exposes.
// A tool's description and schemas are what the AI reads and trusts. If any of them changes
// (a bad merge, a compromised dependency, a "helpful" edit hiding an instruction), the
// step 11 test fails until a human reviews the change and regenerates this file:
//   npx tsx scripts/tool-manifest.ts      (needs the lab running and .env.test)
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export const MANIFEST_PATH = new URL("../security/tool-manifest.json", import.meta.url);

type Tool = { name: string; title?: string; description?: string; inputSchema?: unknown; outputSchema?: unknown; annotations?: unknown };

/** JSON with keys sorted at every level, so the hash doesn't depend on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(tools: Tool[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    const what = { title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations };
    out[t.name] = "sha256:" + createHash("sha256").update(canonical(what)).digest("hex");
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rawRequest, tokenFor } = await import("../test/helpers.js");
  // An admin sees every tool, including the admin-only ones
  const token = await tokenFor("carol", "quotes:read reports:admin");
  const res = await rawRequest(token, "tools/list", {}, undefined, {}, "http://localhost:3002/mcp");
  const manifest = fingerprint(res.body.result.tools);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${Object.keys(manifest).length} tool fingerprints to security/tool-manifest.json`);
}
