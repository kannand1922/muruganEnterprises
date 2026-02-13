const puppeteer = require("puppeteer");

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new"
    });
    console.log("✅ Browser launched successfully");
    await browser.close();
  } catch (err) {
    console.error("❌ Launch failed:", err);
  }
})();
