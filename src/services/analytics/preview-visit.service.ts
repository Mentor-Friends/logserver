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
        visited_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pv_blog_id
        ON preview_visits(blog_id);
      CREATE INDEX IF NOT EXISTS idx_pv_redirect_url
        ON preview_visits(redirect_url);
      CREATE INDEX IF NOT EXISTS idx_pv_referrer_host
        ON preview_visits(referrer_host);
      CREATE INDEX IF NOT EXISTS idx_pv_visited_at
        ON preview_visits(visited_at);
    `);
  }

  // Save one visit row
  public static recordVisit(data: {
    blog_id: string;
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
        (blog_id, redirect_url, preview_url, referrer, referrer_host, ip_address, session_id, visited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      data.blog_id,
      data.redirect_url,
      data.preview_url,
      data.referrer || null,
      data.referrer_host || null,
      data.ip_address || null,
      data.session_id || null,
      Date.now(),
    );
  }

  // Total visits for a blog_id
  public static getVisitsByBlog(blog_id: string, start?: number, end?: number) {
    const db = this.getDb();
    let sql = `SELECT COUNT(*) as total_visits,
                      COUNT(DISTINCT ip_address) as unique_visitors,
                      MIN(visited_at) as first_visit,
                      MAX(visited_at) as last_visit,
                      redirect_url
               FROM preview_visits
               WHERE blog_id = ?`;
    const params: any[] = [blog_id];
    if (start) {
      sql += ` AND visited_at >= ?`;
      params.push(start);
    }
    if (end) {
      sql += ` AND visited_at <= ?`;
      params.push(end);
    }
    sql += ` GROUP BY redirect_url`;
    return db.prepare(sql).all(params);
  }

  // Top redirect_urls by click count
  public static getTopRedirectUrls(limit = 10, start?: number, end?: number) {
    const db = this.getDb();
    let sql = `SELECT redirect_url,
                      COUNT(*) as total_clicks,
                      COUNT(DISTINCT blog_id) as article_count,
                      COUNT(DISTINCT ip_address) as unique_visitors
               FROM preview_visits WHERE 1=1`;
    const params: any[] = [];
    if (start) {
      sql += ` AND visited_at >= ?`;
      params.push(start);
    }
    if (end) {
      sql += ` AND visited_at <= ?`;
      params.push(end);
    }
    sql += ` GROUP BY redirect_url ORDER BY total_clicks DESC LIMIT ?`;
    params.push(limit);
    return db.prepare(sql).all(params);
  }

  // Platform breakdown (which referrer sent the most visitors)
  public static getPlatformBreakdown(
    blog_id?: string,
    start?: number,
    end?: number,
  ) {
    const db = this.getDb();
    let sql = `SELECT
                 COALESCE(referrer_host, 'Direct / Unknown') as platform,
                 COUNT(*) as visits,
                 COUNT(DISTINCT ip_address) as unique_visitors
               FROM preview_visits WHERE 1=1`;
    const params: any[] = [];
    if (blog_id) {
      sql += ` AND blog_id = ?`;
      params.push(blog_id);
    }
    if (start) {
      sql += ` AND visited_at >= ?`;
      params.push(start);
    }
    if (end) {
      sql += ` AND visited_at <= ?`;
      params.push(end);
    }
    sql += ` GROUP BY platform ORDER BY visits DESC`;
    return db.prepare(sql).all(params);
  }

  // Visits grouped by IP for a blog
  public static getVisitorIps(blog_id?: string, start?: number, end?: number) {
    const db = this.getDb();
    let sql = `SELECT
                ip_address,
                COUNT(*) as visits,
                COUNT(DISTINCT blog_id) as articles_visited,
                MIN(visited_at) as first_seen,
                MAX(visited_at) as last_seen,
                referrer_host as last_platform
                FROM preview_visits
                WHERE ip_address IS NOT NULL`;
    const params: any[] = [];
    if (blog_id) {
      sql += ` AND blog_id = ?`;
      params.push(blog_id);
    }
    if (start) {
      sql += ` AND visited_at >= ?`;
      params.push(start);
    }
    if (end) {
      sql += ` AND visited_at <= ?`;
      params.push(end);
    }
    sql += ` GROUP BY ip_address ORDER BY visits DESC`;
    return db.prepare(sql).all(params);
  }
}
