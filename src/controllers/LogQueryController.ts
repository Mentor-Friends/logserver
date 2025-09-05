// src/controllers/LogQueryController.ts
import { Request, Response } from "express";
import LogAnalysisService from "../services/analysis/log-analysis.service";

// Format duration into human-readable text
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
};

export const getUserRouteActivity = (req: Request, res: Response) => {
  try {
    const userId =
      parseInt(req.params.userId) ||
      parseInt(req.query.userId as string) ||
      998;

    const sessionId = req.query.sessionId
      ? parseInt(req.query.sessionId as string)
      : undefined;

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 0;

    // Fetch & filter logs
    const logs = LogAnalysisService.getUserRouteLogs(userId).filter(
      (log) =>
        log.data?.url &&
        (!sessionId || log.data?.sessionId === sessionId)
    );

    // Group by sessionId
    const sessions = Object.values(
      logs.reduce<Record<number, any[]>>((acc, log) => {
        const sid = log.data?.sessionId || 0;
        (acc[sid] ||= []).push(log);
        return acc;
      }, {})
    ).map((groupLogs) => {
      groupLogs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const activities = groupLogs.map((log, idx) => {
        const tsUtc = new Date(log.timestamp); // base UTC timestamp
        const next = groupLogs[idx + 1];

        const durationMs = next
          ? new Date(next.timestamp).getTime() - tsUtc.getTime()
          : 0;

        return {
          activity: log.message || "Unknown",
          route: log.data?.url,
          timeSpent: durationMs ? formatDuration(durationMs) : "Unknown",
          timeSpentMs: durationMs,
          exactTimestamp: log.timestamp, // original UTC ISO string
          sessionId: log.data?.sessionId,
          requestFrom: log.data?.requestFrom || "Unknown",
        };
      });

      return {
        sessionId: groupLogs[0].data?.sessionId || 0,
        activityCount: activities.length,
        activities: activities.sort(
          (a, b) =>
            new Date(b.exactTimestamp).getTime() -
            new Date(a.exactTimestamp).getTime()
        ),
      };
    });

    // Sort sessions by most recent activity
    sessions.sort(
      (a, b) =>
        new Date(b.activities[0]?.exactTimestamp).getTime() -
        new Date(a.activities[0]?.exactTimestamp).getTime()
    );

    const limitedSessions = limit > 0 ? sessions.slice(0, limit) : sessions;

    // Calculate summary
    const totalTimeMs = limitedSessions
      .flatMap((s) => s.activities.map((a) => a.timeSpentMs || 0))
      .reduce((a, b) => a + b, 0);

    const totalActivities = limitedSessions.reduce(
      (sum, s) => sum + s.activityCount,
      0
    );

    res.json({
      userId,
      summary: {
        sessionCount: limitedSessions.length,
        totalActivities,
        totalTimeSpent: totalTimeMs ? formatDuration(totalTimeMs) : "Unknown",
      },
      sessions: limitedSessions,
    });
  } catch (err) {
    console.error("Error getting user route activity:", err);
    res.status(500).json({ error: "Failed to retrieve user route activity" });
  }
};
