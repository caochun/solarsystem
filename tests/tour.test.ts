import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { ephemeris } from "../src/model.ts";
import {
    TOUR_STOPS,
    TOUR_DURATION,
    buildTourPath,
    shotFrame,
    transferCurve,
    safeCamera,
} from "../src/tour-path.ts";

test("Tour includes inner worlds, satellites, belts and distant bodies in an eleven-minute loop", () => {
    assert.equal(TOUR_STOPS[0].body, "sun");
    assert.equal(TOUR_STOPS.at(-1)?.region, "system");
    for (const id of [
        "moon",
        "phobos",
        "europa",
        "titan",
        "triton",
        "charon",
        "sedna",
    ])
        assert.ok(
            TOUR_STOPS.some((stop) => stop.body === id),
            id,
        );
    for (const region of ["belt", "trojans", "kuiper"])
        assert.ok(
            TOUR_STOPS.some((stop) => stop.region === region),
            region,
        );
    assert.equal(new Set(TOUR_STOPS.map((s) => s.id)).size, TOUR_STOPS.length);
    assert.ok(
        TOUR_DURATION >= 600 && TOUR_DURATION <= 720,
        String(TOUR_DURATION),
    );
});

test("Shots and connecting curves remain finite, continuous and clear of surfaces across dates and aspect ratios", () => {
    for (const iso of ["1900-01-01", "2026-09-11", "2100-12-31"]) {
        const date = new Date(`${iso}T00:00:00Z`),
            data = ephemeris(date);
        for (const aspect of [1.5, 390 / 844]) {
            const path = buildTourPath(data, date, aspect);
            for (let i = 0; i < path.shots.length; i++) {
                for (let p = 0; p <= 1; p += 0.05) {
                    const frame = shotFrame(path, i, p);
                    assert.ok(
                        [...frame.camera, ...frame.target].every(
                            Number.isFinite,
                        ),
                    );
                    assert.ok(frame.camera.distanceTo(frame.target) > 1);
                    for (const obstacle of path.obstacles)
                        assert.ok(
                            frame.camera.distanceTo(obstacle.center) >=
                                obstacle.radius - 1e-7,
                            `${iso} ${aspect} ${i}: shot collision`,
                        );
                }
                const from = shotFrame(path, i, 1),
                    to = shotFrame(path, (i + 1) % path.shots.length, 0);
                const curve = transferCurve(
                    from.camera,
                    to.camera,
                    path.obstacles,
                );
                assert.ok(curve.getPoint(0).distanceTo(from.camera) < 1e-9);
                assert.ok(curve.getPoint(1).distanceTo(to.camera) < 1e-9);
                for (const p of curve.getPoints(240)) {
                    const safe = safeCamera(p, path.obstacles);
                    assert.ok([...safe].every(Number.isFinite));
                    // Projection should be a safeguard, not a source of jumps in ordinary routes.
                    assert.ok(
                        safe.distanceTo(p) < 1.1,
                        `${iso} ${aspect} ${i}: path crosses an obstacle`,
                    );
                    for (const obstacle of path.obstacles)
                        assert.ok(
                            safe.distanceTo(obstacle.center) >=
                                obstacle.radius - 1e-7,
                        );
                }
            }
        }
    }
});

test("Rejoining an unchanged camera pose does not introduce a spurious flyout", () => {
    const position = new Vector3(100, 3, 5);
    for (const p of transferCurve(position, position, []).getPoints(40))
        assert.ok(p.distanceTo(position) < 1e-10);
});
