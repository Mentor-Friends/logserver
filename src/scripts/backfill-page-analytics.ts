import fs from "fs";
import path from "path";
import { PageAnalyticsIndexService } from "../services/analytics/page-analytics-index.service";
import { readGzippedLogFile } from "../services/analysis/readGzippedLogFile";

type BackfillLog = {
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

function readLogLinesWithRotations(logFile: string): string[] {
  const lines: string[] = [];

  if (fs.existsSync(logFile)) {
    lines.push(...fs.readFileSync(logFile, "utf8").split("\n").filter((line) => line.trim()));
  }

  const dir = path.dirname(logFile);
  const baseName = path.basename(logFile);
  if (!fs.existsSync(dir)) return lines;

  fs.readdirSync(dir)
    .filter(
      (file) =>
        file === `${baseName}.gz` ||
        (file.startsWith(`${baseName}.`) && file.endsWith(".gz")),
    )
    .sort()
    .forEach((file) => {
      lines.push(...readGzippedLogFile(path.join(dir, file)));
    });

  return lines;
}

function getUserIds(logPath: string): number[] {
  const appLogDir = path.join(logPath, "application");
  if (!fs.existsSync(appLogDir)) return [];

  return fs
    .readdirSync(appLogDir)
    .filter((folder) => folder.startsWith("user_"))
    .map((folder) => Number(folder.replace("user_", "")))
    .filter((userId) => !Number.isNaN(userId));
}

function readUserRouteLogs(logPath: string, userId: number): { logs: BackfillLog[]; invalidLines: number } {
  const userFolder = `user_${userId}`;
  const userLogDir = path.join(logPath, "application", userFolder);
  const routeLogFile = path.join(userLogDir, `app_route_user_${userId}.log`);
  const appLogFile = path.join(userLogDir, `applog_user_${userId}.log`);
  const lines = fs.existsSync(routeLogFile) ? readLogLinesWithRotations(routeLogFile) : readLogLinesWithRotations(appLogFile);
  let invalidLines = 0;

  const logs = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        invalidLines += 1;
        return null;
      }
    })
    .filter(Boolean) as BackfillLog[];

  return { logs, invalidLines };
}

async function run() {
  const logPath = process.env.LOGPATH || path.join(process.cwd(), "logs");
  const userIds = getUserIds(logPath);
  let totalLogs = 0;
  let totalInvalidLines = 0;

  await PageAnalyticsIndexService.resetIndex();

  for (const userId of userIds) {
    const { logs, invalidLines } = readUserRouteLogs(logPath, userId);
    totalLogs += logs.length;
    totalInvalidLines += invalidLines;
    PageAnalyticsIndexService.trackLogs(userId, logs);
  }

  console.log(
    JSON.stringify(
      {
        message: "Page analytics summary backfill complete",
        logPath,
        usersProcessed: userIds.length,
        logsProcessed: totalLogs,
        invalidLinesSkipped: totalInvalidLines,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Page analytics summary backfill failed:", error);
  process.exit(1);
});
