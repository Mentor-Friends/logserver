import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

export class LogService {
  private static mftsccs: string = 'mftsccs'
  private static app: string = 'app'

  // Max file size for log files (default 10MB)
  private static readonly MAX_FILE_SIZE: number = parseInt(
    process.env.LOG_MAX_FILE_SIZE || '10485760',
    10,
  )

  // Root directories for logs
  //private static readonly baseLogDir = path.join(__dirname, 'logs')
  private static readonly baseLogDir = process.env.LOGPATH;
  private static readonly mftsccsLogDir = path.join(
    LogService.baseLogDir,
    'mftsccs',
  )
  private static readonly appLogDir = path.join(
    LogService.baseLogDir,
    'application',
  )

  // Ensure the root log directories exist
  private static ensureLogDirectoriesExist() {
    if (!fs.existsSync(this.baseLogDir)) {
      fs.mkdirSync(this.baseLogDir)
    }
    if (!fs.existsSync(this.mftsccsLogDir)) {
      fs.mkdirSync(this.mftsccsLogDir)
    }
    if (!fs.existsSync(this.appLogDir)) {
      fs.mkdirSync(this.appLogDir)
    }
  }

  // Add a log entry for the specified user
  public static addLog(userId: number, logType: string, logEntry: []): void {
    try {
      // Add logs to the appropriate user-specific log folder
      if (logType === this.mftsccs) {
        this.saveLogToFile(userId, this.mftsccs, logEntry)
      } else if (logType === this.app) {
        this.saveLogToFile(userId, this.app, logEntry)
      }
    } catch (error) {
      console.error(`Error adding ${logType} log for user ${userId}:`, error)
    }
  }

  // Save logs to user-specific file within their individual folder
  private static saveLogToFile(
    userId: number,
    logType: string,
    logEntry: any,
  ): void {
    // Ensure the log directories exist before proceeding
    this.ensureLogDirectoriesExist()

    // Create a user-specific directory if it doesn't exist
    const userLogDir = path.join(
      logType === this.mftsccs ? this.mftsccsLogDir : this.appLogDir,
      `user_${userId}`,
    )
    //console.log("this is the log file location", this.mftsccsLogDir);
    if (!fs.existsSync(userLogDir)) {
      fs.mkdirSync(userLogDir)
    }

    // Determine the correct file name and path
    const fileName = `${logType}log_user_${userId}.log`
    const filePath = path.join(userLogDir, fileName)
    console.log("this is the file", filePath);
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
      //fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2))
      this.checkFileSizeAndZip(filePath)
    } catch (error) {
      console.error(`Error writing to ${filePath}:`, error)
    }
  }

  // Check file size and compress if it exceeds MAX_FILE_SIZE
  private static checkFileSizeAndZip(filePath: string): void {
    try{
      const stats = fs.statSync(filePath)
      const fileSizeInByte = stats.size
  
      if (fileSizeInByte > this.MAX_FILE_SIZE) {
        // const zipFileName = `${filePath}.${Date.now()}.gz`;
  
        // Find the current count of existing gz files for this log
        const dir = path.dirname(filePath)
        const baseName = path.basename(filePath, '.log')
        const gzFiles = fs
          .readdirSync(dir)
          .filter(file => file.startsWith(baseName) && file.endsWith('.gz'))
  
        // Determine the next count based on existing files
        const nextCount = gzFiles.length + 1
  
        // Create a zipped file with the next count
        const zipFileName = `${filePath}.${nextCount}.gz`
  
        // Create a zipped copy of the file
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        const gzippedContent = zlib.gzipSync(fileContent)
        fs.writeFileSync(zipFileName, gzippedContent)
  
        // Clear the original file
        fs.writeFileSync(filePath, JSON.stringify([]))
      }
    }
    catch(ex){
      console.error("The file does not exist till now");
    }
   
  }

  // Load the existing log file for a given user
  private static loadLogFile(userId: number, logType: string): any[] {
    const userLogDir = path.join(
      logType === this.mftsccs ? this.mftsccsLogDir : this.appLogDir,
      `user_${userId}`,
    )
    const fileName = `${logType}log_user_${userId}.json`
    const filePath = path.join(userLogDir, fileName)

    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([]))
      }
      const fileData = fs.readFileSync(filePath, 'utf-8')
      return fileData.trim() ? JSON.parse(fileData) : []
    } catch (error) {
      console.warn(
        `Error reading log file for user ${userId}. Initializing empty data:`,
        error,
      )
      return []
    }
  }
}
