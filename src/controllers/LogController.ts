// src/controllers/LogController.ts
import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

export const getPackageLogs = (req: Request, res: Response) => {
    try{
        const userId = req.query.userId;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'mftsccs';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'mftsccslog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        fs.readFile(logFilePath, 'utf-8', (err, data) => {
            if (err) {
              return res.status(500).json({ error: 'Failed to read log file' });
            }
        
            // Send the log file content as a response
            res.send(`<pre>${data}</pre>`); // Wrap in <pre> tag to preserve formatting
          });
    }
    catch(ex){
        throw ex;
    }

 // res.status(200).json({ message: 'Get all logs' });
};

export const getApplicationLogs = (req: Request, res: Response) => {
    try{
        const userId = req.query.userId;
        let logLocationFolder = process.env.LOGPATH;
        let logType = 'application';
        let userFolder = 'user_' + userId;
        const logFilePath = path.join(logLocationFolder,logType, userFolder, 'applog_user_' + `${userId}` +'.log'); 
        console.log("this is the log path", logFilePath);
        fs.readFile(logFilePath, 'utf-8', (err, data) => {
            if (err) {
              return res.status(500).json({ error: 'Failed to read log file' });
            }
        
            // Send the log file content as a response
            res.send(`<pre>${data}</pre>`); // Wrap in <pre> tag to preserve formatting
          });
    }
    catch(ex){
        throw ex;
    }

 // res.status(200).json({ message: 'Get all logs' });
};