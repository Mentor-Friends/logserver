import fs from 'fs';
import path from 'path';

export class AnomalyService {

    private static baseDir: string = './anomalyData';
    private static mftsccs: string = 'mftsccs';
    private static app: string = 'app';

    private static ensureLogDirectoryExist(){
        if(!fs.existsSync(this.baseDir)){
            fs.mkdirSync(this.baseDir);
        }
    }

    public static addLogToAnomaly(userId:number, logType:string, logEntry:[]){
        try {
            // Add userId to each log entry before saving : if logEntry already have logEntry it overwrites
            const enhancedLogEntry = logEntry.map((log:any) => ({
                userId: userId,
                ...log
            }))

            // Add logs to the appropriate user-specific log folder
            if (logType === this.mftsccs) {
              this.saveLogToFile(this.mftsccs, enhancedLogEntry);
              // Send logs for anomaly detection
              
            } else if (logType === this.app) {
              this.saveLogToFile(this.app, enhancedLogEntry);
            }
          } catch (error) {
            console.error(`Error adding ${logType} log for user ${userId} for Anomaly :`, error)
          }
    }

      // Save logs to user-specific file within their individual folder
      private static saveLogToFile(
        logType: string,
        logEntry: any,
      ): void {
        // Ensure the log directories exist before proceeding
        this.ensureLogDirectoryExist()
    
        // file name and path
        const fileName = `${logType}.log`
        const filePath = path.join(this.baseDir, fileName)
        // console.log("this is the file", filePath);
        if (!logEntry) {
          return
        }
        let logs: string = ''
        logEntry.forEach(log => {
          logs += JSON.stringify(log) + '\n'
        })
        try {
          fs.appendFile(filePath, logs, function (err) {
            if (err) {
              throw err
            } 
          })
        } catch (error) {
          console.error(`Error writing to ${filePath}:`, error)
        }
      }
}