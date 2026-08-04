import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ETL_DIR = path.join(__dirname, "..", "..", "ETL");
const INPUT_DIR = path.join(ETL_DIR, "input");
const PROCESSED_DIR = path.join(ETL_DIR, "processed");
const OUTPUT_DIR = path.join(ETL_DIR, "output");
const CONFIG_FILE = path.join(ETL_DIR, "config", "mapping.yaml");

interface ETLFileUpload {
  filename: string;
  buffer: Buffer;
  kind: "expense" | "receipt" | "vendor";
}

interface ETLProcessResult {
  success: boolean;
  sessionId: string;
  message: string;
  inputFiles: string[];
  outputFiles?: string[];
  error?: string;
  logs: string[];
}

/**
 * Initialize ETL directories if they don't exist
 */
export async function initializeETLDirs(): Promise<void> {
  try {
    await fs.mkdir(INPUT_DIR, { recursive: true });
    await fs.mkdir(PROCESSED_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to initialize ETL directories:", error);
    throw error;
  }
}

/**
 * Save uploaded files to input directory
 */
export async function saveUploadedFiles(
  files: ETLFileUpload[]
): Promise<{ inputFiles: string[]; sessionId: string }> {
  const sessionId = randomUUID();
  const inputFiles: string[] = [];

  try {
    await initializeETLDirs();

    for (const file of files) {
      // Create unique filename with session ID and timestamp
      const timestamp = Date.now();
      const ext = path.extname(file.filename);
      const baseName = path.basename(file.filename, ext);
      const uniqueFilename = `${baseName}_${file.kind}_${timestamp}${ext}`;
      const filePath = path.join(INPUT_DIR, uniqueFilename);

      await fs.writeFile(filePath, file.buffer);
      inputFiles.push(uniqueFilename);
    }

    return { inputFiles, sessionId };
  } catch (error) {
    console.error("Failed to save uploaded files:", error);
    throw error;
  }
}

/**
 * Run the Python ETL transformation script
 */
export async function runETLTransformation(
  inputFiles: string[],
  sessionId: string
): Promise<ETLProcessResult> {
  const logs: string[] = [];

  return new Promise((resolve) => {
    try {
      // Check if Python script exists
      const scriptPath = path.join(ETL_DIR, "transform.py");

      const python = spawn("python3", [scriptPath], {
        cwd: ETL_DIR,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
      });

      let stdout = "";
      let stderr = "";

      python.stdout?.on("data", (data) => {
        const line = data.toString().trim();
        logs.push(`[STDOUT] ${line}`);
        stdout += line + "\n";
      });

      python.stderr?.on("data", (data) => {
        const line = data.toString().trim();
        logs.push(`[STDERR] ${line}`);
        stderr += line + "\n";
      });

      python.on("close", async (code) => {
        try {
          if (code === 0) {
            // Move processed files
            const processedFiles = await moveProcessedFiles(inputFiles);

            // Get output files
            const outputFiles = await getOutputFiles();

            resolve({
              success: true,
              sessionId,
              message: "ETL transformation completed successfully",
              inputFiles,
              outputFiles,
              logs,
            });
          } else {
            resolve({
              success: false,
              sessionId,
              message: `ETL transformation failed with exit code ${code}`,
              inputFiles,
              error: stderr || stdout,
              logs,
            });
          }
        } catch (error) {
          resolve({
            success: false,
            sessionId,
            message: "Error processing ETL results",
            inputFiles,
            error: String(error),
            logs,
          });
        }
      });

      python.on("error", (err) => {
        resolve({
          success: false,
          sessionId,
          message: "Failed to spawn Python process",
          inputFiles,
          error: String(err),
          logs: [...logs, `[ERROR] ${String(err)}`],
        });
      });
    } catch (error) {
      resolve({
        success: false,
        sessionId,
        message: "Error initiating ETL transformation",
        inputFiles,
        error: String(error),
        logs: [...logs, `[ERROR] ${String(error)}`],
      });
    }
  });
}

/**
 * Move processed input files to processed directory
 */
async function moveProcessedFiles(inputFiles: string[]): Promise<string[]> {
  const movedFiles: string[] = [];

  try {
    for (const file of inputFiles) {
      const sourcePath = path.join(INPUT_DIR, file);
      const destPath = path.join(PROCESSED_DIR, file);

      try {
        // transform.py already moves files to processed/ with timestamped names.
        // If the source no longer exists, treat this as a successful no-op.
        const exists = await fs
          .access(sourcePath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          movedFiles.push(file);
          continue;
        }

        await fs.rename(sourcePath, destPath);
        movedFiles.push(file);
      } catch (error) {
        // File might not exist or already moved - log and continue
        console.warn(`Could not move ${file}: ${error}`);
      }
    }
  } catch (error) {
    console.error("Error moving processed files:", error);
  }

  return movedFiles;
}

/**
 * Get list of output files generated
 */
export async function getOutputFiles(): Promise<string[]> {
  try {
    await initializeETLDirs();
    const files = await fs.readdir(OUTPUT_DIR);
    return files.filter((f) => f.endsWith(".csv") || f.endsWith(".xlsx"));
  } catch (error) {
    console.error("Error reading output files:", error);
    return [];
  }
}

/**
 * Read the transformed transactions CSV
 */
export async function readTransformedTransactions(): Promise<Buffer> {
  try {
    const csvPath = path.join(OUTPUT_DIR, "transactions.csv");
    return await fs.readFile(csvPath);
  } catch (error) {
    console.error("Error reading transformed transactions:", error);
    throw error;
  }
}

/**
 * Cleanup old files (optional - for maintenance)
 */
export async function cleanupOldFiles(daysOld: number = 7): Promise<void> {
  try {
    const now = Date.now();
    const cutoffTime = now - daysOld * 24 * 60 * 60 * 1000;

    const dirs = [INPUT_DIR, PROCESSED_DIR];

    for (const dir of dirs) {
      const files = await fs.readdir(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          console.log(`Cleaned up old file: ${file}`);
        }
      }
    }
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}
