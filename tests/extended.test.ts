import test from "node:test";
import assert from "node:assert/strict";
import { BODY_IDS, BODIES, EXTENDED, DAY, ephemeris, parentOf, isSatellite, positions, radius, RADII, parentDistanceKm, relativeVector } from "../src/model.ts";
import { keplerPosition } from "../src/kepler.ts";
import reference from "./fixtures/kepler-reference.json";

test("Kepler positions agree with independent NAIF CSPICE reference states, including retrograde and eccentric orbits", () => {
    for (const fixture of reference.fixtures) {
        const point = keplerPosition(fixture.orbit, fixture.time);
        const error = Math.hypot(...point.map((value, i) => value - fixture.sceneAU[i]));
        assert.ok(error < 2e-9, `${fixture.id}: ${error} AU`);
    }
});

test("Every satellite follows the correct parent and the physical scale holds throughout the supported era", () => {
    for (const year of [1900, 2026, 2100]) {
        const data = ephemeris(new Date(Date.UTC(year, 8, 10)));
        const points = positions(data, "physical");
        const kmPerUnit = RADII.earth / radius("earth", "physical");
        for (const id of BODY_IDS) {
            assert.ok(points[id].every(Number.isFinite), id);
            assert.ok(BODIES[id].name.length > 0);
            if (isSatellite(id)) {
                const parent = parentOf(id)!;
                const distanceKm = Math.hypot(...points[id].map((v, i) => v - points[parent][i])) * kmPerUnit;
                assert.ok(Math.abs(distanceKm - parentDistanceKm(data, id)) < .001, id);
            }
        }
    }
    assert.equal(parentOf("triton"), "neptune");
    assert.equal(parentOf("charon"), "pluto");
    assert.equal(parentOf("io"), "jupiter");
    assert.equal(BODY_IDS.filter(isSatellite).length, 27);
    assert.equal(Object.values(EXTENDED).filter(b => b.category === "dwarf").length, 5);
});

test("NASA PCK corrects source dimensions and JPL mean radii replace historical Pluto moon placeholders", () => {
    assert.equal(RADII.triton, 1352.6);
    assert.equal(RADII.ariel, 581.1);
    assert.equal(RADII.hyperion, 180.1);
    assert.equal(RADII.pluto, 1188.3);
    assert.equal(EXTENDED.nix.radiusQuality, "mean-estimate");
    assert.equal(RADII.nix, 18);
    assert.equal(RADII.hydra, 18.5);
    assert.equal(RADII.kerberos, 6);
    assert.equal(RADII.styx, 5.2);
    assert.match(BODIES.nix.fact, /平均半径估计/);
});

test("Triton's path is retrograde and changing the clock moves short-period satellites", () => {
    assert.ok(EXTENDED.triton.orbit!.i > 90);
    const t = Date.UTC(2026, 8, 10);
    const a = ephemeris(new Date(t)), b = ephemeris(new Date(t + DAY / 10));
    const difference = Math.hypot(...a.relative.phobos.map((v, i) => v - b.relative.phobos[i]));
    assert.ok(difference > 0.00005);
});

test("Major satellites use local SPK interpolation around the reference epoch", () => {
    const sampled = Object.values(EXTENDED).filter((body) => body.spiceSamples?.length === 65);
    assert.equal(sampled.length, 25);
    for (const [id, body] of Object.entries(EXTENDED).filter(([, body]) => body.spiceSamples?.length === 65)) {
        const window = body.sampleWindow!;
        assert.ok(window[1] - window[0] > 13 * DAY);
        assert.ok(body.spiceSamples!.every((sample) => sample.slice(1).every(Number.isFinite)));
        assert.ok(body.spiceVelocities!.every((sample) => sample.every(Number.isFinite)));
        const atEpoch = relativeVector(id as BodyId, new Date(Date.UTC(2026, 8, 10)));
        assert.ok(atEpoch.every(Number.isFinite), body.english);
    }
});
