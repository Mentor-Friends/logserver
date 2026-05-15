import { readGzippedLogFile } from "../services/analysis/readGzippedLogFile";
import { PageAnalyticsIndexService } from "../services/analytics/page-analytics-index.service";
import fs from "fs";
import path from "path";

// Helper to format duration in ms to human-readable string
function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / (1000 * 60)) % 60;
  const hr = Math.floor(ms / (1000 * 60 * 60));
  const parts = [];
  if (hr) parts.push(`${hr}h`);
  if (min) parts.push(`${min}m`);
  if (sec || (!hr && !min)) parts.push(`${sec}s`);
  return parts.join(" ");
}

// Helper to get all user folders
function getAllUserIds(): number[] {
  const logPath = process.env.LOGPATH || "";
  const appDir = path.join(logPath, "application");
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir)
    .filter((f) => f.startsWith("user_"))
    .map((f) => Number(f.replace("user_", "")))
    .filter((id) => !isNaN(id));
}

type UrlMatchMode = "exact" | "path" | "prefix";

function getRequestSource(req: any) {
  return req.method === "POST" ? req.body : req.query;
}

function parseOptionalDate(value: any): number | null {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

export const getPageAnalytics = async (req: any, res: any) => {
  try {
    const source = getRequestSource(req);
    const targetUrl = source.url || source.route || source.webpageUrl;

    if (!targetUrl) {
      return res.status(400).json({
        error: "Missing required url parameter",
        example: "/api/analytics/page?url=https%3A%2F%2Fboomconsole.com%2Fplayground%2F104323081",
      });
    }

    const startTime = parseOptionalDate(source.start);
    const endTime = parseOptionalDate(source.end);
    if (source.start && startTime === null) {
      return res.status(400).json({ error: "Invalid start date" });
    }
    if (source.end && endTime === null) {
      return res.status(400).json({ error: "Invalid end date" });
    }
    if (startTime !== null && endTime !== null && startTime > endTime) {
      return res.status(400).json({ error: "start must be before end" });
    }

    const requestedMatch = String(source.match || "exact");
    const matchMode: UrlMatchMode = ["exact", "path", "prefix"].includes(requestedMatch)
      ? (requestedMatch as UrlMatchMode)
      : "exact";
    const includeBuckets = source.includeBuckets !== "false";
    const result = await PageAnalyticsIndexService.getPageAnalytics({
      url: String(targetUrl),
      startTime,
      endTime,
      match: matchMode,
      includeBuckets,
    });

    const summary = result.summary || {};
    const visits = Number(summary.visits || 0);
    const events = Number(summary.events || 0);
    const knownDurationVisits = Number(summary.knownDurationVisits || 0);
    const unknownDurationVisits = Number(summary.unknownDurationVisits || 0);
    const totalTimeSpentMs = Number(summary.totalTimeSpentMs || 0);
    const averageTimeSpentMs = knownDurationVisits
      ? Math.round(totalTimeSpentMs / knownDurationVisits)
      : 0;

    res.json({
      url: String(targetUrl),
      filters: {
        start: startTime !== null ? new Date(startTime).toISOString() : null,
        end: endTime !== null ? new Date(endTime).toISOString() : null,
        match: matchMode,
        bucketSizeMinutes: result.bucketSizeMinutes,
      },
      normalizedUrl: result.normalizedUrl,
      summary: {
        visits,
        events,
        knownDurationVisits,
        unknownDurationVisits,
        totalTimeSpentMs,
        totalTimeSpent: formatDuration(totalTimeSpentMs),
        averageTimeSpentMs,
        averageTimeSpent: formatDuration(averageTimeSpentMs),
        minTimeSpentMs: summary.minTimeSpentMs ?? null,
        minTimeSpent: summary.minTimeSpentMs ? formatDuration(Number(summary.minTimeSpentMs)) : null,
        maxTimeSpentMs: summary.maxTimeSpentMs ?? null,
        maxTimeSpent: summary.maxTimeSpentMs ? formatDuration(Number(summary.maxTimeSpentMs)) : null,
        firstVisit: summary.firstVisit ? new Date(Number(summary.firstVisit)).toISOString() : null,
        lastVisit: summary.lastVisit ? new Date(Number(summary.lastVisit)).toISOString() : null,
      },
      buckets: result.buckets.map((bucket: any) => {
        const bucketTotalTimeMs = Number(bucket.totalTimeSpentMs || 0);
        const bucketKnownVisits = Number(bucket.knownDurationVisits || 0);
        const bucketAverageTimeMs = bucketKnownVisits
          ? Math.round(bucketTotalTimeMs / bucketKnownVisits)
          : 0;

        return {
          bucketStart: new Date(Number(bucket.bucketStart)).toISOString(),
          visits: Number(bucket.visits || 0),
          events: Number(bucket.events || 0),
          knownDurationVisits: bucketKnownVisits,
          unknownDurationVisits: Number(bucket.unknownDurationVisits || 0),
          totalTimeSpentMs: bucketTotalTimeMs,
          totalTimeSpent: formatDuration(bucketTotalTimeMs),
          averageTimeSpentMs: bucketAverageTimeMs,
          averageTimeSpent: formatDuration(bucketAverageTimeMs),
        };
      }),
    });
  } catch (err) {
    console.error("Error in getPageAnalytics:", err);
    res.status(500).json({ error: "Failed to get page analytics" });
  }
};

// New API: Route analytics table
// This endpoint aggregates per-route analytics across all users.
// It reads log files for each user, computes views, active users, engagement time, and event counts per route.
// Supports filtering by time, domain, and route, and paginates results for table display.
export const getRouteAnalyticsTable = (req: any, res: any) => {
  try {
    // Support POST (body) and GET (query) for filters
    const source = req.method === 'POST' ? req.body : req.query;
    const { start, end, page, pageSize, domain, route } = source;
    const startTime = start ? new Date(start).getTime() : null;
    const endTime = end ? new Date(end).getTime() : null;
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : undefined;
    const domainFilter = domain ? String(domain) : undefined;
    const routeFilter = route ? String(route) : undefined;

    // Gather all userIds
    const userIds = getAllUserIds();
    // Per-route aggregate
    const routeMap: Record<
      string,
      {
        views: number;
        users: Set<number>;
        totalTime: number;
        eventCount: number;
        userViews: Record<number, number>;
      }
    > = {};

    userIds.forEach((userId) => {
      // Try to read .log, then .log.gz if not found
      const logPath = process.env.LOGPATH || "";
      const userFolder = `user_${userId}`;
      const logFile = path.join(logPath, "application", userFolder, `app_route_user_${userId}.log`);
      let lines: string[] = [];
      if (fs.existsSync(logFile)) {
        lines = fs.readFileSync(logFile, "utf8").split("\n").filter(l => l.trim());
      } else if (fs.existsSync(logFile + ".gz")) {
        lines = readGzippedLogFile(logFile + ".gz");
      }
      const logs = lines
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(log => log && log.level === "ROUTE");

      // Time filter
      const filteredLogs = logs.filter((log: any) => {
        const t = new Date(log.timestamp).getTime();
        if (startTime && t < startTime) return false;
        if (endTime && t > endTime) return false;
        return true;
      });

      // Sort logs by session, then timestamp
      filteredLogs.sort((a: any, b: any) => {
        if (a.data?.sessionId !== b.data?.sessionId) {
          return (a.data?.sessionId || 0) - (b.data?.sessionId || 0);
        }
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });

      // Per-user, per-route time
      const userRouteTime: Record<string, number> = {};
      const userRouteViews: Record<string, number> = {};
      const userRouteEvents: Record<string, number> = {};

      for (let i = 0; i < filteredLogs.length; ++i) {
        const log = filteredLogs[i];
        const route = log.data?.url || "Unknown";
        userRouteViews[route] = (userRouteViews[route] || 0) + 1;
        userRouteEvents[route] = (userRouteEvents[route] || 0) + 1;

        // Calculate time spent (difference to next log for same user/session)
        const next = filteredLogs[i + 1];
        if (
          next &&
          next.data?.sessionId === log.data?.sessionId &&
          (((next.data as any)?.userId ?? userId) === userId)
        ) {
          const duration =
            new Date(next.timestamp).getTime() - new Date(log.timestamp).getTime();
          if (duration > 0 && duration < 1000 * 60 * 60) {
            userRouteTime[route] = (userRouteTime[route] || 0) + duration;
          }
        }
      }

      // Aggregate per-user route data into global routeMap
      Object.keys(userRouteViews).forEach((route) => {
        if (!routeMap[route]) {
          routeMap[route] = {
            views: 0,
            users: new Set(),
            totalTime: 0,
            eventCount: 0,
            userViews: {},
          };
        }
        routeMap[route].views += userRouteViews[route];
        routeMap[route].users.add(userId);
        routeMap[route].eventCount += userRouteEvents[route];
        routeMap[route].userViews[userId] = (routeMap[route].userViews[userId] || 0) + userRouteViews[route];
        routeMap[route].totalTime += userRouteTime[route] || 0;
      });
    });

    // Calculate session metrics per route
    const routeSessionMap: Record<string, Set<number>> = {};
    
    userIds.forEach((userId) => {
      const logPath = process.env.LOGPATH || "";
      const userFolder = `user_${userId}`;
      const logFile = path.join(logPath, "application", userFolder, `app_route_user_${userId}.log`);
      let lines: string[] = [];
      if (fs.existsSync(logFile)) {
        lines = fs.readFileSync(logFile, "utf8").split("\n").filter(l => l.trim());
      } else if (fs.existsSync(logFile + ".gz")) {
        lines = readGzippedLogFile(logFile + ".gz");
      }
      const logs = lines
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);

      // Time filter
      const filteredLogs = logs.filter((log: any) => {
        const t = new Date(log.timestamp).getTime();
        if (startTime && t < startTime) return false;
        if (endTime && t > endTime) return false;
        return true;
      });

      // Track which sessions visited each route
      filteredLogs.forEach((log: any) => {
        const route = log.data?.url || "Unknown";
        const sessionId = log.data?.sessionId || 0;
        if (!routeSessionMap[route]) {
          routeSessionMap[route] = new Set();
        }
        routeSessionMap[route].add(sessionId);
      });
    });

    // Format for table
    let table = Object.entries(routeMap)
      .map(([route, data]) => {
        const activeUsers = data.users.size;
        const activeSessions = routeSessionMap[route]?.size || 0;
        const viewsPerActiveUser = activeUsers > 0 ? data.views / activeUsers : 0;
        const viewsPerSession = activeSessions > 0 ? data.views / activeSessions : 0;
        const avgEngagement = data.users.size > 0 ? data.totalTime / data.users.size : 0;
        const avgEngagementPerSession = activeSessions > 0 ? data.totalTime / activeSessions : 0;
        
        return {
          route,
          totalTime: formatDuration(data.totalTime),
          views: data.views,
          activeUsers,
          activeSessions,
          viewsPerActiveUser: Number(viewsPerActiveUser.toFixed(2)),
          viewsPerSession: Number(viewsPerSession.toFixed(2)),
          avgEngagementTime: avgEngagement ? formatDuration(avgEngagement) : "0s",
          avgEngagementTimePerSession: avgEngagementPerSession ? formatDuration(avgEngagementPerSession) : "0s",
          eventCount: data.eventCount,
        };
      })
      // Domain filter (host or prefix match)
      .filter(row => {
        if (!domainFilter) return true;
        try {
          // If route is a full URL, check host or prefix
          const u = new URL(row.route, 'http://dummy');
          if (u.host && (u.host.includes(domainFilter) || row.route.startsWith(domainFilter))) return true;
        } catch {
          // Not a full URL, fallback to prefix match
          if (row.route.startsWith(domainFilter)) return true;
        }
        return false;
      })
      // Route filter (applied after domain)
      .filter(row => {
        if (!routeFilter) return true;
        // If route is a full URL, check path after domain
        try {
          const u = new URL(row.route, 'http://dummy');
          return u.pathname.startsWith(routeFilter) || row.route === routeFilter || row.route.endsWith(routeFilter);
        } catch {
          // Not a full URL, fallback to substring match
          return row.route === routeFilter || row.route.endsWith(routeFilter);
        }
      })
      .sort((a, b) => b.views - a.views);

    const totalRoutes = table.length;
    // Summary for the filtered table
    // Calculate unique active users across all filtered routes
    const uniqueUserIds = new Set<number>();
    Object.entries(routeMap).forEach(([route, data]) => {
      // Only consider routes that are in the filtered table
      if (table.find(row => row.route === route)) {
        data.users.forEach(userId => uniqueUserIds.add(userId));
      }
    });
    // Calculate session statistics
    const sessionStats = new Map<number, { userId: number; routes: Set<string>; totalViews: number; totalTime: number }>();
    
    userIds.forEach((userId) => {
      // Re-read logs for session analysis
      const logPath = process.env.LOGPATH || "";
      const userFolder = `user_${userId}`;
      const logFile = path.join(logPath, "application", userFolder, `app_route_user_${userId}.log`);
      let lines: string[] = [];
      if (fs.existsSync(logFile)) {
        lines = fs.readFileSync(logFile, "utf8").split("\n").filter(l => l.trim());
      } else if (fs.existsSync(logFile + ".gz")) {
        lines = readGzippedLogFile(logFile + ".gz");
      }
      const logs = lines
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(log => log && log.level === "ROUTE");

      // Time filter
      const filteredLogs = logs.filter((log: any) => {
        const t = new Date(log.timestamp).getTime();
        if (startTime && t < startTime) return false;
        if (endTime && t > endTime) return false;
        return true;
      });

      // Group by sessionId
      const sessionGroups = filteredLogs.reduce((acc: any, log: any) => {
        const sessionId = log.data?.sessionId || 0;
        if (!acc[sessionId]) acc[sessionId] = [];
        acc[sessionId].push(log);
        return acc;
      }, {});

      Object.entries(sessionGroups).forEach(([sessionId, sessionLogs]: [string, any[]]) => {
        const sid = parseInt(sessionId);
        sessionLogs.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        if (!sessionStats.has(sid)) {
          sessionStats.set(sid, { userId, routes: new Set(), totalViews: 0, totalTime: 0 });
        }
        
        const sessionData = sessionStats.get(sid)!;
        sessionData.totalViews += sessionLogs.length;
        
        sessionLogs.forEach((log: any, idx: number) => {
          const route = log.data?.url || "Unknown";
          sessionData.routes.add(route);
          
          // Calculate time spent in this route
          const next = sessionLogs[idx + 1];
          if (next) {
            const duration = new Date(next.timestamp).getTime() - new Date(log.timestamp).getTime();
            if (duration > 0 && duration < 1000 * 60 * 60) {
              sessionData.totalTime += duration;
            }
          }
        });
      });
    });


    const summary = {
      totalViews: table.reduce((sum, row) => sum + row.views, 0),
      totalActiveUsers: uniqueUserIds.size,
      totalEventCount: table.reduce((sum, row) => sum + row.eventCount, 0),
      activeSessions: sessionStats.size,
    };
    if (pageNum || pageSizeNum) {
      const startIdx = (pageNum - 1) * (pageSizeNum || table.length);
      const endIdx = pageSizeNum ? startIdx + pageSizeNum : undefined;
      table = table.slice(startIdx, endIdx);
    }

    res.json({ totalRoutes, summary, table });
  } catch (err) {
    console.error("Error in getRouteAnalyticsTable:", err);
    res.status(500).json({ error: "Failed to get route analytics table" });
  }
};
