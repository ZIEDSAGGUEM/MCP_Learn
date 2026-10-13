import { readFile, rename, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { checkCsrf, handle, HttpError, requireSession } from "@/lib/guard";

export const dynamic = "force-dynamic";

async function pdp(path: string, init?: RequestInit) {
  const c = cfg();
  const res = await fetch(`${c.pdpUrl}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${c.pdpApiKey}` } });
  if (!res.ok) throw new HttpError(502, `PDP answered ${res.status}`);
  return res.json();
}

// GET: the policy file + what the PDP has loaded
export const GET = handle(async () => {
  await requireSession();
  const c = cfg();
  const [text, defaultText, status] = await Promise.all([
    readFile(c.policyFile, "utf8"),
    readFile(c.policyDefaultFile, "utf8").catch(() => ""),
    pdp("/policies/status"),
  ]);
  return NextResponse.json({ text, isDefault: text === defaultText, status });
});

// POST { action: "check" | "save" | "reset", text? }
// Only admins may change the rules. A draft is checked by the PDP before it is written,
// and the file is replaced atomically, so the PDP never reads half a file.
export const POST = handle(async (req) => {
  checkCsrf(req);
  const { session } = await requireSession();
  const c = cfg();
  const b = (await req.json()) as { action: string; text?: string };

  if (b.action === "check") {
    if (typeof b.text !== "string") throw new HttpError(400, "text is required");
    return NextResponse.json(await pdp("/policies/check", { method: "POST", body: b.text, headers: { "content-type": "text/plain" } }));
  }

  if (!session.claims.roles.includes("admin")) throw new HttpError(403, "Only admins can change the policies. Log in as Carol or Erin.");
  let text: string;
  if (b.action === "reset") text = await readFile(c.policyDefaultFile, "utf8");
  else if (b.action === "save" && typeof b.text === "string" && b.text.length <= 64_000) text = b.text;
  else throw new HttpError(400, "Unknown action");

  const checked = (await pdp("/policies/check", { method: "POST", body: text, headers: { "content-type": "text/plain" } })) as {
    ok: boolean;
    errors?: string[];
    policyIds?: string[];
  };
  if (!checked.ok) return NextResponse.json({ saved: false, ...checked }, { status: 422 });
  // Valid Cedar with no policies means "deny everything": safe, but it locks every user out. Refuse it here.
  if (!checked.policyIds?.length) {
    return NextResponse.json({ saved: false, ok: false, errors: ["This draft has no policies, so every request would be denied. Not saved."] }, { status: 422 });
  }
  const tmp = `${c.policyFile}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, c.policyFile);
  console.log(`policy ${b.action} by ${session.claims.username} (${session.claims.tenant})`);
  return NextResponse.json({ saved: true, ...checked });
});
