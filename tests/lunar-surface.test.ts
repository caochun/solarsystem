import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { GeoMoon, Libration } from "astronomy-engine";
import { lunarAxes, lunarPixels, lunarSurfacePoint, lunarUV, lunarView, type LunarView } from "../src/lunar-surface";
import { OBSERVATORY_SITES } from "../src/observatory";
import manifest from "../src/lunar-surface-data.json";

test("lunar meridian and latitude agree with the independent libration formula", () => {
    for (const iso of ["2026-09-10", "2026-09-17", "2026-09-26", "2026-10-04"]) {
        const date = new Date(iso), moon = GeoMoon(date), distance = moon.Length();
        const [u,v] = lunarUV(lunarAxes(date).toBody([-moon.x/distance,-moon.y/distance,-moon.z/distance]));
        const libration = Libration(date);
        assert.ok(Math.abs((u-0.5)*360-libration.elon)<0.01);
        assert.ok(Math.abs((0.5-v)*180-libration.elat)<0.06);
    }
});

test("ground location changes the lunar viewing hemisphere and keeps a perpendicular camera basis", () => {
    const date = new Date("2026-09-26T12:00:00Z");
    const a = lunarView(date,OBSERVATORY_SITES[0]), b = lunarView(date,OBSERVATORY_SITES[2]);
    assert.ok(Math.hypot(...a.towardObserver.map((x,i)=>x-b.towardObserver[i]))>0.001);
    for (const vector of [a.right,a.up,a.towardObserver]) assert.ok(Math.abs(Math.hypot(...vector)-1)<1e-10);
    assert.ok(Math.abs(a.right.reduce((s,x,i)=>s+x*a.up[i],0))<1e-10);
});

test("moon surface is sampled from the visible hemisphere, clips at the limb, and supports extreme crops", () => {
    const view: LunarView = {towardObserver:[1,0,0],right:[0,0,-1],up:[0,1,0],towardSun:[1,0,0]};
    const row = [0,0,255,255, 255,0,0,255, 255,0,0,255, 0,0,255,255];
    const color = {width:4,height:2,data:new Uint8ClampedArray([...row,...row])};
    const image = lunarPixels(64,64,32,32,20,view,color,null,1);
    const i=(32*64+32)*4;
    assert.ok(image[i]>200 && image[i+2]<5, "center must show the near side rather than the far side of the world map");
    assert.equal(image[3],0);
    assert.equal(lunarSurfacePoint(view,1.01,0),null);
    const dark = lunarPixels(64,64,32,32,20,{...view,towardSun:[-1,0,0]},color,null,1);
    assert.equal(dark[i],0);
    const crop = lunarPixels(64,64,32,32,1e6,view,color,null,1);
    assert.equal(crop.length,64*64*4);
    assert.ok(crop[0]>200 && crop[3]===255);
});

test("published lunar derivatives match provenance and preserve all LOLA half-meter samples", () => {
    for (const key of ["color","sceneColor","elevation","normals","sceneNormals"] as const) {
        const file=manifest[key];
        const data=readFileSync(new URL(`../public/${file.path}`,import.meta.url));
        assert.equal(data.length,file.bytes);
        assert.equal(createHash("sha256").update(data).digest("hex"),file.sha256);
    }
    const elevation=manifest.elevation;
    const raw=gunzipSync(readFileSync(new URL(`../public/${elevation.path}`,import.meta.url)));
    assert.equal(raw.length,elevation.width*elevation.height*2);
    let min=Infinity,max=-Infinity;
    for (let i=0;i<raw.length;i+=2) {
        const h=raw.readUInt16LE(i)*elevation.scaleMeters+elevation.offsetMeters;
        min=Math.min(min,h);max=Math.max(max,h);
    }
    assert.equal(min,elevation.minMeters);
    assert.equal(max,elevation.maxMeters);
});
