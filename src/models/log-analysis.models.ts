export interface LogEntry {
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

export interface RouteAnalytics {
  route: string;
  visits: number;
  totalDuration: number;
  averageDuration: number;
  firstVisit: string;
  lastVisit: string;
}

export interface UserSession {
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
