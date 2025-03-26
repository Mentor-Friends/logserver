// src/routes/LogRoutes.ts
import express from 'express';
import { addLogs, getApplicationLogs, getPackageLogs } from '../controllers/LogController';

const router = express.Router();

// Define routes
router.post('/logger', addLogs)
// router.get('/package-logs', getPackageLogs);
// router.get('/application-logs', getApplicationLogs);
router.get('/schema-query', )

export default router;
