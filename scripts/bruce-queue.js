const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PAUSE_SECONDS = parseInt(process.env.BRUCE_PAUSE || '60');
const OUTPUT_DIR = path.join(require('os').homedir(), '.openclaw/workspace/cashclaw/dealmatcher');
const LOG_FILE = path.join(__dirname, '..', 'data', 'bruce-queue.log');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function runBruceTask(task, sessionId) {
  return new Promise((resolve) => {
    log('STARTING: ' + task.name);
    log('PROMPT: ' + task.prompt);

    const timeout = parseInt(process.env.BRUCE_TIMEOUT || '300') * 1000; // 5 min default
    const cmd = `/opt/homebrew/bin/openclaw agent --local -m "${task.prompt.replace(/"/g, '\\"')}" --session-id ${sessionId}`;

    const child = exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          log('TIMEOUT: ' + task.name + ' (exceeded ' + (timeout/1000) + 's)');
        } else {
          log('ERROR: ' + task.name + ' — ' + error.message);
        }
        resolve(false);
        return;
      }
      log('DONE: ' + task.name);
      if (stdout.trim()) log('OUTPUT: ' + stdout.trim().slice(0, 500));
      resolve(true);
    });
  });
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function runQueue(tasks) {
  log('========================================');
  log('BRUCE QUEUE STARTED — ' + tasks.length + ' tasks');
  log('Pause between tasks: ' + PAUSE_SECONDS + 's');
  log('========================================');

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const sessionId = 'queue-' + Date.now() + '-' + i;

    const success = await runBruceTask(task, sessionId);
    if (success) completed++;
    else failed++;

    // Pause between tasks (skip after last one)
    if (i < tasks.length - 1) {
      log('PAUSING ' + PAUSE_SECONDS + 's before next task...');
      await sleep(PAUSE_SECONDS);
    }
  }

  log('========================================');
  log('QUEUE COMPLETE: ' + completed + ' done, ' + failed + ' failed, ' + tasks.length + ' total');
  log('========================================');
}

// === TASK DEFINITIONS ===
// Edit these tasks or load from a JSON file

const DEFAULT_TASKS = [
  {
    name: 'Gas Stations from Crexi',
    prompt: 'Go to Crexi.com and find 5 gas stations for sale over $5M. For each save: name, city, state, asking_price, revenue (0 if not shown), industry (gas station), url. Save as CSV with those headers to ' + OUTPUT_DIR + '/gas-stations-new.csv. Reply only: done.'
  },
  {
    name: 'Multifamily from Crexi',
    prompt: 'Go to Crexi.com and find 5 multifamily apartment buildings for sale over $5M. For each save: name, city, state, asking_price, revenue (0 if not shown), industry (multifamily), url. Save as CSV with those headers to ' + OUTPUT_DIR + '/multifamily-new.csv. Reply only: done.'
  },
  {
    name: 'Retail from Crexi',
    prompt: 'Go to Crexi.com and find 5 retail properties or shopping centers for sale over $5M. For each save: name, city, state, asking_price, revenue (0 if not shown), industry (retail), url. Save as CSV with those headers to ' + OUTPUT_DIR + '/retail-new.csv. Reply only: done.'
  }
];

// Load custom tasks from JSON if provided as argument
let tasks = DEFAULT_TASKS;
const customFile = process.argv[2];
if (customFile && fs.existsSync(customFile)) {
  try {
    tasks = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    log('Loaded ' + tasks.length + ' custom tasks from ' + customFile);
  } catch (e) {
    log('Failed to load custom tasks, using defaults: ' + e.message);
  }
}

// Run it
runQueue(tasks).then(() => {
  log('Bruce queue process exited.');
  process.exit(0);
});
