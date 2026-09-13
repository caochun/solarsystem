import type { SolarScene } from "./scene";
import type { KeplerElements } from "./kepler";
import type { CatalogObject, DataCompleteness } from "./catalog-types";

type Row = KeplerElements & { name: string };
interface Category {
    id: string;
    name: string;
    total: number;
    displayed: number;
    skipped: number;
    sample: string;
    archive: string;
    archiveBytes: number;
}
interface SearchResult {
    rows: CatalogObject[];
    total: number;
    offset: number;
    limit: number;
}
const q = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
const resultStatus = (row: CatalogObject): DataCompleteness =>
    row.dataStatus ?? (row.orbit ? "orbit-point" : "catalog-only");
export async function catalogRequest<T>(
    path: string,
    signal?: AbortSignal,
): Promise<T> {
    const response = await fetch(
        `${import.meta.env.BASE_URL}api/catalog/${path}`,
        { signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
}
export async function initCatalogs(
    scene: SolarScene | null,
    initial: string | null,
    onChange: (category: string | null) => void,
    onFocus: (body: CatalogObject) => void,
) {
    const dialog = q<HTMLDialogElement>("catalog-dialog");
    q<HTMLButtonElement>("open-catalog").onclick = () => dialog.showModal();
    q<HTMLButtonElement>("catalog-shortcut").onclick = () => dialog.showModal();
    q<HTMLButtonElement>("close-catalog").onclick = () => dialog.close();
    const select = q<HTMLSelectElement>("catalog-category"),
        enabled = q<HTMLInputElement>("small-bodies"),
        object = q<HTMLSelectElement>("catalog-object"),
        input = q<HTMLInputElement>("catalog-search"),
        scope = q<HTMLSelectElement>("catalog-scope"),
        focus = q<HTMLButtonElement>("catalog-focus");
    let categories: Category[] = [],
        samples: Row[] = [],
        results: CatalogObject[] = [],
        loadController: AbortController | null = null,
        searchController: AbortController | null = null,
        offset = 0,
        total = 0,
        limit = 40,
        timer: ReturnType<typeof setTimeout>;
    function showObject() {
        const row = results[Number(object.value)];
        const orbit = row?.orbit;
        focus.disabled = !orbit;
        q("catalog-object-info").textContent = !row
            ? "没有匹配记录"
            : !orbit
              ? `${row.name}：原始轨道非椭圆或参数不完整，暂不支持定位；原记录保留在完整下载中。`
              : `半长轴 ${orbit.a.toFixed(3)} AU · 偏心率 ${orbit.e.toFixed(4)} · 公转约 ${(orbit.period / 365.25).toFixed(2)} 年 · 历元 ${new Date(orbit.epoch).toISOString().slice(0, 10)}`;
    }
    function showRows() {
        object.replaceChildren(
            ...results.map((row, i) => new Option(row.name, String(i))),
        );
        q<HTMLButtonElement>("catalog-prev").disabled = offset === 0;
        q<HTMLButtonElement>("catalog-next").disabled =
            offset + limit >= total || offset >= 10000;
        showObject();
    }
    async function search(reset = true) {
        clearTimeout(timer);
        searchController?.abort();
        const request = (searchController = new AbortController());
        if (reset) offset = 0;
        results = [];
        total = 0;
        showRows();
        const keyword = input.value.trim();
        if (!keyword) {
            results = samples
                .slice(0, 100)
                .map(({ name, ...orbit }) => ({
                    id: "",
                    name,
                    orbit,
                    sourceCategory: select.value,
                    categories: [select.value],
                    dataStatus: "orbit-point",
                }));
            q("catalog-search-status").textContent =
                "下方为当前类别的部分抽样记录。输入名称、编号或临时编号，查询完整目录。";
            showRows();
            return;
        }
        if (keyword.length < 3 && !/^\d{1,2}$/.test(keyword)) {
            q("catalog-search-status").textContent =
                "名称至少输入 3 个字符；小行星编号可直接输入。";
            return;
        }
        q("catalog-search-status").textContent = "正在查询完整目录…";
        try {
            const params = new URLSearchParams({
                q: keyword,
                offset: String(offset),
                category: scope.value === "all" ? "" : select.value,
            });
            const result = await catalogRequest<SearchResult>(
                `search?${params}`,
                request.signal,
            );
            if (request.signal.aborted) return;
            results = result.rows.map((row) => ({
                ...row,
                dataStatus: resultStatus(row),
            }));
            total = result.total;
            limit = result.limit;
            q("catalog-search-status").textContent =
                `完整目录匹配 ${total.toLocaleString("zh-CN")} 个对象${total ? ` · 第 ${offset + 1}–${offset + results.length} 条` : ""}`;
            showRows();
        } catch (error) {
            if (!request.signal.aborted)
                q("catalog-search-status").textContent =
                    `完整目录查询失败：${String(error)}。可重新搜索或下载 CSV。`;
        }
    }
    async function load() {
        clearTimeout(timer);
        searchController?.abort();
        loadController?.abort();
        scene?.setSmallBodies([]);
        samples = [];
        results = [];
        total = 0;
        offset = 0;
        showRows();
        const category = categories.find((c) => c.id === select.value);
        if (!category) return;
        const download = q<HTMLAnchorElement>("catalog-download");
        download.href = `${import.meta.env.BASE_URL}${category.archive}`;
        download.download = `${category.id}.csv.gz`;
        download.textContent = `下载完整 CSV（${(category.archiveBytes / 1024 / 1024).toFixed(1)} MB，gzip）`;
        q("catalog-summary").textContent =
            `原始目录 ${category.total.toLocaleString("zh-CN")} 条记录；网页抽样 ${category.displayed.toLocaleString("zh-CN")} 条。${category.skipped ? ` ${category.skipped} 条非椭圆或不完整轨道保留在完整文件中，未绘制。` : ""}`;
        const request = (loadController = new AbortController());
        q("catalog-status").textContent = "正在读取本地目录…";
        try {
            const response = await fetch(
                `${import.meta.env.BASE_URL}${category.sample}`,
                { signal: request.signal },
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            samples = await response.json();
            if (request.signal.aborted) return;
            scene?.setSmallBodies(enabled.checked ? samples : []);
            q("catalog-status").textContent = enabled.checked
                ? `${category.name} · ${samples.length.toLocaleString("zh-CN")} 个抽样点`
                : "点云已隐藏";
            onChange(enabled.checked ? category.id : null);
            await search();
        } catch (error) {
            if (!request.signal.aborted) {
                q("catalog-status").textContent =
                    `目录加载失败，请重试：${String(error)}`;
                onChange(null);
            }
        }
    }
    input.addEventListener("input", () => {
        searchController?.abort();
        clearTimeout(timer);
        focus.disabled = true;
        timer = setTimeout(() => void search(), 250);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void search();
    });
    scope.addEventListener("change", () => void search());
    q("catalog-search-submit").onclick = () => void search();
    q("catalog-prev").onclick = () => {
        offset = Math.max(0, offset - limit);
        void search(false);
    };
    q("catalog-next").onclick = () => {
        offset += limit;
        void search(false);
    };
    object.addEventListener("change", showObject);
    select.addEventListener("change", load);
    enabled.addEventListener("change", () => {
        scene?.setSmallBodies(enabled.checked ? samples : []);
        const category = categories.find((c) => c.id === select.value);
        q("catalog-status").textContent = enabled.checked
            ? `${category?.name} · ${samples.length.toLocaleString("zh-CN")} 个抽样点`
            : "点云已隐藏";
        onChange(enabled.checked ? select.value : null);
    });
    q("catalog-retry").onclick = () => void load();
    focus.onclick = async () => {
        let row = results[Number(object.value)];
        if (!row?.orbit) return;
        focus.disabled = true;
        try {
            if (!row.id) {
                const found = await catalogRequest<SearchResult>(
                    `search?${new URLSearchParams({ q: row.name, category: select.value })}`,
                );
                row = found.rows.find((r) => r.name === row.name)!;
                if (!row) throw new Error("索引中未找到该记录，请重建目录索引");
            }
            onFocus(row);
            dialog.close();
        } catch (error) {
            q("catalog-search-status").textContent = String(error);
        } finally {
            focus.disabled = !results[Number(object.value)]?.orbit;
        }
    };
    try {
        const response = await fetch(
            `${import.meta.env.BASE_URL}catalogs/summary.json`,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        categories = (await response.json()).categories;
        select.replaceChildren(
            ...categories.map((c) => new Option(c.name, c.id)),
        );
        select.value = categories.some((c) => c.id === initial)
            ? initial!
            : "main_belt_asteroid";
        enabled.checked = Boolean(initial);
        await load();
    } catch (error) {
        q("catalog-status").textContent = `目录索引不可用：${String(error)}`;
    }
    void catalogRequest<{ uniqueObjects: number; categoryRecords: number }>(
        "summary",
    )
        .then((summary) => {
            q("catalog-index-info").textContent =
                `完整搜索覆盖 ${summary.uniqueObjects.toLocaleString("zh-CN")} 个按名称去重的对象，来自 ${summary.categoryRecords.toLocaleString("zh-CN")} 条分类记录。`;
        })
        .catch(() => {
            q("catalog-index-info").textContent =
                "全量索引服务未就绪；抽样点云与完整 CSV 下载仍可使用。";
        });
}
