import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect } from "vite";
import { createCatalogApi } from "./server/catalog-api.mjs";

// Vite otherwise treats .csv.gz as precompressed CSV and browsers save decoded
// bytes under a .gz filename. These links download the original archive itself.
function catalogDownloads(directory: string): Connect.NextHandleFunction {
    return (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
        if (
            !/^\/catalogs\/[a-z_-]+\.csv\.gz$/.test(pathname) ||
            !["GET", "HEAD"].includes(request.method ?? "")
        )
            return next();
        const file = resolve(directory, `.${pathname}`);
        let size: number;
        try {
            size = statSync(file).size;
        } catch {
            return next();
        }
        response.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Length": size,
            "Cache-Control": "no-cache",
        });
        if (request.method === "HEAD") return void response.end();
        const stream = createReadStream(file);
        response.on("close", () => stream.destroy());
        stream.on("error", () => response.destroy());
        stream.pipe(response);
    };
}

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
    plugins: [
        {
            name: "catalog-archive-downloads",
            configureServer(server) {
                const api = createCatalogApi();
                server.middlewares.use((request, response, next) => {
                    void api.handle(request, response).then((handled) => {
                        if (!handled) next();
                    });
                });
                server.httpServer?.on("close", () => api.close());
                server.middlewares.use(
                    catalogDownloads(resolve(root, "public")),
                );
            },
            configurePreviewServer(server) {
                const api = createCatalogApi();
                server.middlewares.use((request, response, next) => {
                    void api.handle(request, response).then((handled) => {
                        if (!handled) next();
                    });
                });
                server.httpServer.on("close", () => api.close());
                server.middlewares.use(catalogDownloads(resolve(root, "dist")));
            },
        },
    ],
});
