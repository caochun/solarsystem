import { test } from "node:test";
import assert from "node:assert/strict";
import report from "../src/minor-moons-report.json";
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
            (moon) =>
                moon.kind === "minor-moon" &&
                moon.orbit.period > 0 &&
                moon.sourceEpoch.length > 10 &&
                moon.sourceUrl.includes(".bsp"),
        ),
    );
    assert.deepEqual(
        report.unsupportedByParent.saturn.map((moon) => moon.id),
        ["daphnis"],
    );
});
test("JPL physical records are attached when a named minor moon is covered", () => {
    const amalthea = MINOR_MOON_BY_ID.get("amalthea");
    const himalia = MINOR_MOON_BY_ID.get("himalia");
    assert.ok(amalthea?.physical?.meanRadiusKm);
    assert.ok(himalia?.physical?.densityGcm3);
    assert.equal(MINOR_MOONS.filter((moon) => moon.physical).length, 19);
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
