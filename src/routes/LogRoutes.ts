// src/routes/LogRoutes.ts
import express from 'express';
import { getApplicationLogs, getPackageLogs } from '../controllers/LogController';

const router = express.Router();

// Define routes
router.get('/package-logs', getPackageLogs);
router.get('/application-logs', getApplicationLogs);
export default router;