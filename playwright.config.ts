import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    timeout: 30000,
    use: {
        ...devices["Desktop Chrome"],
        browserName:
            process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium",
        channel: process.env.BROWSER_CHANNEL || undefined,
        baseURL: process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173",
        viewport: { width: 1440, height: 960 },
        screenshot: "only-on-failure",
    },
    webServer: process.env.BROWSER_BASE_URL ? undefined : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
    },
});
