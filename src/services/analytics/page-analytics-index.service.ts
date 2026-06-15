import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

type UrlMatchMode = "exact" | "path" | "prefix";

type RouteLog = {
  timestamp?: string;
  level?: string;
  message?: string;
  data?: {
    url?: string;
    requestFrom?: string;
    sessionId?: number;
    ipAddress?: string;
    userAgent?: string;
    acceptLanguage?: string;
    referrer?: string;
    browser?: string;
    os?: string;
    deviceType?: string;
  };
};

type NormalizedUrl = {
  url: string;
  urlKey: string;
  pathKey: string;
  host: string;
  pathname: string;
};

export type PageAnalyticsQuery = {
  url: string;
  startTime: number | null;
  endTime: number | null;
  match: UrlMatchMode;
  bucketSizeMinutes?: number;
  includeBuckets?: boolean;
};

const DEFAULT_BUCKET_SIZE_MINUTES = 15;
const DEFAULT_MAX_DURATION_MINUTES = 60;

export class PageAnalyticsIndexService {
  private static db: any | null = null;
  private static initPromise: Promise<void> | null = null;
  private static operationQueue: Promise<void> = Promise.resolve();
  private static staleVisitTimer: ReturnType<typeof setInterval> | null = null;
  private static pendingLogs: Map<number, RouteLog[]> = new Map();
  private static flushScheduled = false;

  public static trackLogs(userId: number, logs: RouteLog[]): void {
    if (!Array.isArray(logs) || logs.length === 0) return;
    const routeLogs = logs.filter((log) => this.isTrackableRouteLog(log));
    if (routeLogs.length === 0) return;

    const existing = this.pendingLogs.get(userId);
    if (existing) {
      existing.push(...routeLogs);
    } else {
      this.pendingLogs.set(userId, [...routeLogs]);
    }

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flushPendingLogs());
    }
  }

  private static flushPendingLogs(): void {
    this.flushScheduled = false;
    if (this.pendingLogs.size === 0) return;

    const snapshot = this.pendingLogs;
    this.pendingLogs = new Map();

    this.write((db) => {
      db.run("BEGIN TRANSACTION");
      try {
        snapshot.forEach((logs, userId) => {
          const sorted = logs
            .map((log) => ({ log, timeMs: new Date(log.timestamp as string).getTime() }))
            .filter((item) => !Number.isNaN(item.timeMs))
            .sort((a, b) => a.timeMs - b.timeMs);
          sorted.forEach(({ log, timeMs }) => this.trackRouteEvent(db, userId, log, timeMs));
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
      }
    }).catch(() => undefined);
  }

  public static async getPageAnalytics(query: PageAnalyticsQuery) {
    return this.read((db) => {
      const bucketSizeMinutes = query.bucketSizeMinutes || DEFAULT_BUCKET_SIZE_MINUTES;
      const bucketSizeMs = bucketSizeMinutes * 60 * 1000;
      const normalized = this.normalizeUrl(query.url);
      const whereParts = ["bucket_size_minutes = ?"];
      const params: any[] = [bucketSizeMinutes];

      if (query.match === "path") {
        whereParts.push("path_key = ?");
        params.push(normalized.pathKey);
      } else if (query.match === "prefix") {
        whereParts.push("url_key LIKE ?");
        params.push(`${normalized.urlKey}%`);
      } else {
        whereParts.push("url_key = ?");
        params.push(normalized.urlKey);
      }

      if (query.startTime !== null) {
        whereParts.push("bucket_start > ?");
        params.push(query.startTime - bucketSizeMs);
      }
      if (query.endTime !== null) {
        whereParts.push("bucket_start < ?");
        params.push(query.endTime);
      }

      const whereSql = whereParts.join(" AND ");
      const summary = this.queryOne(
        db,
        `
          SELECT
            COALESCE(SUM(visit_count), 0) AS visits,
            COALESCE(SUM(event_count), 0) AS events,
            COALESCE(SUM(known_time_count), 0) AS knownDurationVisits,
            COALESCE(SUM(unknown_time_count), 0) AS unknownDurationVisits,
            COALESCE(SUM(total_time_ms), 0) AS totalTimeSpentMs,
            MIN(min_time_ms) AS minTimeSpentMs,
            MAX(max_time_ms) AS maxTimeSpentMs,
            MIN(first_visit_at) AS firstVisit,
            MAX(last_visit_at) AS lastVisit
          FROM page_url_summary
          WHERE ${whereSql}
        `,
        params,
      );

      const buckets = query.includeBuckets
        ? this.queryRows(
            db,
            `
              SELECT
                bucket_start AS bucketStart,
                SUM(visit_count) AS visits,
                SUM(event_count) AS events,
                SUM(known_time_count) AS knownDurationVisits,
                SUM(unknown_time_count) AS unknownDurationVisits,
                SUM(total_time_ms) AS totalTimeSpentMs,
                MIN(min_time_ms) AS minTimeSpentMs,
                MAX(max_time_ms) AS maxTimeSpentMs,
                MIN(first_visit_at) AS firstVisit,
                MAX(last_visit_at) AS lastVisit
              FROM page_url_summary
              WHERE ${whereSql}
              GROUP BY bucket_start
              ORDER BY bucket_start ASC
            `,
            params,
          )
        : [];

      return {
        normalizedUrl: normalized.urlKey,
        bucketSizeMinutes,
        summary,
        buckets,
      };
    });
  }

  public static async resetIndex(): Promise<void> {
    await this.write((db) => {
      db.run("DELETE FROM active_page_visit");
      db.run("DELETE FROM page_url_summary");
    });
  }

  private static trackRouteEvent(db: any, userId: number, log: RouteLog, timeMs: number): void {
    const url = log.data?.url;
    if (!url) return;

    const normalized = this.normalizeUrl(url);
    const sessionId = log.data?.sessionId || 0;
    const sessionKey = `${userId}:${sessionId}`;
    const bucketStart = this.getBucketStart(timeMs);
    const message = log.message || "Unknown";
    const requestFrom = log.data?.requestFrom || "Unknown";

    this.incrementEventCount(db, normalized, bucketStart);
    this.closeActiveVisit(db, sessionKey, timeMs, message, normalized.urlKey);

    if (!this.isPageEntryEvent(log)) return;

    this.incrementVisitCount(db, normalized, bucketStart, timeMs);
    db.run(
      `
        INSERT OR REPLACE INTO active_page_visit (
          session_key,
          user_id,
          session_id,
          url,
          url_key,
          bucket_start,
          entered_at,
          entry_event,
          request_from
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sessionKey,
        userId,
        sessionId,
        normalized.url,
        normalized.urlKey,
        bucketStart,
        timeMs,
        message,
        requestFrom,
      ],
    );
  }

  private static closeActiveVisit(
    db: any,
    sessionKey: string,
    exitTimeMs: number,
    closeEvent: string,
    closeUrlKey: string,
  ): void {
    const active = this.queryOne(
      db,
      `
        SELECT session_key, url_key, bucket_start, entered_at
        FROM active_page_visit
        WHERE session_key = ?
      `,
      [sessionKey],
    );

    if (!active) return;

    const durationMs = Number(active.entered_at) ? exitTimeMs - Number(active.entered_at) : 0;
    const maxDurationMs = this.getMaxDurationMs();
    const isKnownDuration = durationMs > 0 && durationMs <= maxDurationMs;
    const isBounceLikeExit =
      String(closeEvent).toLowerCase().includes("unload") && active.url_key === closeUrlKey;

    if (isKnownDuration) {
      db.run(
        `
          UPDATE page_url_summary
          SET
            known_time_count = known_time_count + 1,
            total_time_ms = total_time_ms + ?,
            min_time_ms = CASE
              WHEN min_time_ms IS NULL OR ? < min_time_ms THEN ?
              ELSE min_time_ms
            END,
            max_time_ms = CASE
              WHEN max_time_ms IS NULL OR ? > max_time_ms THEN ?
              ELSE max_time_ms
            END,
            bounce_count = bounce_count + ?
          WHERE url_key = ? AND bucket_start = ? AND bucket_size_minutes = ?
        `,
        [
          durationMs,
          durationMs,
          durationMs,
          durationMs,
          durationMs,
          isBounceLikeExit ? 1 : 0,
          active.url_key,
          active.bucket_start,
          DEFAULT_BUCKET_SIZE_MINUTES,
        ],
      );
    } else {
      this.incrementUnknownDuration(db, active.url_key, Number(active.bucket_start));
    }

    db.run("DELETE FROM active_page_visit WHERE session_key = ?", [sessionKey]);
  }

  private static incrementEventCount(db: any, normalized: NormalizedUrl, bucketStart: number): void {
    this.ensureSummaryRow(db, normalized, bucketStart);
    db.run(
      `
        UPDATE page_url_summary
        SET event_count = event_count + 1
        WHERE url_key = ? AND bucket_start = ? AND bucket_size_minutes = ?
      `,
      [normalized.urlKey, bucketStart, DEFAULT_BUCKET_SIZE_MINUTES],
    );
  }

  private static incrementVisitCount(
    db: any,
    normalized: NormalizedUrl,
    bucketStart: number,
    enteredAt: number,
  ): void {
    this.ensureSummaryRow(db, normalized, bucketStart);
    db.run(
      `
        UPDATE page_url_summary
        SET
          visit_count = visit_count + 1,
          first_visit_at = CASE
            WHEN first_visit_at IS NULL OR ? < first_visit_at THEN ?
            ELSE first_visit_at
          END,
          last_visit_at = CASE
            WHEN last_visit_at IS NULL OR ? > last_visit_at THEN ?
            ELSE last_visit_at
          END
        WHERE url_key = ? AND bucket_start = ? AND bucket_size_minutes = ?
      `,
      [
        enteredAt,
        enteredAt,
        enteredAt,
        enteredAt,
        normalized.urlKey,
        bucketStart,
        DEFAULT_BUCKET_SIZE_MINUTES,
      ],
    );
  }

  private static ensureSummaryRow(db: any, normalized: NormalizedUrl, bucketStart: number): void {
    db.run(
      `
        INSERT OR IGNORE INTO page_url_summary (
          url_key,
          path_key,
          url,
          host,
          pathname,
          bucket_start,
          bucket_size_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        normalized.urlKey,
        normalized.pathKey,
        normalized.url,
        normalized.host,
        normalized.pathname,
        bucketStart,
        DEFAULT_BUCKET_SIZE_MINUTES,
      ],
    );
  }

  private static incrementUnknownDuration(db: any, urlKey: string, bucketStart: number): void {
    db.run(
      `
        UPDATE page_url_summary
        SET unknown_time_count = unknown_time_count + 1
        WHERE url_key = ? AND bucket_start = ? AND bucket_size_minutes = ?
      `,
      [urlKey, bucketStart, DEFAULT_BUCKET_SIZE_MINUTES],
    );
  }

  private static expireStaleActiveVisits(db: any, nowMs: number): void {
    const cutoff = nowMs - this.getMaxDurationMs();
    const staleVisits = this.queryRows(
      db,
      `
        SELECT session_key, url_key, bucket_start
        FROM active_page_visit
        WHERE entered_at < ?
      `,
      [cutoff],
    );

    staleVisits.forEach((visit) => {
      this.incrementUnknownDuration(db, String(visit.url_key), Number(visit.bucket_start));
      db.run("DELETE FROM active_page_visit WHERE session_key = ?", [visit.session_key]);
    });
  }

  private static async read<T>(operation: (db: any) => T): Promise<T> {
    await this.ensureDatabase();
    return operation(this.db);
  }

  private static async write<T>(operation: (db: any) => T): Promise<T> {
    const run = async () => {
      await this.ensureDatabase();
      const result = operation(this.db);
      this.persistDatabase();
      return result;
    };

    const next = this.operationQueue.then(run, run);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private static async ensureDatabase(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeDatabase();
    }
    await this.initPromise;
  }

  private static async initializeDatabase(): Promise<void> {
    const dbPath = this.getDatabasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.attachRunHelper(this.db);
    this.ensureSchema(this.db);
    this.startStaleVisitExpiry();
  }

  private static startStaleVisitExpiry(): void {
    if (this.staleVisitTimer) return;
    const INTERVAL_MS = 5 * 60 * 1000;
    this.staleVisitTimer = setInterval(() => {
      this.write((db) => this.expireStaleActiveVisits(db, Date.now())).catch(() => undefined);
    }, INTERVAL_MS);
    if (this.staleVisitTimer.unref) this.staleVisitTimer.unref();
  }

  private static ensureSchema(db: any): void {
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;

      CREATE TABLE IF NOT EXISTS page_url_summary (
        url_key TEXT NOT NULL,
        path_key TEXT NOT NULL,
        url TEXT NOT NULL,
        host TEXT NOT NULL,
        pathname TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        bucket_size_minutes INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        known_time_count INTEGER NOT NULL DEFAULT 0,
        unknown_time_count INTEGER NOT NULL DEFAULT 0,
        total_time_ms INTEGER NOT NULL DEFAULT 0,
        min_time_ms INTEGER,
        max_time_ms INTEGER,
        first_visit_at INTEGER,
        last_visit_at INTEGER,
        bounce_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (url_key, bucket_start, bucket_size_minutes)
      );

      CREATE INDEX IF NOT EXISTS idx_page_url_summary_path_bucket
      ON page_url_summary(path_key, bucket_start);

      CREATE INDEX IF NOT EXISTS idx_page_url_summary_bucket
      ON page_url_summary(bucket_start);

      CREATE TABLE IF NOT EXISTS active_page_visit (
        session_key TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        url_key TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        entered_at INTEGER NOT NULL,
        entry_event TEXT,
        request_from TEXT
      );
    `);
  }

  private static attachRunHelper(db: any): void {
    db.run = (sql: string, params: any[] = []) => {
      if (!params.length && this.hasMultipleSqlStatements(sql)) {
        db.exec(sql);
        return db;
      }

      const statement = db.prepare(sql);
      if (params.length) {
        statement.run(params);
      } else {
        statement.run();
      }

      return db;
    };
  }

  private static hasMultipleSqlStatements(sql: string): boolean {
    return sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean).length > 1;
  }

  private static persistDatabase(): void {
    // better-sqlite3 writes directly to the database file.
  }

  private static queryRows(db: any, sql: string, params: any[] = []): Record<string, any>[] {
    const statement = db.prepare(sql);
    return params.length ? statement.all(params) : statement.all();
  }

  private static queryOne(db: any, sql: string, params: any[] = []): Record<string, any> | null {
    return this.queryRows(db, sql, params)[0] || null;
  }

  private static normalizeUrl(rawUrl: string): NormalizedUrl {
    const trimmedUrl = String(rawUrl || "").trim();

    try {
      const url = new URL(trimmedUrl);
      url.hash = "";
      url.pathname = this.normalizePathname(url.pathname);
      url.searchParams.sort();

      const urlKey = url.toString();
      const pathKey = `${url.origin}${url.pathname}`;
      return {
        url: urlKey,
        urlKey,
        pathKey,
        host: url.host,
        pathname: url.pathname,
      };
    } catch {
      return {
        url: trimmedUrl,
        urlKey: trimmedUrl,
        pathKey: trimmedUrl,
        host: "",
        pathname: trimmedUrl,
      };
    }
  }

  private static normalizePathname(pathname: string): string {
    return pathname.replace(/\/+$/, "") || "/";
  }

  private static getBucketStart(timeMs: number): number {
    const bucketSizeMs = DEFAULT_BUCKET_SIZE_MINUTES * 60 * 1000;
    return Math.floor(timeMs / bucketSizeMs) * bucketSizeMs;
  }

  private static isTrackableRouteLog(log: RouteLog): boolean {
    return (
      !!log?.timestamp &&
      !!log?.data?.url &&
      (log.level === "ROUTE" || log.level === "USER_EVENT")
    );
  }

  private static isPageEntryEvent(log: RouteLog): boolean {
    return !String(log.message || "").toLowerCase().includes("unload");
  }

  private static getMaxDurationMs(): number {
    const minutes = Number(process.env.ANALYTICS_MAX_DURATION_MINUTES || DEFAULT_MAX_DURATION_MINUTES);
    const safeMinutes = Number.isNaN(minutes) || minutes <= 0 ? DEFAULT_MAX_DURATION_MINUTES : minutes;
    return safeMinutes * 60 * 1000;
  }

  private static getDatabasePath(): string {
    if (process.env.ANALYTICS_DB_PATH) {
      return path.resolve(process.env.ANALYTICS_DB_PATH);
    }

    const logPath = process.env.LOGPATH || path.join(process.cwd(), "logs");
    return path.join(logPath, "analytics", "page-summary.db");
  }
}
