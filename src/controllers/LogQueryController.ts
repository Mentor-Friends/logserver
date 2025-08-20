// src/controllers/LogQueryController.ts
import { Request, Response } from 'express';
import LogAnalysisService from '../services/analysis/log-analysis.service';

/**
 * Get user route analytics - time spent on each route
 */
export const getUserRouteAnalytics = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const logs = LogAnalysisService.getUserLogs(userId);
        const analytics = LogAnalysisService.analyzeRouteUsage(logs);

        res.status(200).json({
            userId,
            routeAnalytics: Object.values(analytics.routeAnalytics),
            sessionCount: analytics.sessions.length
        });
    } catch (error) {
        console.error(`Error getting route analytics: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve route analytics' });
    }
};

/**
 * Get user session history with route sequence and time spent
 */
export const getUserSessionHistory = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
        
        const logs = LogAnalysisService.getUserLogs(userId);
        const { sessions } = LogAnalysisService.analyzeRouteUsage(logs);
        
        let filteredSessions = sessions;
        
        // Filter by sessionId if provided
        if (sessionId) {
            filteredSessions = sessions.filter(session => session.sessionId === sessionId);
        }
        
        // Sort sessions by start time (newest first)
        filteredSessions.sort((a, b) => 
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
        
        // Apply limit
        if (limit > 0) {
            filteredSessions = filteredSessions.slice(0, limit);
        }
        
        res.status(200).json({
            userId,
            totalSessions: sessions.length,
            sessions: filteredSessions
        });
    } catch (error) {
        console.error(`Error getting session history: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve session history' });
    }
};

/**
 * Get route flow analysis - how users navigate between routes
 */
export const getRouteFlowAnalysis = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const logs = LogAnalysisService.getUserLogs(userId);
        const flowAnalysis = LogAnalysisService.getRouteFlowAnalysis(logs);
        
        res.status(200).json({
            userId,
            flowAnalysis: flowAnalysis.flows
        });
    } catch (error) {
        console.error(`Error getting route flow analysis: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve route flow analysis' });
    }
};

/**
 * Get error logs for a specific user
 */
export const getUserErrorLogs = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;
        
        const logs = LogAnalysisService.getUserLogs(userId);
        const errors = LogAnalysisService.getUserErrors(logs);
        const recentErrors = LogAnalysisService.getRecentLogs(errors, hours);
        
        res.status(200).json({
            userId,
            timeframe: `${hours} hours`,
            totalErrors: errors.length,
            recentErrors: recentErrors.length,
            errors: recentErrors
        });
    } catch (error) {
        console.error(`Error getting error logs: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve error logs' });
    }
};

/**
 * Get comprehensive user analytics dashboard data
 */
export const getUserAnalyticsDashboard = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const logs = LogAnalysisService.getUserLogs(userId);
        
        // Get route analytics
        const { routeAnalytics, sessions } = LogAnalysisService.analyzeRouteUsage(logs);
        
        // Get error statistics
        const errors = LogAnalysisService.getUserErrors(logs);
        const recentErrors = LogAnalysisService.getRecentLogs(errors, 24);
        
        // Get flow analysis
        const { flows } = LogAnalysisService.getRouteFlowAnalysis(logs);
        
        // Calculate total time spent
        const totalTimeSpent = Object.values(routeAnalytics).reduce(
            (total, route) => total + route.totalDuration, 0
        );
        
        // Get most visited routes
        const topRoutes = Object.values(routeAnalytics)
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 5);
        
        // Get routes with longest average time
        const longestTimeRoutes = Object.values(routeAnalytics)
            .sort((a, b) => b.averageDuration - a.averageDuration)
            .slice(0, 5);
        
        res.status(200).json({
            userId,
            summary: {
                totalSessions: sessions.length,
                totalTimeSpent, // in seconds
                totalRoutes: Object.keys(routeAnalytics).length,
                totalErrors: errors.length,
                recentErrors: recentErrors.length
            },
            topRoutes,
            longestTimeRoutes,
            recentSessions: sessions
                .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                .slice(0, 3),
            recentErrors: recentErrors.slice(0, 5)
        });
    } catch (error) {
        console.error(`Error getting analytics dashboard: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve analytics dashboard' });
    }
};

/**
 * Get user activity timeline
 */
export const getUserActivityTimeline = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const days = req.query.days ? parseInt(req.query.days as string) : 7;
        
        const logs = LogAnalysisService.getUserLogs(userId);
        
        // Filter logs by date range
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const filteredLogs = logs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate >= cutoffDate;
        });
        
        // Group by day
        const activityByDay: Record<string, {
            date: string;
            routeChanges: number;
            errors: number;
            totalTimeSpent: number;
            sessions: number;
            uniqueRoutes: Set<string>;
        }> = {};
        
        filteredLogs.forEach(log => {
            const logDate = new Date(log.timestamp);
            const dateStr = logDate.toISOString().split('T')[0];
            
            if (!activityByDay[dateStr]) {
                activityByDay[dateStr] = {
                    date: dateStr,
                    routeChanges: 0,
                    errors: 0,
                    totalTimeSpent: 0,
                    sessions: 0,
                    uniqueRoutes: new Set()
                };
            }
            
            if (log.level === 'ROUTE' && log.message === 'Route Change') {
                activityByDay[dateStr].routeChanges++;
                if (log.data?.url) {
                    activityByDay[dateStr].uniqueRoutes.add(log.data.url);
                }
            }
            
            if (log.level === 'ERROR') {
                activityByDay[dateStr].errors++;
            }
        });
        
        // Process for timeline format and convert Sets to counts
        const timeline = Object.values(activityByDay).map(day => ({
            date: day.date,
            routeChanges: day.routeChanges,
            errors: day.errors,
            totalTimeSpent: day.totalTimeSpent,
            sessions: day.sessions,
            uniqueRoutes: day.uniqueRoutes.size
        }));
        
        res.status(200).json({
            userId,
            timeframe: `${days} days`,
            timeline
        });
    } catch (error) {
        console.error(`Error getting activity timeline: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve activity timeline' });
    }
};

/**
 * Get user route interactions in human-readable format
 * This API provides detailed page/route interaction data with human-readable timestamps
 * and duration information
 */
export const getUserRouteActivity = (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId) || parseInt(req.query.userId as string) || 998;
        const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        
        const logs = LogAnalysisService.getUserLogs(userId);
        
        // Filter only route change logs
        const routeLogs = logs
            .filter(log => 
                log.level === 'ROUTE' && 
                log.message === 'Route Change' &&
                log.data?.url &&
                (!sessionId || log.data?.sessionId === sessionId)
            )
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Group by session
        const sessionMap: Record<number, any[]> = {};
        
        routeLogs.forEach((log, index) => {
            const currentSessionId = log.data?.sessionId || 0;
            if (!sessionMap[currentSessionId]) {
                sessionMap[currentSessionId] = [];
            }
            
            // Calculate human-readable timestamp
            const timestamp = new Date(log.timestamp);
            const formattedDate = timestamp.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            const formattedTime = timestamp.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            // Calculate duration spent on this route
            let durationMs = 0;
            let durationText = 'Unknown';
            
            if (index < routeLogs.length - 1 && 
                routeLogs[index + 1].data?.sessionId === currentSessionId) {
                const nextTimestamp = new Date(routeLogs[index + 1].timestamp);
                durationMs = nextTimestamp.getTime() - timestamp.getTime();
                
                // Format duration in human-readable format
                if (durationMs < 1000) {
                    durationText = `${durationMs}ms`;
                } else if (durationMs < 60000) {
                    durationText = `${Math.round(durationMs / 1000)}s`;
                } else if (durationMs < 3600000) {
                    const minutes = Math.floor(durationMs / 60000);
                    const seconds = Math.floor((durationMs % 60000) / 1000);
                    durationText = `${minutes}m ${seconds}s`;
                } else {
                    const hours = Math.floor(durationMs / 3600000);
                    const minutes = Math.floor((durationMs % 3600000) / 60000);
                    durationText = `${hours}h ${minutes}m`;
                }
            }
            
            // Create route interaction entry
            sessionMap[currentSessionId].push({
                route: log.data?.url,
                date: formattedDate,
                time: formattedTime,
                formattedTimestamp: `${formattedDate} at ${formattedTime}`,
                timeSpent: durationText,
                timeSpentMs: durationMs,
                sessionId: currentSessionId,
                requestFrom: log.data?.requestFrom || 'Unknown'
            });
        });
        
        // Convert sessions to array and apply limit
        let sessions = Object.entries(sessionMap).map(([sessionId, activities]) => ({
            sessionId: parseInt(sessionId),
            activityCount: activities.length,
            activities
        }));
        
        // Sort sessions by most recent first
        sessions.sort((a, b) => {
            const aTime = a.activities[0] ? new Date(a.activities[0].timestamp).getTime() : 0;
            const bTime = b.activities[0] ? new Date(b.activities[0].timestamp).getTime() : 0;
            return bTime - aTime;
        });
        
        // Apply limit if specified
        if (limit && limit > 0) {
            sessions = sessions.slice(0, limit);
        }
        
        // Calculate some summary statistics
        const totalActivities = sessions.reduce((sum, session) => sum + session.activityCount, 0);
        const totalTimeMsSpent = sessions.reduce((sum, session) => 
            sum + session.activities.reduce((total, activity) => total + (activity.timeSpentMs || 0), 0), 0);
            
        // Format total time spent
        let totalTimeSpent = 'Unknown';
        if (totalTimeMsSpent > 0) {
            if (totalTimeMsSpent < 1000) {
                totalTimeSpent = `${totalTimeMsSpent}ms`;
            } else if (totalTimeMsSpent < 60000) {
                totalTimeSpent = `${Math.round(totalTimeMsSpent / 1000)}s`;
            } else if (totalTimeMsSpent < 3600000) {
                const minutes = Math.floor(totalTimeMsSpent / 60000);
                const seconds = Math.floor((totalTimeMsSpent % 60000) / 1000);
                totalTimeSpent = `${minutes}m ${seconds}s`;
            } else {
                const hours = Math.floor(totalTimeMsSpent / 3600000);
                const minutes = Math.floor((totalTimeMsSpent % 3600000) / 60000);
                totalTimeSpent = `${hours}h ${minutes}m`;
            }
        }
        
        res.status(200).json({
            userId,
            summary: {
                sessionCount: sessions.length,
                totalActivities,
                totalTimeSpent
            },
            sessions
        });
    } catch (error) {
        console.error(`Error getting user route activity: ${error}`);
        res.status(500).json({ error: 'Failed to retrieve user route activity' });
    }
};