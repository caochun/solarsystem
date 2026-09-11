import type { KeplerElements } from "./kepler";
export interface CatalogObject {
    id: string;
    name: string;
    orbit: KeplerElements | null;
    sourceCategory: string;
    categories: string[];
}
