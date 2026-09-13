import { test } from "node:test";
import assert from "node:assert/strict";
import report from "../src/minor-moons-report.json";
import sourceData from "../src/minor-moons.json";
import {
    MINOR_MOONS,
    MINOR_MOON_BY_ID,
    targetOffset,
    targetOrbitPoints,
    orbitAccuracy,
    relativePosition,
} from "../src/minor-moons";

test("all imported minor moons become unique selectable orbit targets", () => {
    assert.equal(MINOR_MOONS.length, 396);
    assert.equal(new Set(MINOR_MOONS.map((moon) => moon.id)).size, 396);
    assert.equal(MINOR_MOON_BY_ID.get("himalia")?.parentBody, "jupiter");
    assert.equal(MINOR_MOON_BY_ID.get("phoebe")?.parentBody, "saturn");
    assert.equal(MINOR_MOON_BY_ID.get("daphnis")?.parentBody, "saturn");
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
        [],
    );
});
test("JPL physical records are attached when a named minor moon is covered", () => {
    const amalthea = MINOR_MOON_BY_ID.get("amalthea");
    const himalia = MINOR_MOON_BY_ID.get("himalia");
    assert.ok(amalthea?.physical?.meanRadiusKm);
    assert.ok(himalia?.physical?.densityGcm3);
    assert.equal(MINOR_MOONS.filter((moon) => moon.physical).length, 19);
});
test("Minor moon accuracy warning follows the distance from the SPICE epoch", () => {
    const moon = MINOR_MOON_BY_ID.get("himalia")!;
    const epoch = moon.orbit.epoch;
    assert.equal(orbitAccuracy(moon, epoch), "sampled");
    assert.equal(orbitAccuracy(moon, epoch + 30 * 86_400_000), "near-epoch");
    assert.equal(orbitAccuracy(moon, epoch + 180 * 86_400_000), "extended");
    assert.equal(orbitAccuracy(moon, epoch + 3 * 365 * 86_400_000), "far");
});
test("SPICE samples interpolate inside their window and fall back outside it", () => {
    const moon = MINOR_MOON_BY_ID.get("himalia")!;
    const original = moon.spiceSamples;
    const originalVelocities = moon.spiceVelocities;
    moon.spiceVelocities = undefined;
    moon.spiceSamples = [[0, 0, 0, 0], [1000, 10, 20, 30]];
    assert.deepEqual(relativePosition(moon, 500), [5, 10, 15]);
    assert.notDeepEqual(relativePosition(moon, 2000), [20, 40, 60]);
    moon.spiceSamples = original;
    moon.spiceVelocities = originalVelocities;
});

test("every imported SPICE series reaches the browser in the correct frame and physical units", () => {
    for (const body of sourceData.bodies) {
        const moon=MINOR_MOON_BY_ID.get(body.id)!;
        assert.ok(moon.spiceSamples && moon.spiceSamples.length>=2,body.id);
        assert.equal(moon.spiceVelocities?.length,moon.spiceSamples.length);
        const [x,y,z]=relativePosition(moon,body.orbit.epoch).map(x=>x*149597870.7);
        const expected=[body.stateKm[0],body.stateKm[2],-body.stateKm[1]];
        assert.ok(Math.hypot(x-expected[0],y-expected[1],z-expected[2])<1,body.id);
        assert.ok(body.sampleValidation.maxInterpolationErrorKm<1,body.id);
    }
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
