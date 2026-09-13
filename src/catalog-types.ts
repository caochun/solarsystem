import type { KeplerElements } from "./kepler";
export type DataCompleteness = "full-model" | "orbit-point" | "catalog-only" | "name-only";
export interface CatalogObject {
    id: string;
    name: string;
    orbit: KeplerElements | null;
    sourceCategory: string;
    categories: string[];
    /** How much local data is available for display and tracking. */
    dataStatus?: DataCompleteness;
}
