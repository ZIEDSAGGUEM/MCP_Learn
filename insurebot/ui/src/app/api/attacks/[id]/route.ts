import { NextResponse } from "next/server";
import { checkCsrf, handle, requireSession } from "@/lib/guard";
import { runScenario } from "@/lib/scenarios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  checkCsrf(req);
  await requireSession();
  const { id } = await ctx.params;
  return NextResponse.json(await runScenario(id));
});
