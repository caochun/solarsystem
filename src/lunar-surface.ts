import { Body, GeoMoon, GeoVector, Observer, ObserverVector, RotationAxis } from "astronomy-engine";
import type { ObservatorySite } from "./observatory";

type V3 = [number, number, number];
type XYZ = { x: number; y: number; z: number };
const array = (v: XYZ): V3 => [v.x, v.y, v.z];
const dot = (a: V3, b: V3) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a: V3, b: V3): V3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: V3): V3 => { const r = Math.hypot(...v); return v.map(x => x / r) as V3; };
const subtract = (a: V3, b: V3): V3 => a.map((v,i) => v-b[i]) as V3;

/** Moon body axes match the local sphere: X = prime meridian, Y = north, -Z = east. */
export function lunarAxes(date: Date) {
    const axis = RotationAxis(Body.Moon, date);
    const north = unit(array(axis.north));
    const ra = axis.ra * Math.PI / 12;
    const node: V3 = [-Math.sin(ra), Math.cos(ra), 0];
    const quarter = cross(north, node);
    const angle = (axis.spin % 360) * Math.PI / 180;
    const prime = node.map((v,i) => v*Math.cos(angle) + quarter[i]*Math.sin(angle)) as V3;
    const west = cross(prime, north);
    return { toBody: (v: V3): V3 => [dot(v,prime), dot(v,north), dot(v,west)] };
}

export interface LunarView { towardObserver: V3; right: V3; up: V3; towardSun: V3 }

export function lunarView(date: Date, site: ObservatorySite): LunarView {
    const observer = new Observer(site.latitude, site.longitude, site.heightMeters);
    const location = array(ObserverVector(date, observer, false));
    const moon = array(GeoMoon(date));
    const towardObserver = unit(subtract(location, moon));
    // A second observer one km higher gives the local geodetic zenith.
    const higher = array(ObserverVector(date, new Observer(site.latitude,site.longitude,site.heightMeters+1000),false));
    const zenith = unit(subtract(higher,location));
    let right = cross(zenith,towardObserver);
    if (Math.hypot(...right) < 1e-8) right = cross([0,0,1],towardObserver);
    right = unit(right);
    const up = unit(cross(towardObserver,right));
    const towardSun = unit(subtract(array(GeoVector(Body.Sun,date,true)),moon));
    const {toBody} = lunarAxes(date);
    return {towardObserver:toBody(towardObserver),right:toBody(right),up:toBody(up),towardSun:toBody(towardSun)};
}

export function lunarUV(normal: V3): [number,number] {
    const longitude = Math.atan2(-normal[2],normal[0]);
    return [((longitude/(2*Math.PI)+0.5)%1+1)%1, 0.5-Math.asin(Math.max(-1,Math.min(1,normal[1])))/Math.PI];
}

/** Visible hemisphere lookup; a flat world map must never be squeezed into a disk. */
export function lunarSurfacePoint(view: LunarView, x: number, y: number): V3 | null {
    const r2 = x*x+y*y;
    if (r2 > 1) return null;
    const z = Math.sqrt(1-r2);
    return view.towardObserver.map((v,i) => z*v + x*view.right[i] + y*view.up[i]) as V3;
}

export interface SurfaceRaster { width: number; height: number; data: Uint8ClampedArray }

/** Bilinear lookup with a periodic longitude seam and clamped poles. */
function sample(map: SurfaceRaster, u: number, v: number, channel: number) {
    const px = u*map.width-0.5;
    const py = Math.max(0,Math.min(map.height-1,v*map.height-0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px-x0, fy = py-y0;
    const at = (x: number,y: number) => map.data[(y*map.width+(x%map.width+map.width)%map.width)*4+channel];
    const y1 = Math.min(y0+1,map.height-1);
    return (at(x0,y0)*(1-fx)+at(x0+1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x0+1,y1)*fx)*fy;
}

export function lunarPixels(
    width: number, height: number, centerX: number, centerY: number, radius: number,
    view: LunarView, color: SurfaceRaster, normals: SurfaceRaster | null, intensity: number,
) {
    // Render directly at output resolution, including tiny crops at very long focal lengths.
    const pixels = new Uint8ClampedArray(width*height*4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const surface = lunarSurfacePoint(view,(x+0.5-centerX)/radius,(centerY-y-0.5)/radius);
        if (!surface) continue;
        const [u,v] = lunarUV(surface);
        const normal = normals ? unit([0,1,2].map(c=>sample(normals,u,v,c)/127.5-1) as V3) : surface;
        // Keep the far side of the ideal terminator dark. Terrain casting is not modeled.
        const light = dot(surface,view.towardSun)>0 ? Math.max(0,dot(normal,view.towardSun)) : 0;
        const index = (y*width+x)*4;
        for (let c=0;c<3;c++) {
            // Light multiplication belongs in linear RGB, not gamma-encoded JPEG values.
            const encoded = sample(color,u,v,c)/255;
            const linear = encoded<=0.04045 ? encoded/12.92 : ((encoded+0.055)/1.055)**2.4;
            const lit = Math.max(0,Math.min(1,linear*light*intensity));
            pixels[index+c] = 255*(lit<=0.0031308 ? lit*12.92 : 1.055*lit**(1/2.4)-0.055);
        }
        pixels[index+3] = 255;
    }
    return pixels;
}
