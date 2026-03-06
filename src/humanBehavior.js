function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function randomDelay(page, minMs = 1000, maxMs = 3000) {
  const ms = randomInt(minMs, maxMs);
  await page.waitForTimeout(ms);
}

async function randomMouseMovement(page, steps = 6) {
  const viewport = page.viewportSize() || { width: 1366, height: 768 };
  for (let i = 0; i < steps; i += 1) {
    const x = randomInt(0, viewport.width - 1);
    const y = randomInt(0, viewport.height - 1);
    await page.mouse.move(x, y, { steps: randomInt(3, 15) });
    await page.waitForTimeout(randomInt(120, 450));
  }
}

async function humanType(locator, text) {
  for (const ch of text) {
    await locator.type(ch, { delay: randomInt(40, 180) });
  }
}

async function randomScroll(page) {
  const scrollY = randomInt(120, 720);
  await page.mouse.wheel(0, scrollY);
  await page.waitForTimeout(randomInt(300, 1000));
  await page.mouse.wheel(0, -Math.floor(scrollY / 2));
  await page.waitForTimeout(randomInt(300, 900));
}

async function actHuman(page) {
  await randomDelay(page, 1000, 3000);
  await randomMouseMovement(page, randomInt(4, 8));
  await randomScroll(page);
}

module.exports = {
  randomDelay,
  randomMouseMovement,
  humanType,
  randomScroll,
  actHuman,
  randomInt
};
