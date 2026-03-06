const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false, // important
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox"
    ]
  });

  const context = await browser.newContext();

  const page = await context.newPage();

  await page.goto("https://leetcode.com/accounts/login/");

  console.log("Login manually in the opened browser...");
  console.log("After login press ENTER in the terminal.");

  process.stdin.once("data", async () => {
    await context.storageState({ path: "session.json" });

    console.log("Session saved to session.json");

    await browser.close();
    process.exit();
  });
})();