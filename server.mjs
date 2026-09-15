import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogApi } from './server/catalog-api.mjs';

// Serve only the built frontend; source code and project files are outside this root.
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), 'dist'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
};

const catalogs = createCatalogApi();
const HORIZONS_TARGETS = new Set(['10', '199', '299', '301', '399', '499', '599', '699', '799', '899']);
function parseHorizonsRows(result) {
  const soe = result.indexOf('$$SOE'), eoe = result.indexOf('$$EOE');
  if (soe < 0 || eoe <= soe) return [];
  return result.slice(soe + 5, eoe).trim().split(/\r?\n/).filter(Boolean).slice(0, 1441).map((line) => {
    const fields = line.split(',').map((field) => field.trim());
    return { raw: line, fields };
  });
}
async function horizons(request, response, url) {
  if (request.method !== 'GET' || url.pathname !== '/api/horizons') return false;
  const target = url.searchParams.get('target') || '';
  const start = url.searchParams.get('start') || '';
  const stop = url.searchParams.get('stop') || '';
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const elevation = Number(url.searchParams.get('elevation') || 0);
  const startDate = new Date(start), stopDate = new Date(stop);
  const valid = HORIZONS_TARGETS.has(target) && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && Number.isFinite(elevation) &&
    elevation >= -1 && elevation <= 10000 && Number.isFinite(startDate.getTime()) &&
    Number.isFinite(stopDate.getTime()) && stopDate > startDate && stopDate - startDate <= 86_400_000;
  const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  if (!valid) { send(400, { error: 'Invalid Horizons request' }); return true; }
  const params = new URLSearchParams({ format: 'json', COMMAND: `'${target}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@399'", COORD_TYPE: 'GEODETIC', SITE_COORD: `'${lon},${lat},${elevation / 1000}'`, START_TIME: `'${startDate.toISOString().slice(0, 16).replace('T', ' ')}'`, STOP_TIME: `'${stopDate.toISOString().slice(0, 16).replace('T', ' ')}'`, STEP_SIZE: "'1 m'", QUANTITIES: "'4,20,23,24'", CSV_FORMAT: 'YES' });
  try {
    const upstream = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (!upstream.ok) { send(502, { error: `Horizons returned HTTP ${upstream.status}` }); return true; }
    const payload = await upstream.json();
    if (payload.error) { send(502, { error: payload.error }); return true; }
    const result = typeof payload.result === 'string' ? payload.result : '';
    const rows = parseHorizonsRows(result);
    send(200, { source: 'JPL Horizons', target, request: { start: startDate.toISOString(), stop: stopDate.toISOString(), latitude: lat, longitude: lon, elevationMeters: elevation }, columns: ['datetime', 'RA', 'DEC', 'range', 'range-rate', 'AZ', 'EL'], rows, ephemeris: rows.map((row) => row.raw).slice(0, 32) });
  } catch (error) { send(504, { error: `Horizons 查询失败：${error.message}` }); }
  return true;
}
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  if (await horizons(request, response, requestUrl)) return;
  if (await catalogs.handle(request, response)) return;
  const fail = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : message);
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    fail(405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    if (pathname.includes('\0')) throw new Error('Invalid path');
  } catch {
    fail(400, 'Invalid request path');
    return;
  }
  const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!candidate.startsWith(root + sep)) {
    fail(403, 'Forbidden');
    return;
  }
  try {
    const file = await realpath(candidate);
    if (!file.startsWith(root + sep)) {
      fail(403, 'Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      fail(404, 'Not found');
      return;
    }
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    response.on('close', () => stream.destroy());
    stream.on('error', error => { console.error('Static file read failed:', error.message); response.destroy(); });
    stream.pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') fail(404, 'Not found');
    else { console.error('Static request failed:', error.message); fail(500, 'Internal server error'); }
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on('error', error => { console.error(error); process.exit(1); });
server.listen(port, host, () => console.log(`SolarSpace serving ${root} at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    catalogs.close();
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  });
}
