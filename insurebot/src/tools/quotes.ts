import { requireScopes, type McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { principal } from "../auth.js";
import { config } from "../config.js";
import { priceFor } from "../pricing.js";
import { loadQuote, QUOTE_ID_PATTERN, saveQuote } from "../quotes.js";

export function registerQuoteTools(server: McpServer) {
  server.registerTool(
    "start_quote",
    {
      title: "Start a quote",
      description: "Create a monthly health insurance quote for a customer.",
      // Tight limits: the model is an untrusted caller (Lesson 4)
      inputSchema: z.object({
        age: z.number().int().min(18).max(99),
        smoker: z.boolean(),
        conditions: z.array(z.string().min(1).max(40)).max(10).default([]),
      }),
      outputSchema: z.object({
        quoteId: z.string(),
        priceEur: z.number(),
        expiresInSeconds: z.number(),
        servedBy: z.string(),
      }),
      // A token without quotes:write gets 403 insufficient_scope and is told
      // which scope to request: least privilege + step-up (Lesson 3, Episode 11)
      scopeChallenge: requireScopes("quotes:write"),
    },
    async ({ age, smoker, conditions }, ctx) => {
      const who = principal(ctx.http?.authInfo);
      const priceEur = priceFor(age, smoker, conditions);
      const quoteId = await saveQuote(who, {
        age,
        smoker,
        conditions,
        priceEur,
        createdAt: new Date().toISOString(),
        createdBy: config.podName,
      });
      const output = { quoteId, priceEur, expiresInSeconds: config.quoteTtlSeconds, servedBy: config.podName };
      return {
        content: [{ type: "text", text: `Quote ${quoteId}: €${priceEur}/month (valid ${config.quoteTtlSeconds / 60} min)` }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get a quote",
      description: "Show a quote created earlier with start_quote.",
      inputSchema: z.object({
        quote_id: z.string().regex(QUOTE_ID_PATTERN, "Not a valid quote ID"),
      }),
      outputSchema: z.object({
        quoteId: z.string(),
        priceEur: z.number(),
        conditionsDeclared: z.number(),
        createdBy: z.string(),
        servedBy: z.string(),
      }),
      scopeChallenge: requireScopes("quotes:read"),
    },
    async ({ quote_id }, ctx) => {
      const who = principal(ctx.http?.authInfo);
      // Looks up the quote under the CALLER's tenant and user (Episode 2).
      // Same answer whether the quote doesn't exist or belongs to someone else,
      // so Bob can't even learn that Alice's quote ID is real.
      const quote = await loadQuote(who, quote_id);
      if (!quote) {
        return { content: [{ type: "text", text: "Quote not found" }], isError: true };
      }
      // Return the count, not the diagnoses: minimal data (LLM02)
      const output = {
        quoteId: quote_id,
        priceEur: quote.priceEur,
        conditionsDeclared: quote.conditions.length,
        createdBy: quote.createdBy,
        servedBy: config.podName,
      };
      return {
        content: [
          {
            type: "text",
            text: `€${quote.priceEur}/month, ${output.conditionsDeclared} condition(s) declared. Created on ${quote.createdBy}, served by ${config.podName}.`,
          },
        ],
        structuredContent: output,
      };
    },
  );
}
