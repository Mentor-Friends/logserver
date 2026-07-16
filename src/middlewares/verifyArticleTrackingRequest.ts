import { createHmac, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function stableJsonStringify(value: any): string {
  return JSON.stringify(value, function (_key, val) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((sorted: any, key) => {
          sorted[key] = val[key];
          return sorted;
        }, {});
    }
    return val;
  });
}

/**
 * Only the redirect service may create article analytics events. The browser
 * never calls Logserver directly, so signing this hop prevents forged tenant,
 * visitor, IP, and destination data from entering analytics.
 */
const verifyArticleTrackingRequest = (req: any, res: any, next: any) => {
  const secret = process.env.ARTICLE_TRACKING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    console.error(
      "ARTICLE_TRACKING_SECRET (or JWT_SECRET fallback) is not configured",
    );
    return res
      .status(503)
      .json({ error: "Article tracking is not configured" });
  }

  const timestamp = String(req.header("x-article-tracking-timestamp") || "");
  const signature = String(req.header("x-article-tracking-signature") || "");
  const timestampMs = Number(timestamp);

  if (
    !timestamp ||
    !signature ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    return res.status(401).json({ error: "Invalid tracking signature" });
  }

  // Use a canonical JSON representation to verify the request body.
  // This makes the signature independent of header order and JSON formatting.
  const rawBody = (req as any).rawBody;
  const rawText =
    typeof rawBody === "string"
      ? rawBody
      : rawBody instanceof Buffer
        ? rawBody.toString("utf8")
        : undefined;
  const parsedBody = rawText
    ? (() => {
        try {
          return JSON.parse(rawText);
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const bodyText =
    parsedBody !== undefined
      ? stableJsonStringify(parsedBody)
      : stableJsonStringify(req.body || {});
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${bodyText}`)
    .digest("hex");

  if (!safeEqual(signature, expected)) {
    // --- TEMPORARY DEBUG LOGGING ---
    // This will show us exactly what the server is using to build its signature.
    console.log("--- SIGNATURE VERIFICATION FAILED ---");
    console.log("Timestamp Received:", timestamp);
    console.log("Signature Received:", signature);
    console.log("Server Expected Signature:", expected);
    console.log("--- Raw Body Used by Server ---");
    console.log(bodyText);
    console.log("--- END DEBUG ---");

    try {
      const logdir = process.env.LOGPATH || path.join(process.cwd(), "logs");
      const logfile = path.join(logdir, "signature_debug.log");
      const entry =
        [
          new Date().toISOString(),
          "Timestamp Received: " + timestamp,
          "Signature Received: " + signature,
          "Server Expected Signature: " + expected,
          "BodyText: " + bodyText,
          "----",
        ].join("\n") + "\n";
      fs.mkdirSync(logdir, { recursive: true });
      fs.appendFileSync(logfile, entry, { encoding: "utf8" });
    } catch (err) {
      // ignore logging errors
    }
    // --- END TEMPORARY DEBUG LOGGING ---

    return res.status(401).json({ error: "Invalid tracking signature" });
  }

  next();
};

export default verifyArticleTrackingRequest;
