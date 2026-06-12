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

// POST /api/preview-visit/track
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

// GET /api/preview-visit/by-blog?blog_id=106356054
export const getVisitsByBlog = (req: any, res: any) => {
  try {
    const { blog_id, start, end } = req.query;
    if (!blog_id) return res.status(400).json({ error: "blog_id required" });
    const startMs = start ? new Date(start).getTime() : undefined;
    const endMs = end ? new Date(end).getTime() : undefined;
    const data = PreviewVisitService.getVisitsByBlog(
      String(blog_id),
      startMs,
      endMs,
    );
    res.json({ blog_id, data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// GET /api/preview-visit/top-redirects?limit=10
export const getTopRedirectUrls = (req: any, res: any) => {
  try {
    const { limit, start, end } = req.query;
    const startMs = start ? new Date(start).getTime() : undefined;
    const endMs = end ? new Date(end).getTime() : undefined;
    const data = PreviewVisitService.getTopRedirectUrls(
      Number(limit) || 10,
      startMs,
      endMs,
    );
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// GET /api/preview-visit/platforms?blog_id=106356054
export const getPlatformBreakdown = (req: any, res: any) => {
  try {
    const { blog_id, start, end } = req.query;
    const startMs = start ? new Date(start).getTime() : undefined;
    const endMs = end ? new Date(end).getTime() : undefined;
    const data = PreviewVisitService.getPlatformBreakdown(
      blog_id ? String(blog_id) : undefined,
      startMs,
      endMs,
    );
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch" });
  }
};

// GET /api/preview-visit/visitor-ips?blog_id=106356054
export const getVisitorIps = (req: any, res: any) => {
  try {
    const { blog_id, start, end } = req.query;
    const startMs = start ? new Date(start).getTime() : undefined;
    const endMs = end ? new Date(end).getTime() : undefined;
    const data = PreviewVisitService.getVisitorIps(
      blog_id ? String(blog_id) : undefined,
      startMs,
      endMs,
    );
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch" });
  }
};
