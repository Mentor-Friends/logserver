import { PreviewVisitService } from "../services/analytics/preview-visit.service";

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

// ─── POST /api/preview-visit/track ──────────────────────────────────────────

export const trackPreviewVisit = (req: any, res: any) => {
  try {
    const { preview_url, session_id } = req.body;

    if (!preview_url) {
      return res.status(400).json({ error: "preview_url is required" });
    }

    const parsed = new URL(preview_url);
    const blog_id = parsed.searchParams.get("blog_id");
    const redirect_url = parsed.searchParams.get("redirect_url");

    if (!blog_id || !redirect_url) {
      return res
        .status(400)
        .json({ error: "blog_id and redirect_url must be in preview_url" });
    }

    const referrer = req.body.referrer || req.headers["referer"];
    const referrer_host = parseReferrerHost(referrer);
    const ip_address = getIp(req);

    PreviewVisitService.recordVisit({
      blog_id,
      redirect_url,
      preview_url,
      referrer,
      referrer_host,
      ip_address,
      session_id: session_id ? Number(session_id) : undefined,
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
    const data = PreviewVisitService.getBlogAnalytics(
      String(blog_id),
      start,
      end,
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
    const data = PreviewVisitService.getTopRedirectUrls(
      Number(limit) || 10,
      start,
      end,
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
    const data = PreviewVisitService.getPlatformBreakdown(
      blog_id ? String(blog_id) : undefined,
      start,
      end,
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
    const data = PreviewVisitService.getVisitorIps(
      blog_id ? String(blog_id) : undefined,
      start,
      end,
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
    const data = PreviewVisitService.getAllArticlesAnalytics(start, end);
    res.json(data);
  } catch (err) {
    console.error("Error in getAllArticlesAnalytics:", err);
    res.status(500).json({ error: "Failed to fetch articles analytics" });
  }
};
