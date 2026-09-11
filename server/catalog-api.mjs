import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function createCatalogApi() {
    const base = dirname(fileURLToPath(import.meta.url));
    let worker = null,
        sequence = 0;
    const pending = new Map();
    function start() {
        if (worker) return;
        worker = spawn(
            process.env.SOLARSPACE_PYTHON || "python3",
            [
                resolve(base, "catalog_worker.py"),
                process.env.SOLARSPACE_CATALOG_DB ||
                    resolve(base, "../data/catalog.sqlite"),
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        const child = worker;
        child.stderr.on("data", () => {});
        const fail = () => {
            if (worker !== child) return;
            worker = null;
            for (const { reject, timer } of pending.values()) {
                clearTimeout(timer);
                reject(new Error("完整目录服务暂时不可用"));
            }
            pending.clear();
        };
        child.on("error", fail);
        child.on("exit", fail);
        child.stdin.on("error", fail);
        createInterface({ input: child.stdout }).on("line", (line) => {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }
            const entry = pending.get(message.requestId);
            if (!entry) return;
            pending.delete(message.requestId);
            clearTimeout(entry.timer);
            if (message.error)
                entry.reject(
                    Object.assign(new Error(message.error), {
                        status: message.status || 503,
                    }),
                );
            else entry.resolve(message.result);
        });
    }
    function call(request) {
        if (pending.size >= 16)
            return Promise.reject(new Error("目录查询繁忙，请稍后重试"));
        start();
        return new Promise((resolveResult, reject) => {
            const requestId = ++sequence;
            const timer = setTimeout(() => {
                pending.delete(requestId);
                reject(new Error("查询超时，请缩小搜索范围"));
            }, 12000);
            pending.set(requestId, { resolve: resolveResult, reject, timer });
            worker.stdin.write(
                JSON.stringify({ ...request, requestId }) + "\n",
            );
        });
    }
    return {
        close() {
            worker?.kill();
        },
        async handle(request, response) {
            const url = new URL(request.url || "/", "http://localhost");
            if (!url.pathname.startsWith("/api/catalog/")) return false;
            response.setHeader(
                "Content-Type",
                "application/json; charset=utf-8",
            );
            response.setHeader("Cache-Control", "no-store");
            const send = (status, body) => {
                response.writeHead(status);
                response.end(JSON.stringify(body));
            };
            if (request.method !== "GET") {
                response.setHeader("Allow", "GET");
                send(405, { error: "Method not allowed" });
                return true;
            }
            try {
                let result;
                if (url.pathname === "/api/catalog/summary")
                    result = await call({ kind: "summary" });
                else if (url.pathname === "/api/catalog/search")
                    result = await call({
                        kind: "search",
                        q: url.searchParams.get("q") || "",
                        category: url.searchParams.get("category") || "",
                        offset: url.searchParams.get("offset") || 0,
                    });
                else if (url.pathname.startsWith("/api/catalog/object/"))
                    result = await call({
                        kind: "object",
                        id: url.pathname.split("/").pop(),
                    });
                else {
                    send(404, { error: "Not found" });
                    return true;
                }
                send(
                    result === null ? 404 : 200,
                    result ?? { error: "未找到该天体" },
                );
            } catch (error) {
                send(error.status || 503, { error: error.message });
            }
            return true;
        },
    };
}
