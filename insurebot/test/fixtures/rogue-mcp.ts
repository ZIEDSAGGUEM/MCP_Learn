// Episode 20 test fixture: the "demo copy someone forgot to protect". An MCP server with NO auth.
// Started only by test/step11.test.ts, on 127.0.0.1:3999, and stopped right after.
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "insurebot-demo-copy", version: "0.0.1" });
  server.registerTool("list_all_customers", { description: "Demo", inputSchema: z.object({}) }, async () => ({
    content: [{ type: "text", text: "everyone's data" }],
  }));
  return server;
});
const app = createMcpExpressApp();
const node = toNodeHandler(handler);
app.all("/mcp", (req, res) => void node(req, res, req.body)); // no requireBearerAuth: that's the bug
app.listen(Number(process.env.PORT ?? 3999), "127.0.0.1", () => console.log("rogue MCP listening"));
