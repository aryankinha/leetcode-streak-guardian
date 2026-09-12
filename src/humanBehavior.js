const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Initialize stealth plugin
const stealth = StealthPlugin();
chromium.use(stealth);

/**
 * Wait for a random duration between min and max milliseconds.
 */
async function randomDelay(min = 500, max = 2000) {
  const delay = Math.floor(Math.random() * (max - min + 1) + min);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Natural bezier curve mouse movement simulation.
 */
async function simulateMouseMovement(page, startX, startY, targetX, targetY, steps = 25) {
  try {
    // Generate a cubic bezier control point for curved mouse motion
    const cp1X = startX + (targetX - startX) * 0.25 + (Math.random() - 0.5) * 100;
    const cp1Y = startY + (targetY - startY) * 0.25 + (Math.random() - 0.5) * 100;
    const cp2X = startX + (targetX - startX) * 0.75 + (Math.random() - 0.5) * 100;
    const cp2Y = startY + (targetY - startY) * 0.75 + (Math.random() - 0.5) * 100;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Cubic bezier formula
      const cx =
        Math.pow(1 - t, 3) * startX +
        3 * Math.pow(1 - t, 2) * t * cp1X +
        3 * (1 - t) * Math.pow(t, 2) * cp2X +
        Math.pow(t, 3) * targetX;
      const cy =
        Math.pow(1 - t, 3) * startY +
        3 * Math.pow(1 - t, 2) * t * cp1Y +
        3 * (1 - t) * Math.pow(t, 2) * cp2Y +
        Math.pow(t, 3) * targetY;

      await page.mouse.move(cx, cy);
      // Small jitter between steps
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8) + 5));
    }
  } catch (err) {
    // Non-fatal if page was closed or navigating
  }
}

/**
 * Smooth, gradual human scrolling simulation.
 */
async function simulateScroll(page, totalDistance, chunks = 8) {
  try {
    const stepDistance = totalDistance / chunks;
    for (let i = 0; i < chunks; i++) {
      const variation = (Math.random() - 0.5) * (stepDistance * 0.3);
      const scrollStep = Math.round(stepDistance + variation);
      await page.evaluate((delta) => window.scrollBy({ top: delta, behavior: 'smooth' }), scrollStep);
      await randomDelay(80, 250);
    }
  } catch (err) {
    // Non-fatal
  }
}

/**
 * Performs simulated human interaction on a page:
 * natural mouse paths, reading pauses, and gradual scrolls.
 */
async function simulateHuman(page) {
  try {
    const viewportSize = page.viewportSize() || { width: 1280, height: 800 };
    let currentX = Math.floor(viewportSize.width * 0.3);
    let currentY = Math.floor(viewportSize.height * 0.3);

    // Initial mouse placement
    await page.mouse.move(currentX, currentY);

    // 2-3 natural curved movements
    const moves = Math.floor(Math.random() * 2) + 2;
    for (let i = 0; i < moves; i++) {
      const targetX = Math.floor(Math.random() * (viewportSize.width * 0.8) + (viewportSize.width * 0.1));
      const targetY = Math.floor(Math.random() * (viewportSize.height * 0.7) + (viewportSize.height * 0.1));
      await simulateMouseMovement(page, currentX, currentY, targetX, targetY);
      currentX = targetX;
      currentY = targetY;
      await randomDelay(300, 900);
    }

    // Gradual scroll down (reading behavior)
    await simulateScroll(page, Math.floor(Math.random() * 250) + 150);
    await randomDelay(800, 2000);

    // Small scroll back up
    await simulateScroll(page, -(Math.floor(Math.random() * 100) + 50));
    await randomDelay(400, 1200);
  } catch (err) {
    console.warn('[WARN] simulateHuman caught non-fatal error:', err.message);
  }
}

/**
 * Human dwell time simulation:
 * Stays on the problem page for 35 to 65 seconds (customizable),
 * simulating a human reading the problem with subtle scrolls and movements.
 */
async function humanDwellTime(page, minSeconds = 35, maxSeconds = 65) {
  const totalDwellMs = Math.floor(Math.random() * ((maxSeconds - minSeconds) * 1000 + 1)) + minSeconds * 1000;
  console.log(`[INFO] Simulating human reading & dwell time (${(totalDwellMs / 1000).toFixed(1)}s)...`);

  const startTime = Date.now();
  while (Date.now() - startTime < totalDwellMs) {
    if (page.isClosed()) break;
    const remaining = totalDwellMs - (Date.now() - startTime);
    if (remaining <= 0) break;

    // Run a human simulation slice
    await simulateHuman(page);

    // Dwell pause between actions (3-7 seconds)
    const pause = Math.min(remaining, Math.floor(Math.random() * 4000) + 3000);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
  console.log('[INFO] Human dwell time simulation finished.');
}

/**
 * Human-like slow keyboard typing.
 */
async function typeSlowly(page, selector, text) {
  await page.focus(selector);
  for (const char of text) {
    await page.keyboard.type(char);
    await randomDelay(40, 160);
  }
}

module.exports = {
  randomDelay,
  simulateMouseMovement,
  simulateScroll,
  simulateHuman,
  humanDwellTime,
  typeSlowly,
  chromium,
};
