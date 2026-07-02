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
  getAllArticlesAnalytics,
} from "../controllers/PreviewVisitController";
import verifyRequestToken from "../middlewares/verifyRequestToken";

const router = express.Router();

// Basic log routes
router.post("/logger", addLogs);
router.get("/check", healthCheck);
router.get("/package-logs", getPackageLogs);
router.get("/application-logs", getApplicationLogs);

// Route / page analytics
router.get("/analytics/activity", getUserRouteActivity);
router.get("/analytics/page", getPageAnalytics);
router.post("/analytics/page", getPageAnalytics);
router.post("/analytics/routes-table", getRouteAnalyticsTable);

// Preview-visit routes
router.post(
  "/preview-visit/track",
  express.text({ type: ["text/plain", "text/*"] }),
  trackPreviewVisit,
);
router.get("/preview-visit/track", trackPreviewVisit);

//comprehensive analytics across ALL articles
router.get("/preview-visit/articles", verifyRequestToken, getAllArticlesAnalytics);

// Per-blog analytics (enhanced – now returns full breakdown)
router.get("/preview-visit/by-blog", verifyRequestToken, getVisitsByBlog);

// Existing helpers
router.get("/preview-visit/top-redirects", verifyRequestToken, getTopRedirectUrls);
router.get("/preview-visit/platforms", verifyRequestToken, getPlatformBreakdown);
router.get("/preview-visit/visitor-ips", verifyRequestToken, getVisitorIps);

export default router;
