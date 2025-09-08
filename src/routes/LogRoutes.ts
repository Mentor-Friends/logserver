// src/routes/LogRoutes.ts
import express from 'express';
import { addLogs, getApplicationLogs, getPackageLogs } from '../controllers/LogController';
import { healthCheck } from '../controllers/HealthCheckController';
import { getUserRouteActivity } from '../controllers/LogQueryController';
import { getRouteAnalyticsTable } from '../controllers/AnalyticsController';

const router = express.Router();

// Basic log routes
router.post('/logger', addLogs);
router.get('/check', healthCheck);
router.get('/package-logs', getPackageLogs);
router.get('/application-logs', getApplicationLogs);

// Analytics route - only keeping the activity endpoint as requested
router.get('/analytics/activity', getUserRouteActivity);
router.post('/analytics/routes-table', getRouteAnalyticsTable);

export default router;
