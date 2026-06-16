// src/controllers/LogController.ts
import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { LogService } from '../services/logger.service';
import * as jwt from 'jsonwebtoken';

function parseLogFile(filePath, inpage:number, page: number ) {
  try {
    if(fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const currentPage = page || 1;  // current page (default 1)
      const limit = inpage || 10; // items per page (default 10)
      // Example: Convert each line into a JSON object

      const lines = data.split('\n').filter(line => line);
      // Calculate pagination indexes
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      // const logs = data.split('\n').filter(line => line).map((line, index) => ({
      //     id: index + 1,
      //     message: line
      // }));

      const paginatedLogs = lines.slice(startIndex, endIndex).map((line, index) => ({
        id: startIndex + index + 1, // global id
        message: line
      }));
      const totalPages = Math.ceil(lines.length / limit);
      return {
        logs: paginatedLogs,
        totalpages: totalPages
      }
    } else {
      console.warn('Log file not found at : ', filePath)
      return [];
    }
  } catch (err) {
      console.error('Error reading log file:', err);
      return [];
  }
}

function getRequestIp(req: any): string {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.ip ||
    "unknown"
  );
}

function parseUserAgent(userAgent?: string) {
  const ua = String(userAgent || "").toLowerCase();

  const deviceType = (() => {
    if (/bot|crawl|spider|slurp/.test(ua)) return "bot";
    if (/ipad|tablet/.test(ua)) return "tablet";
    if (/mobile|iphone|android.*mobile|windows phone/.test(ua)) return "mobile";
    return "desktop";
  })();

  const browser = (() => {
    if (/edg\//.test(ua)) return "Edge";
    if (/opr\//.test(ua) || /opera/.test(ua)) return "Opera";
    if (/chrome\//.test(ua) && !/edg\//.test(ua) && !/opr\//.test(ua)) return "Chrome";
    if (/firefox\//.test(ua)) return "Firefox";
    if (/safari\//.test(ua) && /version\//.test(ua)) return "Safari";
    if (/msie|trident/.test(ua)) return "Internet Explorer";
    return "Unknown";
  })();

  const os = (() => {
    if (/windows nt 10/.test(ua)) return "Windows 10";
    if (/windows nt 6\.3/.test(ua)) return "Windows 8.1";
    if (/windows nt 6\.2/.test(ua)) return "Windows 8";
    if (/windows nt 6\.1/.test(ua)) return "Windows 7";
    if (/android/.test(ua)) return "Android";
    if (/iphone|ipad|ipod/.test(ua)) return "iOS";
    if (/mac os x/.test(ua)) return "macOS";
    if (/linux/.test(ua)) return "Linux";
    return "Unknown";
  })();

  return { browser, os, deviceType };
}

function getRequestMetadata(req: any) {
  const ipAddress = getRequestIp(req);
  const userAgent = req.headers["user-agent"] || req.headers["User-Agent"] || "unknown";
  const acceptLanguage = req.headers["accept-language"] || undefined;
  const referrer = req.body?.referrer || req.headers["referer"] || req.headers["referrer"];
  const { browser, os, deviceType } = parseUserAgent(userAgent);

  return {
    ipAddress,
    userAgent,
    acceptLanguage,
    referrer,
    browser,
    os,
    deviceType,
  };
}


export const getPackageLogs = (req: any, res: any) => {
    try{
        const userId = req.query.userId || 998;
        const query = req.query;
        let inpage = query.inpage ?? 10;
        let page = query.page ?? 1;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'mftsccs';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'mftsccslog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        const logs = parseLogFile(logFilePath, inpage, page);
        res.json(logs);
    }
    catch(ex){
        throw ex;
    }

 // res.status(200).json({ message: 'Get all logs' });
};

export const getApplicationLogs = (req: any, res: any) => {
    try{
        const query = req.query;
        let inpage = query.inpage ?? 10;
        let page = query.page ?? 1;
        const userId = req.query.userId || 998;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'application';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'applog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        const logs = parseLogFile(logFilePath, inpage, page);
        res.json(logs);
    }
    catch(ex){
        throw ex;
    }

 // res.status(200).json({ message: 'Get all logs' });
};


export async function addLogs(req:any, res:any): Promise<void>{
  try {
    // Check if user is authenticated
    const authToken = req.header('authorization')
    const token:string | undefined = authToken?.trim()?.split(' ')?.pop()
    let userId = 998

    if(token){
      userId = await decodedTokenForUserId(token) ?? 998;
      //  const userId = req.user?.userId ?? 998;
    }
    // console.log(`Log of : ${userId}`);
    
    // Check for logType and logData
    const { logType, logData } = req.body
    if (!logType || !logData) {
      res.status(400).json({ message: "Invalid or missing 'logs' data" })
      return
    }

    const requestMetadata = getRequestMetadata(req);
    const logs = Array.isArray(logData) ? logData : [logData];
    const enrichedLogs = logs.map((log: any) => ({
      ...log,
      ipAddress: log.ipAddress || requestMetadata.ipAddress,
      userAgent: log.userAgent || requestMetadata.userAgent,
      acceptLanguage: log.acceptLanguage || requestMetadata.acceptLanguage,
      referrer: log.referrer || requestMetadata.referrer,
      browser: log.browser || requestMetadata.browser,
      os: log.os || requestMetadata.os,
      deviceType: log.deviceType || requestMetadata.deviceType,
      data: {
        ...(log.data || {}),
      },
    }))

    // Check for payload size
    const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB
    if (JSON.stringify(req.body).length > MAX_BODY_SIZE) {
      res.status(413).json({ message: 'Payload too large' })
      return
    }
    // console.log(userId, logData);
    await LogService.addLog(userId, logType, enrichedLogs)
    res.status(200).json({ message: 'Log entry added successfully' })
  } catch (error) {
    console.error(`Error adding log: ${error}`)
    res.status(500).json({ message: 'Internal Server Error' })
  }
}


// Helper Function to decode the token and extract the userId
function decodedTokenForUserId(token:string) {

  try {
    if(!token) return null;
    const parts = token.split('.');
    if(parts.length !==3) {
      return null;
    }
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    if(decodedToken){
      return Number(decodedToken?.unique_name);
    } else {
      return null;
    }
  } catch (error) {
    // console.error("Token validation failed : ", error);
    return null
  }

}
