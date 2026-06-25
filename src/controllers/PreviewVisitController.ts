import { GetRelationRaw } from "mftsccs-node";
import { PreviewVisitService } from "../services/analytics/preview-visit.service";
import * as jwt from "jsonwebtoken";

function parseReferrerHost(referrer?: string): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).hostname.replace("www.", "");
  } catch {
    return undefined;
  }
}

function getIp(req: any): string {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.ip ||
    "unknown"
  );
}

function firstDefined(...values: any[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function parseMaybeJsonObject(value: any): any {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeTrackingInput(req: any) {
  const rawBody = parseMaybeJsonObject(req.body);
  const body =
    typeof rawBody === "string"
      ? { preview_url: rawBody }
      : rawBody || {};
  const query = req.query || {};

  const previewUrlValue = firstDefined(
    body.preview_url,
    body.previewUrl,
    query.preview_url,
    query.previewUrl,
  );

  let parsedPreviewUrl: URL | null = null;
  if (previewUrlValue) {
    try {
      parsedPreviewUrl = new URL(String(previewUrlValue));
    } catch {
      parsedPreviewUrl = null;
    }
  }

  const blogId = firstDefined(
    body.blog_id,
    body.blogId,
    query.blog_id,
    query.blogId,
    parsedPreviewUrl?.searchParams.get("blog_id"),
  );

  const redirectUrl = firstDefined(
    body.redirect_url,
    body.redirectUrl,
    query.redirect_url,
    query.redirectUrl,
    parsedPreviewUrl?.searchParams.get("redirect_url"),
  );

  const host = req.get?.("host") || req.headers?.host;
  const protocol = req.protocol || "https";
  const trackingBaseUrl =
    process.env.LOGSERVER_BASE_URL ||
    (host ? `${protocol}://${host}` : "https://logger.freeschema.com");
  const previewUrl =
    firstDefined(
      body.preview_url,
      body.previewUrl,
      query.preview_url,
      query.previewUrl,
    ) ||
    (blogId && redirectUrl
      ? `${trackingBaseUrl}/api/preview-visit/track?blog_id=${encodeURIComponent(
          String(blogId),
        )}&redirect_url=${encodeURIComponent(String(redirectUrl))}`
      : undefined) ||
    req.originalUrl ||
    req.url;

  return {
    body,
    previewUrl,
    blogId: blogId ? String(blogId) : undefined,
    redirectUrl: redirectUrl ? String(redirectUrl) : undefined,
    sessionId: firstDefined(body.session_id, body.sessionId, query.session_id, query.sessionId),
    entityId: firstDefined(body.entity_id, body.entityId, query.entity_id, query.entityId),
  };
}

async function resolveEntityIdFromBlog(
  blogId: string,
  timeoutMs = 1200,
): Promise<string | undefined> {
  const lookup = GetRelationRaw(Number(blogId), "the_entity_s_blog", 10, 1, true)
    .then((relationResult: any) => {
      if (
        Array.isArray(relationResult) &&
        relationResult.length > 0 &&
        relationResult[0]?.id
      ) {
        return String(relationResult[0].id);
      }
      return undefined;
    })
    .catch((relationErr) => {
      console.warn("Error resolving entity for blog_id", blogId, relationErr);
      return undefined;
    });

  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), timeoutMs),
  );

  return Promise.race([lookup, timeout]);
}

function parseQueryDate(
  value: any,
  bound: "start" | "end",
): number | undefined {
  if (!value) return undefined;

  const raw = String(value).trim();
  if (!raw) return undefined;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return Number.isNaN(numeric) ? undefined : numeric;
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const normalized = dateOnly
    ? `${raw}T${bound === "start" ? "00:00:00.000" : "23:59:59.999"}`
    : raw;
  const parsed = new Date(normalized).getTime();

  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseTimeRange(query: any): { start?: number; end?: number } {
  return {
    start: parseQueryDate(query.start, "start"),
    end: parseQueryDate(query.end, "end"),
  };
}

function getAuthenticatedEntityId(req: any): string | undefined {
  const requestUserId = req.user?.entityId;
  if (requestUserId !== undefined && requestUserId !== null) {
    return String(requestUserId);
  }

  const authToken = req.header("authorization");
  const token = authToken?.trim()?.split(" ")?.pop();
  if (!token) return undefined;

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET) as any;
    const userId = Number(decodedToken?.unique_name);
    return Number.isFinite(userId) ? String(userId) : undefined;
  } catch {
    return undefined;
  }
}

function requireAuthenticatedEntityId(req: any, res: any): string | null {
  const entityId = getAuthenticatedEntityId(req);
  if (!entityId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return entityId;
}

// ─── POST /api/preview-visit/track ──────────────────────────────────────────

export const trackPreviewVisit = async (req: any, res: any) => {
  try {
    const { previewUrl, blogId, redirectUrl, sessionId, entityId } =
      normalizeTrackingInput(req);

    if (!blogId || !redirectUrl) {
      return res.status(400).json({
        error:
          "blog_id and redirect_url are required either directly or inside preview_url",
      });
    }

    // Resolve which entity owns this blog via the relation graph.
    // This is the only reliable way to get entity_id on unauthenticated
    // browser-originated redirect hits (no JWT present).
    const entityIdFromBlog = await resolveEntityIdFromBlog(blogId);

    const referrer = firstDefined(
      req.body?.referrer,
      req.body?.referrerUrl,
      req.query?.referrer,
      req.query?.referrerUrl,
      req.headers["referer"],
      req.headers["referrer"],
    );
    const referrer_host = parseReferrerHost(referrer);
    const ip_address = getIp(req);

    const resolvedEntityId =
      getAuthenticatedEntityId(req) ||
      entityIdFromBlog ||
      (entityId ? String(entityId) : undefined);

    PreviewVisitService.recordVisit({
      blog_id: blogId,
      entity_id: resolvedEntityId,
      redirect_url: redirectUrl,
      preview_url: String(previewUrl),
      referrer,
      referrer_host,
      ip_address,
      session_id: sessionId ? Number(sessionId) : undefined,
    });

    res.status(200).json({ message: "Visit recorded" });
  } catch (err) {
    console.error("Error recording preview visit:", err);
    res.status(500).json({ error: "Failed to record visit" });
  }
};
// ─── GET /api/preview-visit/by-blog?blog_id=106356054 ───────────────────────
// Now returns full analytics for the given blog (redirect_urls, referrals,
// visitor IPs, summary) instead of just a flat list.

export const getVisitsByBlog = (req: any, res: any) => {
  try {
    const { blog_id } = req.query;
    if (!blog_id) return res.status(400).json({ error: "blog_id required" });

    const { start, end } = parseTimeRange(req.query);
    const entity_id = requireAuthenticatedEntityId(req, res);
    if (!entity_id) return;
    const data = PreviewVisitService.getBlogAnalytics(
      String(blog_id),
      start,
      end,
      entity_id,
    );
    res.json(data);
  } catch (err) {
    console.error("Error in getVisitsByBlog:", err);
    res.status(500).json({ error: "Failed to fetch blog analytics" });
  }
};

// ─── GET /api/preview-visit/top-redirects?limit=10 ──────────────────────────

export const getTopRedirectUrls = (req: any, res: any) => {
  try {
    const { limit } = req.query;
    const { start, end } = parseTimeRange(req.query);
    const entity_id = requireAuthenticatedEntityId(req, res);
    if (!entity_id) return;
    const data = PreviewVisitService.getTopRedirectUrls(
      Number(limit) || 10,
      start,
      end,
      entity_id,
    );
    res.json({ data });
  } catch (err) {
    console.error("Error in getTopRedirectUrls:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// ─── GET /api/preview-visit/platforms?blog_id=106356054 ─────────────────────

export const getPlatformBreakdown = (req: any, res: any) => {
  try {
    const { blog_id } = req.query;
    const { start, end } = parseTimeRange(req.query);
    const entity_id = requireAuthenticatedEntityId(req, res);
    if (!entity_id) return;
    const data = PreviewVisitService.getPlatformBreakdown(
      blog_id ? String(blog_id) : undefined,
      start,
      end,
      entity_id,
    );
    res.json({ data });
  } catch (err) {
    console.error("Error in getPlatformBreakdown:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// ─── GET /api/preview-visit/visitor-ips?blog_id=106356054 ───────────────────

export const getVisitorIps = (req: any, res: any) => {
  try {
    const { blog_id } = req.query;
    const { start, end } = parseTimeRange(req.query);
    const entity_id = requireAuthenticatedEntityId(req, res);
    if (!entity_id) return;
    const data = PreviewVisitService.getVisitorIps(
      blog_id ? String(blog_id) : undefined,
      start,
      end,
      entity_id,
    );
    res.json({ data });
  } catch (err) {
    console.error("Error in getVisitorIps:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// ─── GET /api/preview-visit/articles ────────────────────────────────────────
// NEW: comprehensive analytics across ALL articles / blogs.
//
// Query params (all optional):
//   start  – ISO date string or ms timestamp
//   end    – ISO date string or ms timestamp

export const getAllArticlesAnalytics = (req: any, res: any) => {
  try {
    const { start, end } = parseTimeRange(req.query);
    const entity_id = requireAuthenticatedEntityId(req, res);
    // const entity_id = "104456291";
    if (!entity_id) return;
    const data = PreviewVisitService.getAllArticlesAnalytics(
      start,
      end,
      entity_id,
    );
    res.json(data);
  } catch (err) {
    console.error("Error in getAllArticlesAnalytics:", err);
    res.status(500).json({ error: "Failed to fetch articles analytics" });
  }
};
