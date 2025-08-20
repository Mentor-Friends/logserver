import fs from 'fs';
import path from 'path';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: {
    url?: string;
    requestFrom?: string;
    sessionId?: number;
  };
  startTime?: number;
  endTime?: number;
  functionName?: string;
  functionParameters?: any[];
  arguments?: any[];
  requestFrom?: string;
  sessionId?: number;
  applicationId?: number;
  duration?: number;
}

interface RouteAnalytics {
  route: string;
  visits: number;
  totalDuration: number;
  averageDuration: number;
  firstVisit: string;
  lastVisit: string;
}

interface UserSession {
  sessionId: number;
  startTime: string;
  endTime: string;
  duration: number;
  routeSequence: {
    route: string;
    timestamp: string;
    duration?: number;
  }[];
}

class LogAnalysisService {
  
  /**
   * Read and parse a log file
   */
  static parseLogFile(filePath: string): LogEntry[] {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`Log file not found at: ${filePath}`);
        return [];
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      const logs = data
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (err) {
            console.error(`Error parsing log line: ${line}`);
            return null;
          }
        })
        .filter(log => log !== null);
      
      return logs;
    } catch (err) {
      console.error(`Error reading log file: ${err}`);
      return [];
    }
  }

  /**
   * Get all logs for a specific user
   */
  static getUserLogs(userId: number, logType: string = 'application'): LogEntry[] {
    try {
      const logPath = process.env.LOGPATH || '';
      const userFolder = `user_${userId}`;
      const fileName = logType === 'application' 
        ? `applog_user_${userId}.log`
        : `mftsccslog_user_${userId}.log`;
      
      const logFilePath = path.join(logPath, logType, userFolder, fileName);
      return this.parseLogFile(logFilePath);
    } catch (err) {
      console.error(`Error getting logs for user ${userId}: ${err}`);
      return [];
    }
  }

    /**
   * Get all route logs for a specific user
   */
  static getUserRouteLogs(userId: number, logType: string = 'application'): LogEntry[] {
    try {
      const logPath = process.env.LOGPATH || '';
      const userFolder = `user_${userId}`;
      const fileName = logType === 'application' 
        ? `app_route_user_${userId}.log`
        : `mftsccs_route_user_${userId}.log`;
      
      const logFilePath = path.join(logPath, logType, userFolder, fileName);
      return this.parseLogFile(logFilePath);
    } catch (err) {
      console.error(`Error getting logs for user ${userId}: ${err}`);
      return [];
    }
  }

  /**
   * Extract route change logs and calculate time spent on each route
   */
  static analyzeRouteUsage(logs: LogEntry[]): { 
    routeAnalytics: Record<string, RouteAnalytics>,
    sessions: UserSession[] 
  } {
    const routeLogs = logs.filter(log => 
      log.level === 'ROUTE' && 
      log.message === 'Route Change' &&
      log.data?.url
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    const routeAnalytics: Record<string, RouteAnalytics> = {};
    const sessions: Record<number, UserSession> = {};

    // Process route logs to extract sessions and calculate durations
    for (let i = 0; i < routeLogs.length; i++) {
      const log = routeLogs[i];
      const nextLog = routeLogs[i + 1];
      const url = log.data?.url || '';
      const sessionId = log.data?.sessionId || 0;
      
      // Initialize route analytics if not exists
      if (!routeAnalytics[url]) {
        routeAnalytics[url] = {
          route: url,
          visits: 0,
          totalDuration: 0,
          averageDuration: 0,
          firstVisit: log.timestamp,
          lastVisit: log.timestamp
        };
      }
      
      // Update route visit metrics
      routeAnalytics[url].visits += 1;
      routeAnalytics[url].lastVisit = log.timestamp;
      
      // Calculate duration if next log exists
      let duration = 0;
      if (nextLog && nextLog.data?.sessionId === sessionId) {
        duration = new Date(nextLog.timestamp).getTime() - new Date(log.timestamp).getTime();
        routeAnalytics[url].totalDuration += duration;
      }
      
      // Initialize session if not exists
      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          sessionId,
          startTime: log.timestamp,
          endTime: log.timestamp,
          duration: 0,
          routeSequence: []
        };
      }
      
      // Add route to session
      sessions[sessionId].routeSequence.push({
        route: url,
        timestamp: log.timestamp,
        duration: duration > 0 ? duration / 1000 : undefined  // Convert to seconds if duration exists
      });
      
      // Update session end time
      sessions[sessionId].endTime = log.timestamp;
      
      // Update session duration
      if (duration > 0) {
        sessions[sessionId].duration += duration / 1000;  // Convert to seconds
      }
    }
    
    // Calculate average duration for each route
    Object.values(routeAnalytics).forEach(route => {
      route.averageDuration = route.visits > 0 ? route.totalDuration / route.visits / 1000 : 0;  // Convert to seconds
      route.totalDuration = route.totalDuration / 1000;  // Convert to seconds
    });
    
    return {
      routeAnalytics,
      sessions: Object.values(sessions)
    };
  }

  /**
   * Get error logs for a user
   */
  static getUserErrors(logs: LogEntry[]): LogEntry[] {
    return logs.filter(log => log.level === 'ERROR');
  }

  /**
   * Get most recent logs for a user within a time period
   */
  static getRecentLogs(logs: LogEntry[], hours: number = 24): LogEntry[] {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours);
    
    return logs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime >= cutoffTime;
    });
  }

  /**
   * Get detailed route navigation flow
   */
  static getRouteFlowAnalysis(logs: LogEntry[]): { 
    flows: Record<string, { count: number, nextRoutes: Record<string, number> }> 
  } {
    const routeLogs = logs.filter(log => 
      log.level === 'ROUTE' && 
      log.message === 'Route Change' &&
      log.data?.url
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    const flows: Record<string, { count: number, nextRoutes: Record<string, number> }> = {};
    
    // Group route logs by session
    const sessionLogs: Record<number, LogEntry[]> = {};
    routeLogs.forEach(log => {
      const sessionId = log.data?.sessionId || 0;
      if (!sessionLogs[sessionId]) {
        sessionLogs[sessionId] = [];
      }
      sessionLogs[sessionId].push(log);
    });
    
    // Analyze each session for route flow
    Object.values(sessionLogs).forEach(session => {
      for (let i = 0; i < session.length - 1; i++) {
        const currentRoute = session[i].data?.url || '';
        const nextRoute = session[i + 1].data?.url || '';
        
        // Initialize flow for route if not exists
        if (!flows[currentRoute]) {
          flows[currentRoute] = { count: 0, nextRoutes: {} };
        }
        
        // Increment route count
        flows[currentRoute].count++;
        
        // Add next route
        if (!flows[currentRoute].nextRoutes[nextRoute]) {
          flows[currentRoute].nextRoutes[nextRoute] = 0;
        }
        flows[currentRoute].nextRoutes[nextRoute]++;
      }
    });
    
    return { flows };
  }
}

export default LogAnalysisService;
