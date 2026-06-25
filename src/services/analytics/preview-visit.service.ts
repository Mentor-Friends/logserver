import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export class PreviewVisitService {
  private static db: any = null;

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

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pv_blog_id ON preview_visits(blog_id);
      CREATE INDEX IF NOT EXISTS idx_pv_entity_id ON preview_visits(entity_id);
      CREATE INDEX IF NOT EXISTS idx_pv_redirect_url ON preview_visits(redirect_url);
      CREATE INDEX IF NOT EXISTS idx_pv_referrer_host ON preview_visits(referrer_host);
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

  // ─── record ─────────────────────────────────────────────────────────────────

  public static recordVisit(data: {
    blog_id: string;
    entity_id?: string;
    redirect_url: string;
    preview_url: string;
    referrer?: string;
    referrer_host?: string;
    ip_address?: string;
    session_id?: number;
  }) {
    const db = this.getDb();
    db.prepare(
      `
    INSERT INTO preview_visits
      (blog_id, entity_id, redirect_url, preview_url, referrer, referrer_host, ip_address, session_id, visited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    ).run(
      data.blog_id,
      data.entity_id || null,
      data.redirect_url,
      data.preview_url,
      data.referrer || null,
      data.referrer_host || null,
      data.ip_address || null,
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

      return {
        blog_id,
        ...aHead,
        redirect_urls: aRedirects,
        referral_urls: aReferrals,
      };
    });

    return {
      summary,
      top_redirect_url: topRow?.redirect_url ?? null,
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
      redirect_urls,
      referral_urls,
      visitor_ips,
    };
  }
}
