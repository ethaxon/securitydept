import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(SCRIPT_DIR, "../..");

export function resolveFromRoot(relativePath: string): string {
	return path.resolve(ROOT_DIR, relativePath);
}
