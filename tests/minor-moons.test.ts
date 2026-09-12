import { test } from "node:test";
import assert from "node:assert/strict";
import {
    MINOR_MOONS,
    MINOR_MOON_BY_ID,
    targetOffset,
    targetOrbitPoints,
} from "../src/minor-moons";

test("all imported minor moons become unique selectable orbit targets", () => {
    assert.equal(MINOR_MOONS.length, 395);
    assert.equal(new Set(MINOR_MOONS.map((moon) => moon.id)).size, 395);
    assert.equal(MINOR_MOON_BY_ID.get("himalia")?.parentBody, "jupiter");
    assert.equal(MINOR_MOON_BY_ID.get("phoebe")?.parentBody, "saturn");
    assert.ok(
        MINOR_MOONS.every(
            (moon) => moon.kind === "minor-moon" && moon.orbit.period > 0,
        ),
    );
});

test("minor moon orbit points use local parent-relative scale in both modes", () => {
    const moon = MINOR_MOON_BY_ID.get("himalia")!;
    const local = targetOffset(moon, [moon.orbit.a, 0, 0], "illustrated");
    const physical = targetOffset(moon, [moon.orbit.a, 0, 0], "physical");
    assert.ok(Math.hypot(...local) > 1);
    assert.ok(Math.hypot(...physical) > Math.hypot(...local));
    assert.equal(targetOrbitPoints(moon, "illustrated").length, 180);
    assert.ok(
        targetOrbitPoints(moon, "physical").every((point) =>
            point.every(Number.isFinite),
        ),
    );
});
