// src/routes/LogRoutes.ts
import express from "express";
import {
  addLogs,
  getApplicationLogs,
  getPackageLogs,
} from "../controllers/LogController";
import { healthCheck } from "../controllers/HealthCheckController";
import { getUserRouteActivity } from "../controllers/LogQueryController";
import {
  getPageAnalytics,
  getRouteAnalyticsTable,
} from "../controllers/AnalyticsController";
import {
  trackPreviewVisit,
  getVisitsByBlog,
  getTopRedirectUrls,
  getPlatformBreakdown,
  getVisitorIps,
} from "../controllers/PreviewVisitController";

const router = express.Router();

// Basic log routes
router.post("/logger", addLogs);
router.get("/check", healthCheck);
router.get("/package-logs", getPackageLogs);
router.get("/application-logs", getApplicationLogs);

// Analytics route - only keeping the activity endpoint as requested
router.get("/analytics/activity", getUserRouteActivity);
router.get("/analytics/page", getPageAnalytics);
router.post("/analytics/page", getPageAnalytics);
router.post("/analytics/routes-table", getRouteAnalyticsTable);

// Preview visit routes
router.post("/preview-visit/track", trackPreviewVisit);
router.get("/preview-visit/by-blog", getVisitsByBlog);
router.get("/preview-visit/top-redirects", getTopRedirectUrls);
router.get("/preview-visit/platforms", getPlatformBreakdown);
router.get("/preview-visit/visitor-ips", getVisitorIps);
export default router;
