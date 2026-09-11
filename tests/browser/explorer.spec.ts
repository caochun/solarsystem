import { test, expect } from "@playwright/test";

test("All eight planets load their own resources and distances; Saturn rings toggle and outer-planet links reload", async ({
    page,
}) => {
    const errors: string[] = [];
    const textures = new Set<string>();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    page.on("response", (response) => {
        if (
            response.url().includes("/textures/") &&
            response.ok() &&
            response.headers()["content-type"]?.startsWith("image/")
        )
            textures.add(new URL(response.url()).pathname.split("/").pop()!);
        if (response.status() >= 400)
            errors.push(`${response.status()}: ${response.url()}`);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=mercury&time=1789041600000&scale=illustrated");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await expect(page.locator("[data-body]")).toHaveCount(46);
    const distances = new Set<string>();
    for (const [id, name] of Object.entries({
        mercury: "水星",
        venus: "金星",
        earth: "地球",
        mars: "火星",
        jupiter: "木星",
        saturn: "土星",
        uranus: "天王星",
        neptune: "海王星",
    })) {
        await page.locator(`[data-body="${id}"]`).click();
        await expect(page.locator("#body-name")).toHaveText(name);
        await expect(page.locator("#distance-title")).toHaveText("距太阳");
        await expect(page.locator("#viewport")).toHaveAttribute(
            "data-camera-state",
            "idle",
        );
        distances.add((await page.locator("#distance-value").textContent())!);
        await expect.poll(() => textures.has(`${id}.jpg`)).toBe(true);
    }
    expect(distances.size).toBe(8);
    await expect(page.locator("#secondary-value")).toContainText("小时");
    await page.locator('[data-scale="physical"]').click();
    await page.reload();
    await expect(page.locator("#body-name")).toHaveText("海王星");
    await expect(page.locator('[data-scale="physical"]')).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await page.locator("#overview").click();
    await expect(page.locator("#view-title")).toHaveText("太阳系总览");
    await page.screenshot({ path: "test-results/outer-system-physical.png" });
    await page.locator('[data-body="saturn"]').click();
    await page.locator('[data-scale="illustrated"]').click();
    await expect.poll(() => textures.has("saturn-rings.png")).toBe(true);
    await page.screenshot({ path: "test-results/saturn-desktop.png" });
    const withRings = await page.locator("#viewport canvas").screenshot();
    await page.locator("#rings").uncheck();
    const withoutRings = await page.locator("#viewport canvas").screenshot();
    expect(withRings.equals(withoutRings)).toBe(false);
    await page.locator("#rings").check();
    await page.locator("#viewport canvas").focus();
    await page.keyboard.press("8");
    await expect(page.locator("#body-name")).toHaveText("海王星");
    expect(errors).toEqual([]);
});

test("WebGL renders and body selection, scale, layers and guide respond without runtime errors", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/?body=earth&time=1789041600000&scale=illustrated");
    await expect(page.locator("#viewport canvas")).toBeVisible();
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await expect(page.locator("#body-name")).toHaveText("地球");
    await page.screenshot({ path: "test-results/earth-desktop.png" });
    await page.locator('[data-body="moon"]').click();
    await expect(page.locator("#body-name")).toHaveText("月球");
    await expect(page.locator("#distance-value")).toHaveText(/3\d\d,\d\d\d km/);
    await page.locator('[data-scale="physical"]').click();
    await expect(page.locator("#scale-caption")).toHaveText(
        "天体半径与距离使用统一比例尺",
    );
    await page.locator("#axis").check();
    await page.locator("#orbits").uncheck();
    await expect(page.locator("#orbits")).not.toBeChecked();
    await page.locator("#labels").uncheck();
    await expect(page.locator(".body-label:visible")).toHaveCount(0);
    await page.locator("#guide").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#guide-dialog")).not.toBeVisible();
    await page.locator('[data-body="sun"]').click();
    await expect(page.locator("#body-name")).toHaveText("太阳");
    await page.locator('[data-scale="illustrated"]').click();
    await expect(page.locator("#viewport")).toHaveAttribute(
        "data-camera-state",
        "idle",
    );
    await page.screenshot({ path: "test-results/sun-desktop.png" });
    await page.locator("#overview").click();
    await expect(page.locator("#view-title")).toHaveText("太阳系总览");
    await expect
        .poll(() => new URL(page.url()).searchParams.get("view"))
        .toBe("system");
    await expect(page.locator("#viewport")).toHaveAttribute(
        "data-camera-state",
        "idle",
    );
    await page.screenshot({ path: "test-results/overview-desktop.png" });
    expect(errors).toEqual([]);
});

test("UTC controls, playback, reverse, date boundaries, and deep links", async ({
    page,
}) => {
    await page.goto("/?body=earth&time=1789041600000&scale=illustrated");
    const date = page.locator("#date-input");
    await date.fill("2024-04-08T18:21");
    await date.press("Tab");
    await expect(date).toHaveValue("2024-04-08T18:21");
    await page.locator('[data-body="moon"]').click();
    await expect(page.locator("#secondary-value")).toContainText("新月");
    await page.locator("#next-day").click();
    await expect(date).toHaveValue("2024-04-09T18:21");
    await page.locator("#previous-day").click();
    await expect(date).toHaveValue("2024-04-08T18:21");
    await page.locator("#speed").selectOption("86400");
    await page.locator("#play").click();
    await expect.poll(() => date.inputValue()).not.toBe("2024-04-08T18:21");
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveAttribute(
        "aria-label",
        "播放模拟",
    );
    await page.locator("#reverse").click();
    await expect(page.locator("#reverse")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await date.fill("1900-01-01T00:00");
    await date.press("Tab");
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveAttribute(
        "aria-label",
        "播放模拟",
    );
    await expect(date).toHaveValue("1900-01-01T00:00");
    await page.reload();
    await expect(page.locator("#body-name")).toHaveText("月球");
    await expect(date).toHaveValue("1900-01-01T00:00");
});

test("Narrow viewport retains body selection, data, timeline and accessible controls", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?body=earth&time=1789041600000&scale=illustrated");
    await expect(page.locator("#viewport canvas")).toBeVisible();
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await expect(page.locator("#body-name")).toBeVisible();
    await expect(page.locator("#play")).toBeInViewport();
    await expect(page.locator("#time-slider")).toBeInViewport();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/earth-mobile.png" });
    await page.locator('[data-body="moon"]').click();
    await expect(page.locator("#body-name")).toHaveText("月球");
    await page.locator('[data-body="neptune"]').click();
    await expect(page.locator("#body-name")).toHaveText("海王星");
    await expect(page.locator('[data-body="neptune"]')).toBeInViewport();
    await expect(page.locator("#play")).toBeInViewport();
    await page.locator('[data-body="saturn"]').click();
    await expect(page.locator("#viewport")).toHaveAttribute(
        "data-camera-state",
        "idle",
    );
    await page.screenshot({ path: "test-results/saturn-mobile.png" });
    await page.locator("#guide").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#start-explore").click();
    await expect(page.locator("#guide-dialog")).not.toBeVisible();
});
