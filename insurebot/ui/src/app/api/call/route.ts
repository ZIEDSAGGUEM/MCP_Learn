import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { checkCsrf, handle, HttpError, requireSession } from "@/lib/guard";
import { CAN_ASK_USER, mcp } from "@/lib/mcp";

export const dynamic = "force-dynamic";

type Body = {
  tool: string;
  arguments: Record<string, unknown>;
  entrance?: "public" | "admin";
  requestState?: string;
  inputResponses?: Record<string, unknown>;
  canAskUser?: boolean;
};

// POST /api/call: call one tool as YOU. MRTR round 2 sends requestState + inputResponses back.
export const POST = handle(async (req) => {
  checkCsrf(req);
  const { token } = await requireSession();
  const b = (await req.json()) as Body;
  if (typeof b.tool !== "string" || !/^[a-z_]{1,64}$/.test(b.tool)) throw new HttpError(400, "Unknown tool name");
  if (typeof b.arguments !== "object" || b.arguments === null || Array.isArray(b.arguments)) throw new HttpError(400, "arguments must be an object");
  const c = cfg();
  const exchange = await mcp({
    url: b.entrance === "admin" ? c.entrances.admin : c.entrances.public,
    token,
    method: "tools/call",
    params: {
      name: b.tool,
      arguments: b.arguments,
      ...(b.requestState ? { requestState: b.requestState } : {}),
      ...(b.inputResponses ? { inputResponses: b.inputResponses } : {}),
    },
    capabilities: b.canAskUser === false ? {} : CAN_ASK_USER,
  });
  return NextResponse.json({ exchange });
});
