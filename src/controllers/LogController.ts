// src/controllers/LogController.ts
import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { LogService } from '../services/logger.service';

function parseLogFile(filePath) {
  try {
      const data = fs.readFileSync(filePath, 'utf8');
      
      // Example: Convert each line into a JSON object
      const logs = data.split('\n').filter(line => line).map((line, index) => ({
          id: index + 1,
          message: line
      }));

      return logs;
  } catch (err) {
      console.error('Error reading log file:', err);
      return [];
  }
}


export const getPackageLogs = (req: any, res: any) => {
    try{
        const userId = req.query.userId;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'mftsccs';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'mftsccslog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        const logs = parseLogFile(logFilePath);
        res.json(logs);
    }
    catch(ex){
        throw ex;
    }

 // res.status(200).json({ message: 'Get all logs' });
};

export const getApplicationLogs = (req: any, res: any) => {
    try{
        const userId = req.query.userId;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'application';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'applog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        const logs = parseLogFile(logFilePath);
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
     const userId = req.user?.userId ?? 998;
    // if (!userId) {
    //   res.status(400).json({ message: 'User not authenticated' })
    //   return
    // }

    // Check for logType and logData
    const { logType, logData } = req.body
    if (!logType || !logData) {
      res.status(400).json({ message: "Invalid or missing 'logs' data" })
      return
    }
    // Check for payload size
    const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB
    if (JSON.stringify(req.body).length > MAX_BODY_SIZE) {
      res.status(413).json({ message: 'Payload too large' })
      return
    }
    // console.log(userId, logData);
    LogService.addLog(userId, logType, logData)
    res.status(200).json({ message: 'Log entry added successfully' })
  } catch (error) {
    console.error(`Error adding log: ${error}`)
    res.status(500).json({ message: 'Internal Server Error' })
  }
}
