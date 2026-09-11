export interface KeplerElements {
    a: number; // AU
    e: number;
    i: number; // degrees, J2000 ecliptic
    node: number;
    peri: number;
    m: number;
    period: number; // days
    epoch: number; // UTC milliseconds (catalog epochs are treated as UTC for display)
}

export function keplerPosition(
    orbit: KeplerElements,
    time: number,
): [number, number, number] {
    const rad = Math.PI / 180;
    const m =
        (((orbit.m * rad +
            ((time - orbit.epoch) / 86400000 / orbit.period) * Math.PI * 2) %
            (Math.PI * 2)) +
            Math.PI * 2) %
        (Math.PI * 2);
    // Monotonic bisection remains stable for the high-eccentricity comet catalogs.
    let low = 0,
        high = Math.PI * 2;
    for (let step = 0; step < 42; step++) {
        const mid = (low + high) / 2;
        if (mid - orbit.e * Math.sin(mid) < m) low = mid;
        else high = mid;
    }
    const eccentric = (low + high) / 2;
    return eccentricPosition(orbit, eccentric);
}

// Uniform eccentric anomaly keeps high-eccentricity comet paths smooth near perihelion.
export function keplerOrbitPositions(orbit: KeplerElements, count = 720) {
    return Array.from({ length: count + 1 }, (_, i) =>
        eccentricPosition(orbit, (i / count) * Math.PI * 2),
    );
}

function eccentricPosition(
    orbit: KeplerElements,
    eccentric: number,
): [number, number, number] {
    const rad = Math.PI / 180;
    const x = orbit.a * (Math.cos(eccentric) - orbit.e);
    const y = orbit.a * Math.sqrt(1 - orbit.e ** 2) * Math.sin(eccentric);
    const cN = Math.cos(orbit.node * rad),
        sN = Math.sin(orbit.node * rad);
    const cW = Math.cos(orbit.peri * rad),
        sW = Math.sin(orbit.peri * rad);
    const cI = Math.cos(orbit.i * rad),
        sI = Math.sin(orbit.i * rad);
    return [
        (cN * cW - sN * sW * cI) * x + (-cN * sW - sN * cW * cI) * y,
        sW * sI * x + cW * sI * y,
        -((sN * cW + cN * sW * cI) * x + (-sN * sW + cN * cW * cI) * y),
    ];
}
