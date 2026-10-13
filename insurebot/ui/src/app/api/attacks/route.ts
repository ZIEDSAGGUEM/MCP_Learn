import { NextResponse } from "next/server";
import { handle, requireSession } from "@/lib/guard";
import { scenarios } from "@/lib/scenarios";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireSession();
  return NextResponse.json({
    scenarios: scenarios.map(({ run: _run, ...s }) => s),
  });
});
