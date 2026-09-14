import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import references from "../src/surface-references.json";
import update from "../src/small-body-updates.json";
import coverage from "../src/data-coverage.json";
import { extra, sourceDescription, dataStatus, thumbnailOf, type BodyId } from "../src/model";
import { MINOR_MOONS } from "../src/minor-moons";

test("spacecraft reference originals match their records without upgrading global surface coverage", () => {
    for (const [id, reference] of Object.entries(references.bodies)) {
        const bytes=readFileSync(new URL(`../public/${reference.path}`,import.meta.url));
        assert.equal(bytes.length,reference.bytes,id);
        assert.equal(createHash("sha256").update(bytes).digest("hex"),reference.sha256,id);
        assert.ok(reference.credit.startsWith("NASA"),id);
        assert.equal(dataStatus(id as BodyId),"orbit-point",id);
    }
});

test("updated SBDB orbits retain their actual epochs, sources and omitted physical fields", () => {
    const digest=createHash("sha256").update(readFileSync(new URL("../scripts/reference/naif0012.tls",import.meta.url))).digest("hex");
    assert.equal(digest,update.timeConversion.sha256);
    for (const [id, snapshot] of Object.entries(update.bodies)) {
        assert.equal(snapshot.orbit.equinox,"J2000");
        const utc=Date.parse(snapshot.epochUTC);
        const tdb=(Number(snapshot.orbit.epoch)-2440587.5)*86400000;
        assert.ok(tdb-utc>68000 && tdb-utc<70000,id);
        if (id==="pluto") continue;
        assert.equal(extra(id as BodyId)!.orbit!.epoch,utc);
        assert.match(sourceDescription(id as BodyId),/JPL SBDB/);
        if (!["ceres","vesta"].includes(id)) {
            const expected = ["makemake","sedna","gonggong"].includes(id)
                ? ["GM","diameter","density"]
                : ["diameter","density"];
            assert.deepEqual(snapshot.missingPhysical,expected);
        }
    }
});

test("coverage report reconciles all imported moons, sample points and local physical records", () => {
    assert.equal(coverage.minorMoonEntries,MINOR_MOONS.length);
    assert.equal(coverage.minorMoonSamples.statePoints,MINOR_MOONS.reduce((n,b)=>n+b.spiceSamples!.length,0));
    assert.equal(coverage.minorMoonsWithPhysicalRecords,MINOR_MOONS.filter(b=>b.physical).length);
    assert.equal(coverage.physicalRecords,52);
    assert.ok(Object.values(coverage.missingOriginalMinorMoonCandidates).every(b=>b.length===0));
});

test("every model-backed body has a real catalogue thumbnail", () => {
    for (const id of ["phobos", "deimos", "eris", "haumea", "makemake", "vesta"] as BodyId[]) {
        const asset = thumbnailOf(id);
        assert.equal(asset, `thumbnails/${id}.png`);
        const bytes = readFileSync(new URL(`../public/${asset}`, import.meta.url));
        assert.ok(bytes.length > 1000, id);
    }
});
