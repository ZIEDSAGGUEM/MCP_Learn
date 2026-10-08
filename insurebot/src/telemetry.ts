// Step 09: OpenTelemetry tracing → Jaeger (http://localhost:16686).
// Loaded BEFORE the app with: node --import ./dist/telemetry.js dist/server.js
// so the http, express and pg libraries are instrumented when the app imports them.
import { register } from "node:module";
import { hostname } from "node:os";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url); // ESM support

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME ?? "insurebot",
      "service.instance.id": process.env.POD_NAME ?? hostname(),
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      // Headers and bodies are NOT recorded (no Authorization header, no medical data in traces)
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === "/healthz" }),
      new ExpressInstrumentation(),
      // SQL text is recorded with $1 placeholders; the VALUES are not (enhancedDatabaseReporting off)
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  sdk.start();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void sdk.shutdown());
}
