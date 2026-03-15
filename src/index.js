const fs = require("fs");
const cron = require("node-cron");
const { config, log, validateConfig } = require("./config");
const { hasSubmittedToday } = require("./leetcodeApi");
const {
  runReminderEscalation,
  markAutoSubmit,
  shouldRetryAutoSubmit,
  markCheckNow,
  readState,
  getReminderStage,
  getMinutesSinceMidnightIst
} = require("./reminderEngine");
const { notifyType } = require("./telegramNotifier");
const { getStorageStateFromEnv, tryPlaywrightSubmit } = require("./playwrightSubmit");

let inMemoryRunning = false;

function shouldRetryError(error) {
  if (error?.retryable === false) return false;
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("required") || msg.includes("invalid configuration")) {
    return false;
  }
  return true;
}

async function withRetry(fn, label, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      log("ERROR", `${label} failed (attempt ${attempt}/${retries})`, { error: error.message });
      const retryAllowed = shouldRetryError(error);
      if (attempt === retries || !retryAllowed) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`Unexpected retry loop completion for ${label}`);
}

function acquireFileLock(runId) {
  const lockPath = config.paths.LOCK_FILE_PATH;
  const now = Date.now();
  const staleMs = config.lockStaleMinutes * 60 * 1000;

  try {
    if (fs.existsSync(lockPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        const startedAtMs = existing?.startedAt ? new Date(existing.startedAt).getTime() : 0;
        if (now - startedAtMs > staleMs) {
          fs.unlinkSync(lockPath);
          log("WARN", "Removed stale lock file", { lockPath, existingRunId: existing?.runId });
        } else {
          return null;
        }
      } catch {
        fs.unlinkSync(lockPath);
      }
    }

    const fd = fs.openSync(lockPath, "wx");
    const payload = {
      pid: process.pid,
      runId,
      startedAt: new Date().toISOString()
    };
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
    fs.closeSync(fd);
    return payload;
  } catch {
    return null;
  }
}

function releaseFileLock() {
  try {
    if (fs.existsSync(config.paths.LOCK_FILE_PATH)) {
      fs.unlinkSync(config.paths.LOCK_FILE_PATH);
    }
  } catch (error) {
    log("WARN", "Failed to release lock", { error: error.message });
  }
}

async function notifySessionIssueOncePerDay(reason) {
  const stage = getReminderStage(getMinutesSinceMidnightIst());
  if (stage.stage !== "emergency") {
    log("INFO", "Suppressing session issue alert outside emergency window", { reason, stage: stage.stage });
    return;
  }

  const minutes = getMinutesSinceMidnightIst();
  const alertStart = 2 * 60;
  const alertEnd = alertStart + Math.max(1, config.checkIntervalMinutes);
  const inFirstEmergencySlot = minutes >= alertStart && minutes < alertEnd;
  if (!inFirstEmergencySlot) {
    log("INFO", "Suppressing duplicate session issue alert for today", { reason, minutes });
    return;
  }

  await notifyType(
    "SESSION_EXPIRED",
    "⚠️ LeetCode session expired.\n\nAutomation cannot continue.\nPlease regenerate session cookies."
  );
}

async function runGuardianCycle(runId) {
  markCheckNow(runId);
  log("INFO", "checking submissions", { runId });

  try {
    const submissionStatus = await withRetry(() => hasSubmittedToday(config.leetcode.username), "Submission check", 3);

    if (submissionStatus.submitted) {
      log("INFO", "submission detected", { runId, dayKey: submissionStatus.dayKey });
      return { ok: true, submitted: true };
    }

    log("WARN", "no submission today", { runId, dayKey: submissionStatus.dayKey });

    const reminder = await runReminderEscalation();
    if (!reminder.shouldAutoSubmit || !shouldRetryAutoSubmit()) {
      return { ok: true, submitted: false };
    }

    const sessionConfig = getStorageStateFromEnv();
    if (!sessionConfig.ok) {
      log("WARN", "session missing", { runId, reason: sessionConfig.reason });
      await notifySessionIssueOncePerDay(sessionConfig.reason);
      return { ok: true, submitted: false, authBlocked: true };
    }

    await notifyType("AUTO_SUBMIT_ACTIVATED", "🚨 Emergency Streak Saver Activated\nAttempting auto-submit to preserve streak.");

    const submitResult = await withRetry(() => tryPlaywrightSubmit(config.leetcode.username), "Playwright submit", 2);
    markAutoSubmit(runId);

    if (!submitResult.ok) {
      if (
        submitResult.reason === "session_missing" ||
        submitResult.reason === "session_invalid" ||
        submitResult.reason === "session_expired"
      ) {
        await notifySessionIssueOncePerDay(submitResult.reason);
        return { ok: true, submitted: false, authBlocked: true };
      }
      await notifyType("ERROR", `Auto-submit failed (${submitResult.reason}).`);
      return { ok: true, submitted: false, autoSubmitFailed: true };
    }

    const postSubmitStatus = await withRetry(() => hasSubmittedToday(config.leetcode.username), "Post submit check", 2);
    if (postSubmitStatus.submitted) {
      await notifyType("INFO", "Submission activity detected after auto-submit.");
      return { ok: true, submitted: true, autoSubmitted: true };
    }

    await notifyType("WARNING", "No submission detected after auto-submit attempt. Monitoring will continue.");
    return { ok: true, submitted: false, autoSubmitted: true };
  } catch (error) {
    log("ERROR", "Guardian cycle failed", { runId, error: error.message });
    await notifyType("ERROR", `Guardian cycle failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function runGuardedCycle() {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const lock = acquireFileLock(runId);

  if (!lock) {
    log("WARN", "Skipping cycle because another run appears active", { runId });
    return { ok: true, skipped: true };
  }

  try {
    if (inMemoryRunning) {
      log("WARN", "In-memory run already active; skipping");
      return { ok: true, skipped: true };
    }

    inMemoryRunning = true;
    return await runGuardianCycle(runId);
  } finally {
    inMemoryRunning = false;
    releaseFileLock();
  }
}

async function runSingleRunWindow() {
  const runStartedAt = Date.now();
  let lastResult = await runGuardedCycle();

  if (config.checkIntervalMinutes <= 5) {
    return lastResult;
  }

  const stage = getReminderStage(getMinutesSinceMidnightIst());
  const shouldDoFiveMinuteFollowUp = stage.stage === "every5" || stage.stage === "emergency";
  if (!shouldDoFiveMinuteFollowUp) {
    return lastResult;
  }

  const elapsedMs = Date.now() - runStartedAt;
  const remainingMs = config.checkIntervalMinutes * 60 * 1000 - elapsedMs;
  if (remainingMs < 5 * 60 * 1000) {
    return lastResult;
  }

  log("INFO", "High-urgency stage detected; running one 5-minute follow-up cycle", { stage: stage.stage });
  await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
  lastResult = await runGuardedCycle();
  return lastResult;
}

function start() {
  const validation = validateConfig();
  // TEST MODE OVERRIDE
  if (process.env.TEST_MODE === "true") {
    console.log("[TEST MODE] Reminder and emergency windows forced active");
  }

  for (const warning of validation.warnings) {
    log("WARN", warning);
  }

  if (validation.fatalErrors.length > 0) {
    for (const errorText of validation.fatalErrors) {
      log("ERROR", errorText);
    }
    process.exit(1);
  }

  const expression = `*/${Math.max(1, config.checkIntervalMinutes)} * * * *`;
  log("INFO", "Service started", {
    internalCron: config.useInternalCron,
    checkIntervalMinutes: config.checkIntervalMinutes,
    expression
  });

  if (config.useInternalCron) {
    cron.schedule(expression, async () => {
      await runGuardedCycle();
    });

    runGuardedCycle();
    return;
  }

  runSingleRunWindow()
    .then((result) => {
      const state = readState();
      log("INFO", "Single-run mode completed", { lastCheckAt: state.lastCheckAt, ok: result.ok, skipped: result.skipped });
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      log("ERROR", "Single-run mode fatal failure", { error: error.message });
      process.exit(1);
    });
}

start();
