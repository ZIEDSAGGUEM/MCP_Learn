import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { handle, requireSession } from "@/lib/guard";
import { mcp, resultOf } from "@/lib/mcp";

export const dynamic = "force-dynamic";

// The tools YOUR token can see. Admin tools only exist on the admin entrance (the public one blocks them).
export const GET = handle(async () => {
  const { session, token } = await requireSession();
  const x = await mcp({ url: cfg().entrances.public, token, method: "tools/list" });
  const tools = (resultOf(x)?.tools ?? []) as { name: string }[];
  const adminOnly = ["agency_stats", "export_report", "get_report"];
  return NextResponse.json({
    tools: tools.map((t) => ({ ...t, entrance: adminOnly.includes(t.name) ? "admin" : "public" })),
    exchange: x,
    isAdmin: session.claims.roles.includes("admin"),
  });
});
