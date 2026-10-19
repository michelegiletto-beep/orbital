import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
export function startTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;
  if (process.env.OTEL_EGRESS_APPROVED !== "true")
    throw new Error("Telemetry egress requires explicit perimeter approval");
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid telemetry endpoint");
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: new URL(
        "v1/traces",
        endpoint.endsWith("/") ? endpoint : endpoint + "/",
      ).href,
    }),
  });
  sdk.start();
  return sdk;
}
