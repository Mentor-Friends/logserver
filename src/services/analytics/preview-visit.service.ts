import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export class PreviewVisitService {
  private static db: any = null;

  private static dailyVisitExpr = `strftime('%Y-%m-%d', visited_at / 1000, 'unixepoch', 'localtime')`;
  private static geoCache = new Map<
    string,
    { country?: string; city?: string }
  >();
  private static reverseGeoCache = new Map<
    string,
    { country?: string; city?: string }
  >();

  private static getDb() {
    if (this.db) return this.db;

    const dbPath = process.env.ANALYTICS_DB_PATH
      ? path.resolve(process.env.ANALYTICS_DB_PATH)
      : path.join(process.env.LOGPATH || "", "analytics", "page-summary.db");

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.ensureSchema();
    return this.db;
  }

  private static ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preview_visits (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        blog_id       TEXT NOT NULL,
        redirect_url  TEXT NOT NULL,
        preview_url   TEXT NOT NULL,
        referrer      TEXT,
        referrer_host TEXT,
        ip_address    TEXT,
        country       TEXT,
        city          TEXT,
        latitude      REAL,
        longitude     REAL,
        accuracy      REAL,
        location_source TEXT,
        session_id    INTEGER,
        visited_at    INTEGER NOT NULL,
        entity_id     TEXT
      );
    `);

    // Keep older databases compatible after the entity_id filter was added.
    const columns = this.db.prepare(`PRAGMA table_info(preview_visits)`).all();
    const hasEntityId = columns.some(
      (column: any) => column?.name === "entity_id",
    );
    if (!hasEntityId) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN entity_id TEXT;
      `);
    }

    const hasCountry = columns.some(
      (column: any) => column?.name === "country",
    );
    if (!hasCountry) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN country TEXT;
      `);
    }

    const hasCity = columns.some((column: any) => column?.name === "city");
    if (!hasCity) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN city TEXT;
      `);
    }

    const hasLatitude = columns.some(
      (column: any) => column?.name === "latitude",
    );
    if (!hasLatitude) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN latitude REAL;
      `);
    }

    const hasLongitude = columns.some(
      (column: any) => column?.name === "longitude",
    );
    if (!hasLongitude) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN longitude REAL;
      `);
    }

    const hasAccuracy = columns.some((column: any) => column?.name === "accuracy");
    if (!hasAccuracy) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN accuracy REAL;
      `);
    }

    const hasLocationSource = columns.some(
      (column: any) => column?.name === "location_source",
    );
    if (!hasLocationSource) {
      this.db.exec(`
        ALTER TABLE preview_visits ADD COLUMN location_source TEXT;
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pv_blog_id ON preview_visits(blog_id);
      CREATE INDEX IF NOT EXISTS idx_pv_entity_id ON preview_visits(entity_id);
      CREATE INDEX IF NOT EXISTS idx_pv_redirect_url ON preview_visits(redirect_url);
      CREATE INDEX IF NOT EXISTS idx_pv_referrer_host ON preview_visits(referrer_host);
      CREATE INDEX IF NOT EXISTS idx_pv_country ON preview_visits(country);
      CREATE INDEX IF NOT EXISTS idx_pv_city ON preview_visits(city);
      CREATE INDEX IF NOT EXISTS idx_pv_visited_at ON preview_visits(visited_at);
    `);
  }
  private static timeFilter(
    params: any[],
    start?: number,
    end?: number,
  ): string {
    let sql = "";
    if (start) {
      sql += " AND visited_at >= ?";
      params.push(start);
    }
    if (end) {
      sql += " AND visited_at <= ?";
      params.push(end);
    }
    return sql;
  }

  private static getDailyVisits(
    params: any[],
    whereExtra: string,
  ): { date: string; visits: number; unique_visitors: number }[] {
    const db = this.getDb();
    return db
      .prepare(
        `
      SELECT ${this.dailyVisitExpr} AS date,
             COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors
      FROM preview_visits
      WHERE 1=1${whereExtra}
      GROUP BY ${this.dailyVisitExpr}
      ORDER BY date
    `,
      )
      .all(params);
  }

  public static async resolveLocation(ipAddress?: string): Promise<{
    country?: string;
    city?: string;
  }> {
    const ip = String(ipAddress || "").trim();
    if (!ip || ip === "unknown") return {};

    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("10.") ||
      ip.startsWith("192.168.") ||
      ip.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      ip.startsWith("fc") ||
      ip.startsWith("fd")
    ) {
      return {};
    }

    const cached = this.geoCache.get(ip);
    if (cached) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);

    try {
      const res = await fetch(
        `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        { signal: controller.signal },
      );
      if (!res.ok) return {};

      const data: any = await res.json().catch(() => ({}));
      const location = {
        country:
          String(data?.country_name || data?.country || "").trim() || undefined,
        city: String(data?.city || "").trim() || undefined,
      };
      this.geoCache.set(ip, location);
      return location;
    } catch {
      return {};
    } finally {
      clearTimeout(timeout);
    }
  }

  public static async resolveLocationFromCoordinates(
    latitude?: number,
    longitude?: number,
  ): Promise<{ country?: string; city?: string }> {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};

    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const cached = this.reverseGeoCache.get(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("zoom", "10");

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent":
            process.env.NOMINATIM_USER_AGENT ||
            "logserver/1.0 (article analytics)",
          "Accept-Language": "en",
          Accept: "application/json",
        },
      });

      if (!res.ok) return {};

      const data: any = await res.json().catch(() => ({}));
      const address = data?.address || {};
      const city =
        String(
          address.city ||
            address.town ||
            address.village ||
            address.hamlet ||
            address.suburb ||
            address.county ||
            "",
        ).trim() || undefined;
      const country = String(address.country || "").trim() || undefined;
      const location = { country, city };
      this.reverseGeoCache.set(cacheKey, location);
      return location;
    } catch {
      return {};
    } finally {
      clearTimeout(timeout);
    }
  }

  private static getLocationBreakdown(
    params: any[],
    whereExtra: string,
  ): {
    country: string;
    city: string;
    visits: number;
    unique_visitors: number;
  }[] {
    const db = this.getDb();
    return db
      .prepare(
        `
      SELECT
        COALESCE(country, 'Unknown') AS country,
        COALESCE(city, 'Unknown') AS city,
        COUNT(*) AS visits,
        COUNT(DISTINCT ip_address) AS unique_visitors
      FROM preview_visits
      WHERE 1=1${whereExtra}
      GROUP BY country, city
      ORDER BY visits DESC
    `,
      )
      .all(params);
  }

  // ─── record ─────────────────────────────────────────────────────────────────

  public static recordVisit(data: {
    blog_id: string;
    entity_id?: string;
    redirect_url: string;
    preview_url: string;
    referrer?: string;
    referrer_host?: string;
    ip_address?: string;
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    location_source?: string;
    session_id?: number;
  }) {
    const db = this.getDb();
    db.prepare(
      `
    INSERT INTO preview_visits
      (blog_id, entity_id, redirect_url, preview_url, referrer, referrer_host, ip_address, country, city, latitude, longitude, accuracy, location_source, session_id, visited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    ).run(
      data.blog_id,
      data.entity_id || null,
      data.redirect_url,
      data.preview_url,
      data.referrer || null,
      data.referrer_host || null,
      data.ip_address || null,
      data.country || null,
      data.city || null,
      data.latitude ?? null,
      data.longitude ?? null,
      data.accuracy ?? null,
      data.location_source || null,
      data.session_id || null,
      Date.now(),
    );
  }
  // ─── existing helpers (kept for backwards-compat) ───────────────────────────

  public static getVisitsByBlog(
    blog_id: string,
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const params: any[] = [blog_id];
    const entityClause = entity_id ? " AND entity_id = ?" : "";
    if (entity_id) {
      params.push(entity_id);
    }
    const tf = this.timeFilter(params, start, end);
    return db
      .prepare(
        `
      SELECT COUNT(*) as total_visits,
             COUNT(DISTINCT ip_address) as unique_visitors,
             MIN(visited_at) as first_visit,
             MAX(visited_at) as last_visit,
             redirect_url
      FROM preview_visits
      WHERE blog_id = ?${entityClause}${tf}
      GROUP BY redirect_url
    `,
      )
      .all(params);
  }

  public static getTopRedirectUrls(
    limit = 10,
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const params: any[] = [];
    const tf = this.timeFilter(params, start, end);
    const entityClause = entity_id ? " AND entity_id = ?" : "";
    if (entity_id) {
      params.push(entity_id);
    }
    params.push(limit);
    return db
      .prepare(
        `
      SELECT redirect_url,
             COUNT(*) as visits,
             COUNT(DISTINCT blog_id) as article_count,
             COUNT(DISTINCT ip_address) as unique_visitors
      FROM preview_visits WHERE 1=1${entityClause}${tf}
      GROUP BY redirect_url ORDER BY visits DESC LIMIT ?
    `,
      )
      .all(params);
  }

  public static getPlatformBreakdown(
    blog_id?: string,
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const params: any[] = [];
    let sql = `
      SELECT COALESCE(referrer_host, 'Direct / Unknown') as platform,
             COUNT(*) as visits,
             COUNT(DISTINCT ip_address) as unique_visitors
      FROM preview_visits WHERE 1=1`;
    if (blog_id) {
      sql += " AND blog_id = ?";
      params.push(blog_id);
    }
    if (entity_id) {
      sql += " AND entity_id = ?";
      params.push(entity_id);
    }
    sql += this.timeFilter(params, start, end);
    sql += " GROUP BY platform ORDER BY visits DESC";
    return db.prepare(sql).all(params);
  }

  public static getVisitorIps(
    blog_id?: string,
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const params: any[] = [];
    let sql = `
      SELECT ip_address,
             COUNT(*) as visits,
             COUNT(DISTINCT blog_id) as articles_visited,
             MIN(visited_at) as first_seen,
             MAX(visited_at) as last_seen,
             referrer_host as last_platform
      FROM preview_visits
      WHERE ip_address IS NOT NULL`;
    if (blog_id) {
      sql += " AND blog_id = ?";
      params.push(blog_id);
    }
    if (entity_id) {
      sql += " AND entity_id = ?";
      params.push(entity_id);
    }
    sql += this.timeFilter(params, start, end);
    sql += " GROUP BY ip_address ORDER BY visits DESC";
    return db.prepare(sql).all(params);
  }

  // ─── NEW: full article analytics (all blogs) ────────────────────────────────

  /**
   * Returns a comprehensive overview across ALL blogs / articles.
   *
   * Shape:
   * {
   *   summary: { total_visits, total_unique_visitors,
   *              total_articles, total_redirect_urls, first_visit, last_visit },
   *   top_redirect_url: string | null,
   *   redirect_urls: [ { url, visits, unique_visitors,
   *                       articles_linked, first_click, last_click } ],
   *   referral_urls:  [ { url, visits, unique_visitors } ],
   *   articles: [
   *     { blog_id, visits, unique_visitors,
   *       first_visit, last_visit,
   *       redirect_urls: [...], referral_urls: [...] }
   *   ]
   * }
   */
  public static getAllArticlesAnalytics(
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const params: any[] = [];
    let entityClause = "";
    if (entity_id) {
      entityClause = " AND entity_id = ?";
      params.push(entity_id);
    }
    const tf = this.timeFilter(params, start, end);
    const whereExtra = entityClause + tf;

    const summary = db
      .prepare(
        `
    SELECT
      COUNT(*)                       AS total_visits,
      COUNT(DISTINCT ip_address)     AS total_unique_visitors,
      COUNT(DISTINCT blog_id)        AS total_articles,
      COUNT(DISTINCT redirect_url)   AS total_redirect_urls,
      MIN(visited_at)                AS first_visit,
      MAX(visited_at)                AS last_visit
    FROM preview_visits WHERE 1=1${whereExtra}
  `,
      )
      .get(params);

    const topRow = db
      .prepare(
        `
    SELECT redirect_url
    FROM preview_visits WHERE 1=1${whereExtra}
    GROUP BY redirect_url ORDER BY COUNT(*) DESC LIMIT 1
  `,
      )
      .get(params);

    const redirect_urls = db
      .prepare(
        `
    SELECT redirect_url AS url, COUNT(*) AS visits,
           COUNT(DISTINCT ip_address) AS unique_visitors, COUNT(DISTINCT blog_id) AS articles_linked,
           MIN(visited_at) AS first_click, MAX(visited_at) AS last_click
    FROM preview_visits WHERE 1=1${whereExtra}
    GROUP BY redirect_url ORDER BY visits DESC
  `,
      )
      .all(params);

    const referral_urls = db
      .prepare(
        `
    SELECT COALESCE(referrer_host, 'Direct / Unknown') AS url, COUNT(*) AS visits,
           COUNT(DISTINCT ip_address) AS unique_visitors
    FROM preview_visits WHERE 1=1${whereExtra}
    GROUP BY referrer_host ORDER BY visits DESC
  `,
      )
      .all(params);

    const daily_visits = this.getDailyVisits(params, whereExtra);
    const locations = this.getLocationBreakdown(params, whereExtra);

    // ⚠️ articleIds query must use a fresh params array since the per-article
    // queries below build their own param lists from scratch
    const articleIds: { blog_id: string }[] = db
      .prepare(
        `
    SELECT DISTINCT blog_id
    FROM preview_visits WHERE 1=1${whereExtra}
    ORDER BY blog_id
  `,
      )
      .all(params);

    const articles = articleIds.map(({ blog_id }) => {
      const aParams: any[] = [blog_id];
      let aEntityClause = "";
      if (entity_id) {
        aEntityClause = " AND entity_id = ?";
        aParams.push(entity_id);
      }
      const atf = this.timeFilter(aParams, start, end);
      const aWhereExtra = aEntityClause + atf;

      const aHead = db
        .prepare(
          `
      SELECT COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors,
             MIN(visited_at) AS first_visit, MAX(visited_at) AS last_visit
      FROM preview_visits WHERE blog_id = ?${aWhereExtra}
    `,
        )
        .get(aParams);

      const aRedirects = db
        .prepare(
          `
      SELECT redirect_url AS url, COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors,
             MIN(visited_at) AS first_click, MAX(visited_at) AS last_click
      FROM preview_visits WHERE blog_id = ?${aWhereExtra}
      GROUP BY redirect_url ORDER BY visits DESC
    `,
        )
        .all(aParams);

      const aReferrals = db
        .prepare(
          `
      SELECT COALESCE(referrer_host, 'Direct / Unknown') AS url, COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors
      FROM preview_visits WHERE blog_id = ?${aWhereExtra}
      GROUP BY referrer_host ORDER BY visits DESC
    `,
        )
        .all(aParams);

      const aDailyVisits = db
        .prepare(
          `
      SELECT ${this.dailyVisitExpr} AS date,
             COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors
      FROM preview_visits WHERE blog_id = ?${aWhereExtra}
      GROUP BY ${this.dailyVisitExpr}
      ORDER BY date
    `,
        )
        .all(aParams);

      return {
        blog_id,
        ...aHead,
        daily_visits: aDailyVisits,
        redirect_urls: aRedirects,
        referral_urls: aReferrals,
      };
    });

    return {
      summary,
      top_redirect_url: topRow?.redirect_url ?? null,
      daily_visits,
      locations,
      redirect_urls,
      referral_urls,
      articles,
    };
  }
  // ─── NEW: detailed analytics for ONE blog ───────────────────────────────────

  /**
   * Returns all details for a single blog_id:
   * {
   *   blog_id,
   *   summary: { visits, unique_visitors, first_visit, last_visit },
   *   top_redirect_url: string | null,
   *   redirect_urls: [...],
   *   referral_urls: [...],
   *   visitor_ips:   [...]
   * }
   */
  public static getBlogAnalytics(
    blog_id: string,
    start?: number,
    end?: number,
    entity_id?: string,
  ) {
    const db = this.getDb();
    const base: any[] = [blog_id];
    const entityClause = entity_id ? " AND entity_id = ?" : "";
    if (entity_id) {
      base.push(entity_id);
    }
    const tf = this.timeFilter(base, start, end);

    const summary = db
      .prepare(
        `
      SELECT
        COUNT(*)                       AS visits,
        COUNT(DISTINCT ip_address)     AS unique_visitors,
        MIN(visited_at)                AS first_visit,
        MAX(visited_at)                AS last_visit
      FROM preview_visits WHERE blog_id = ?${entityClause}${tf}
    `,
      )
      .get(base);

    const topRow = db
      .prepare(
        `
      SELECT redirect_url
      FROM preview_visits WHERE blog_id = ?${entityClause}${tf}
      GROUP BY redirect_url
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `,
      )
      .get(base);

    const redirect_urls = db
      .prepare(
        `
      SELECT
        redirect_url                   AS url,
        COUNT(*)                       AS visits,
        COUNT(DISTINCT ip_address)     AS unique_visitors,
        MIN(visited_at)                AS first_click,
        MAX(visited_at)                AS last_click
      FROM preview_visits WHERE blog_id = ?${entityClause}${tf}
      GROUP BY redirect_url
      ORDER BY visits DESC
    `,
      )
      .all(base);

    const referral_urls = db
      .prepare(
        `
      SELECT
        COALESCE(referrer_host, 'Direct / Unknown') AS url,
        COUNT(*)                                    AS visits,
        COUNT(DISTINCT ip_address)                  AS unique_visitors
      FROM preview_visits WHERE blog_id = ?${entityClause}${tf}
      GROUP BY referrer_host
      ORDER BY visits DESC
    `,
      )
      .all(base);

    const daily_visits = db
      .prepare(
        `
      SELECT ${this.dailyVisitExpr} AS date,
             COUNT(*) AS visits,
             COUNT(DISTINCT ip_address) AS unique_visitors
      FROM preview_visits
      WHERE blog_id = ?${entityClause}${tf}
      GROUP BY ${this.dailyVisitExpr}
      ORDER BY date
    `,
      )
      .all(base);

    const locations = this.getLocationBreakdown(base, entityClause + tf);

    const visitor_ips = db
      .prepare(
        `
      SELECT
        ip_address,
        COUNT(*)           AS visits,
        MIN(visited_at)    AS first_seen,
        MAX(visited_at)    AS last_seen,
        referrer_host      AS last_platform
      FROM preview_visits
      WHERE blog_id = ? AND ip_address IS NOT NULL${entityClause}${tf}
      GROUP BY ip_address
      ORDER BY visits DESC
    `,
      )
      .all(base);

    return {
      blog_id,
      summary,
      top_redirect_url: topRow?.redirect_url ?? null,
      daily_visits,
      locations,
      redirect_urls,
      referral_urls,
      visitor_ips,
    };
  }
}
