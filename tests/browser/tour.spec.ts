import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page, query = "body=earth&time=1788998400000") {
    await page.goto(`/?${query}`);
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
}
async function fallback(page: Page) {
    await page.addInitScript(() => {
        Element.prototype.requestFullscreen = () =>
            Promise.reject(new DOMException("Denied", "NotAllowedError"));
    });
}
async function start(page: Page) {
    await page.locator("#viewport canvas").focus();
    await page.keyboard.press("f");
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-stop",
        "sun",
    );
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-state",
        "playing",
    );
}

test("F starts fullscreen, hides interface, pauses for mouse exploration and restores the physical view", async ({
    page,
}) => {
    test.setTimeout(45000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page, "body=saturn&time=1788998400000&scale=physical");
    await page.locator("#axis").check();
    await page.locator("#rings").uncheck();
    await page.mouse.move(800, 370);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(875, 420, { steps: 10 });
    await page.mouse.up({ button: "right" });
    // Let damping settle before saving the user's panned view.
    await page.waitForTimeout(2200);
    const url = page.url();
    const label = (await page.locator(".body-label.saturn").boundingBox())!;
    await page.locator("#viewport canvas").focus();
    const sceneOnly =
        "#app > header,main > :not(#viewport),#app > footer { visibility:hidden !important; } #viewport canvas { outline:none !important; }";
    const before = await page
        .locator("#viewport canvas")
        .screenshot({
            path: "test-results/tour-restore-before.png",
            style: sceneOnly,
        });
    await start(page);
    if (await page.evaluate(() => document.fullscreenEnabled))
        await expect
            .poll(() =>
                page.evaluate(() => Boolean(document.fullscreenElement)),
            )
            .toBe(true);
    await expect(page.locator(".header")).toBeHidden();
    await expect(page.locator(".statusbar")).toBeHidden();
    await expect(page.locator(".body-label:visible")).toHaveCount(0);
    expect(await page.locator(".catalog").evaluate((el) => el.inert)).toBe(
        true,
    );
    expect(
        await page.locator("#viewport canvas").evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return (
                rect.x === 0 &&
                rect.y === 0 &&
                Math.abs(rect.width - innerWidth) < 2 &&
                Math.abs(rect.height - innerHeight) < 2
            );
        }),
    ).toBe(true);
    await expect(page.locator("#tour-caption")).toBeHidden();
    await page.keyboard.press("n");
    await expect(page.locator("#tour-title")).toContainText("恒星");
    await page.keyboard.press("Space");
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-state",
        "paused",
    );
    const paused = await page.locator("#tour-progress").textContent();
    const pose = await page.locator("#viewport canvas").screenshot();
    await page.mouse.move(650, 300);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(780, 340, { steps: 12 });
    await page.mouse.up({ button: "right" });
    expect(
        pose.equals(await page.locator("#viewport canvas").screenshot()),
    ).toBe(false);
    await expect(page.locator("#tour-progress")).toHaveText(paused!);
    await page.keyboard.press("8");
    await expect(page.locator("#body-name")).toHaveText("土星");
    await page.keyboard.press("Space");
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-state",
        "playing",
    );
    await page.keyboard.press("f");
    await expect(page.locator("#solar-tour")).toBeHidden();
    await expect
        .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
        .toBe(false);
    await expect(page.locator(".header")).toBeVisible();
    await expect(page.locator("#date-input")).toHaveValue("2026-09-10T00:00");
    await expect(page.locator('[data-scale="physical"]')).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(page.locator("#axis")).toBeChecked();
    await expect(page.locator("#rings")).not.toBeChecked();
    await expect(page.locator("#orbits")).toBeChecked();
    expect(page.url()).toBe(url);
    await expect
        .poll(async () =>
            Math.abs(
                (await page.locator(".body-label.saturn").boundingBox())!.x -
                    label.x,
            ),
        )
        .toBeLessThan(1);
    const after = await page
        .locator("#viewport canvas")
        .screenshot({
            path: "test-results/tour-restore-after.png",
            style: sceneOnly,
        });
    const changedPixels = await page.evaluate(
        async ([a, b]) => {
            const decode = async (data: string) => {
                const img = new Image();
                img.src = `data:image/png;base64,${data}`;
                await img.decode();
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(img, 0, 0);
                return ctx.getImageData(0, 0, img.width, img.height).data;
            };
            const [first, last] = await Promise.all([decode(a), decode(b)]);
            if (first.length !== last.length) return 1;
            let changed = 0;
            for (let i = 0; i < first.length; i += 4)
                if (
                    Math.max(
                        ...[0, 1, 2].map((c) =>
                            Math.abs(first[i + c] - last[i + c]),
                        ),
                    ) > 8
                )
                    changed++;
            return changed / (first.length / 4);
        },
        [before.toString("base64"), after.toString("base64")],
    );
    // Permit subpixel antialiasing after the fullscreen resize, while catching lost geometry or camera state.
    expect(changedPixels).toBeLessThan(0.0005);
    expect(errors).toEqual([]);
});

test("A catalog link that finishes loading during the tour is followed on exit", async ({
    page,
    request,
}) => {
    const response = await request.get("/api/catalog/search?q=433");
    const object = (await response.json()).rows[0];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`**/api/catalog/object/${object.id}`, async (route) => {
        await gate;
        await route.fulfill({ json: object });
    });
    await fallback(page);
    await ready(page, `body=earth&time=1788998400000&object=${object.id}`);
    await start(page);
    const loaded = page.waitForResponse(`**/api/catalog/object/${object.id}`);
    release();
    await loaded;
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-stop",
        "sun",
    );
    await expect(page.locator("#body-name")).toHaveText("地球");
    await page.keyboard.press("Escape");
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    expect(new URL(page.url()).searchParams.get("object")).toBe(object.id);
});

test("HUD fades to a pure space view, input F is ignored and fullscreen refusal still permits touring", async ({
    page,
}) => {
    await fallback(page);
    await ready(page);
    await page.locator("#body-search").fill("f");
    await page.locator("#body-search").press("f");
    await expect(page.locator("#solar-tour")).toBeHidden();
    await start(page);
    await expect(page.locator("#tour-status")).toContainText("沉浸布局");
    await expect(page.locator("#tour-hud")).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: "test-results/tour-sun-clean.png" });
    await page.mouse.move(650, 350);
    await expect(page.locator("#tour-hud")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#solar-tour")).toBeHidden();
    await expect(page.locator("#body-search")).toHaveValue("ff");
});

test("Tour visits moons, the belt, rings and outer worlds, loading their local models and clouds", async ({
    page,
}) => {
    test.setTimeout(120000);
    const errors: string[] = [],
        resources = new Set<string>();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    page.on("response", (r) => {
        if (r.ok()) resources.add(new URL(r.url()).pathname);
        else if (r.status() >= 400) errors.push(r.url());
    });
    await fallback(page);
    await page.clock.install();
    await ready(page);
    await start(page);
    await page.keyboard.press("n");
    const stops = new Map([
        [4, "moon"],
        [6, "phobos"],
        [7, "belt"],
        [9, "vesta"],
        [15, "trojans"],
        [16, "saturn"],
        [24, "pluto"],
        [26, "kuiper"],
        [31, "home"],
    ]);
    for (let i = 1; i <= 31; i++) {
        await page.keyboard.press("ArrowRight");
        if (!stops.has(i)) continue;
        await expect(page.locator("#solar-tour")).toHaveAttribute(
            "data-stop",
            stops.get(i)!,
        );
        await page.clock.runFor(4300);
        await page.screenshot({
            path: `test-results/tour-${stops.get(i)}.png`,
        });
    }
    for (const path of [
        "/models/phobos.glb",
        "/models/vesta.glb",
        "/catalogs/main_belt_asteroid.json",
        "/catalogs/jupiter_trojan_asteroid.json",
        "/catalogs/transneptunian_object_asteroid.json",
    ])
        expect(resources.has(path), path).toBe(true);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-stop",
        "sun",
    );
    await page.keyboard.press("ArrowLeft");
    await page.locator("#tour-loop").uncheck();
    await page.locator("#tour-speed").selectOption("4");
    await page.clock.runFor(13000);
    await expect(page.locator("#solar-tour")).toBeHidden();
    expect(errors).toEqual([]);
});

test("Playback and a tracked catalog orbit resume after browser fullscreen exit", async ({
    page,
}) => {
    await ready(page);
    await page.locator("#catalog-shortcut").click();
    await page.locator("#catalog-scope").selectOption("all");
    await page.locator("#catalog-search").fill("433");
    await expect(page.locator("#catalog-search-status")).toContainText(
        "匹配 1 个对象",
    );
    await page.locator("#catalog-focus").click();
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    const object = new URL(page.url()).searchParams.get("object");
    await page.locator("#speed").selectOption("86400");
    await page.locator("#play").click();
    await start(page);
    await expect(page.locator("#play")).toHaveAttribute(
        "aria-label",
        "播放模拟",
    );
    const date = await page.locator("#date-input").inputValue();
    await page.waitForTimeout(400);
    await expect(page.locator("#date-input")).toHaveValue(date);
    if (await page.evaluate(() => Boolean(document.fullscreenElement)))
        await page.evaluate(() => document.exitFullscreen());
    else await page.keyboard.press("Escape");
    await expect(page.locator("#solar-tour")).toBeHidden();
    await expect(page.locator("#play")).toHaveAttribute(
        "aria-label",
        "暂停模拟",
    );
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    await expect
        .poll(() => page.locator("#date-input").inputValue())
        .not.toBe(date);
    expect(new URL(page.url()).searchParams.get("object")).toBe(object);
});

test("Mobile button, resizing and rapid exit leave controls usable", async ({
    page,
}) => {
    await fallback(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await expect(page.locator("#start-tour")).toBeInViewport();
    await page.locator("#start-tour").click();
    await expect(page.locator("#tour-exit")).toBeInViewport();
    await page.screenshot({ path: "test-results/tour-mobile.png" });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    await page.locator("#tour-pause").click();
    await expect(page.locator("#solar-tour")).toHaveAttribute(
        "data-state",
        "paused",
    );
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("#tour-exit")).toBeInViewport();
    await page.locator("#tour-exit").click();
    await expect(page.locator("#solar-tour")).toBeHidden();
    for (let i = 0; i < 3; i++) {
        await page.locator("#start-tour").click();
        await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-body="moon"]').click();
    await expect(page.locator("#body-name")).toHaveText("月球");
    expect(await page.locator(".catalog").evaluate((el) => el.inert)).toBe(
        false,
    );
});
