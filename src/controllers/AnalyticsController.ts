import LogAnalysisService from "../services/analysis/log-analysis.service";
import { readGzippedLogFile } from "../services/analysis/readGzippedLogFile";
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

// New API: Route analytics table
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
      const logs = lines.map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

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

    // Format for table
    let table = Object.entries(routeMap)
      .map(([route, data]) => {
        const activeUsers = data.users.size;
        const viewsPerActiveUser =
          activeUsers > 0 ? data.views / activeUsers : 0;
        const avgEngagement =
          data.views > 0 ? data.totalTime / data.views : 0;
        return {
          route,
          views: data.views,
          activeUsers,
          viewsPerActiveUser: Number(viewsPerActiveUser.toFixed(2)),
          avgEngagementTime: avgEngagement
            ? formatDuration(avgEngagement)
            : "0s",
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
    const summary = {
      totalViews: table.reduce((sum, row) => sum + row.views, 0),
      totalActiveUsers: uniqueUserIds.size,
      totalEventCount: table.reduce((sum, row) => sum + row.eventCount, 0),
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