// src/routes/LogRoutes.ts
import express from 'express';
import { addLogs, getApplicationLogs, getPackageLogs } from '../controllers/LogController';
import { healthCheck } from '../controllers/HealthCheckController';
import { 
    getUserRouteAnalytics, 
    getUserSessionHistory, 
    getRouteFlowAnalysis, 
    getUserErrorLogs,
    getUserAnalyticsDashboard,
    getUserActivityTimeline,
    getUserRouteActivity
} from '../controllers/LogQueryController';

const router = express.Router();

// Basic log routes
router.post('/logger', addLogs);
router.get('/check', healthCheck);
router.get('/package-logs', getPackageLogs);
router.get('/application-logs', getApplicationLogs);

// Advanced analytics routes
router.get('/analytics/user/:userId/routes', getUserRouteAnalytics);
router.get('/analytics/user/:userId/sessions', getUserSessionHistory);
router.get('/analytics/user/:userId/flow', getRouteFlowAnalysis);
router.get('/analytics/user/:userId/errors', getUserErrorLogs);
router.get('/analytics/user/:userId/dashboard', getUserAnalyticsDashboard);
router.get('/analytics/user/:userId/timeline', getUserActivityTimeline);
router.get('/analytics/user/:userId/activity', getUserRouteActivity);

// Alternative routes with query parameters
router.get('/analytics/routes', getUserRouteAnalytics);
router.get('/analytics/sessions', getUserSessionHistory);
router.get('/analytics/flow', getRouteFlowAnalysis);
router.get('/analytics/errors', getUserErrorLogs);
router.get('/analytics/dashboard', getUserAnalyticsDashboard);
router.get('/analytics/timeline', getUserActivityTimeline);
router.get('/analytics/activity', getUserRouteActivity);

export default router;
