import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createCatalogApi } from "../server/catalog-api.mjs";

function run(requests: object[]) {
    const child = spawnSync(
        "python3",
        ["server/catalog_worker.py", "data/catalog.sqlite"],
        {
            input:
                requests
                    .map((request, requestId) =>
                        JSON.stringify({ ...request, requestId }),
                    )
                    .join("\n") + "\n",
            encoding: "utf8",
        },
    );
    assert.equal(child.status, 0, child.stderr);
    return child.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
}
test("Complete catalog finds unsampled objects, exact numbers, category memberships, and stable identities", () => {
    const [summary, eros, halley, category, invalid, quoted] = run([
        { kind: "summary" },
        { q: "433" },
        { q: "Halley" },
        { q: "433", category: "main_belt_asteroid" },
        { q: "ab" },
        { q: '" OR 1=1 --' },
    ]);
    assert.equal(summary.result.uniqueObjects, 1542803);
    assert.equal(eros.result.total, 1);
    const row = eros.result.rows[0];
    assert.match(row.name, /433 Eros/);
    assert.ok(row.categories.includes("amor_asteroid"));
    assert.equal(category.result.total, 0);
    assert.equal(halley.result.total, 2);
    assert.ok(invalid.error);
    assert.equal(quoted.result.total, 0);
    const sample = JSON.parse(
        readFileSync("public/catalogs/amor_asteroid.json", "utf8"),
    );
    // This object is actually outside the rendered sample; full search must find it.
    assert.equal(
        sample.some((body: { name: string }) => body.name === row.name),
        false,
    );
    const [resolved] = run([{ kind: "object", id: row.id }]);
    assert.deepEqual(resolved.result, row);
});

test("Full search paginates without duplicates and validates identities", () => {
    const [first, second, malformed] = run([
        { q: "2024" },
        { q: "2024", offset: 40 },
        { kind: "object", id: "../../data" },
    ]);
    // Numeric-only input is an exact numbered object, not a year substring.
    assert.equal(first.result.total, 1);
    assert.equal(second.result.rows.length, 0);
    assert.ok(malformed.error);
    const [a, b, unsupported] = run([
        { q: "2024 Y" },
        { q: "2024 Y", offset: 40 },
        { q: "2002 PD153" },
    ]);
    assert.ok(a.result.total > 40);
    assert.equal(
        new Set([...a.result.rows, ...b.result.rows].map((row) => row.id)).size,
        80,
    );
    assert.equal(unsupported.result.rows[0].orbit, null);
});

test("Node HTTP API returns searchable data, validation errors and missing identities without exposing files", async () => {
    const api = createCatalogApi();
    const server = createServer(async (request, response) => {
        if (!(await api.handle(request, response))) {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    try {
        const response = await fetch(`${base}/api/catalog/search?q=433`);
        assert.equal(response.status, 200);
        assert.equal(
            (await response.json()).rows[0].name,
            "433 Eros (A898 PA)",
        );
        assert.equal(
            (await fetch(`${base}/api/catalog/search?q=ab`)).status,
            400,
        );
        assert.equal(
            (await fetch(`${base}/api/catalog/object/${"0".repeat(24)}`))
                .status,
            404,
        );
        assert.equal(
            (await fetch(`${base}/api/catalog/summary`, { method: "POST" }))
                .status,
            405,
        );
        assert.equal((await fetch(`${base}/data/catalog.sqlite`)).status, 404);
    } finally {
        api.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
