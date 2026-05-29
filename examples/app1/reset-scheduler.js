import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = "pnpm db:reset";

const options = { cwd: __dirname };

const intervalMinutesStr = process.env.DB_RESET_INTERVAL_MINUTES || "15";
let intervalMinutes = Number.parseInt(intervalMinutesStr, 10);
if (Number.isNaN(intervalMinutes) || intervalMinutes <= 0) {
  console.warn(
    `Invalid DB_RESET_INTERVAL_MINUTES value "${intervalMinutesStr}". Defaulting to 15 minutes.`,
  );
  intervalMinutes = 15;
}

const cronSchedule = `*/${intervalMinutes} * * * *`;

console.log(
  `Scheduler started. Will run '${command}' every ${intervalMinutes} minutes (${cronSchedule}).`,
);
console.log(`Working directory for command: ${options.cwd}`);

cron.schedule(cronSchedule, () => {
  console.log(`[${new Date().toISOString()}] Running '${command}'...`);

  exec(command, options, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `[${new Date().toISOString()}] Error executing command: ${
          error.message
        }`,
      );
      console.error(`stderr: ${stderr}`);
      return;
    }
    if (stderr) {
      console.info(`[${new Date().toISOString()}] Command stderr:\n${stderr}`);
    }
    console.log(`[${new Date().toISOString()}] Command stdout:\n${stdout}`);
    console.log(
      `[${new Date().toISOString()}] '${command}' finished successfully.`,
    );
  });
});

process.on("SIGINT", () => {
  console.log("Scheduler stopped.");
  process.exit();
});
