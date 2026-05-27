export function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
	if (
		(typeof value !== "object" && typeof value !== "function") ||
		value === null
	) {
		return false;
	}
	return typeof (value as { then?: unknown }).then === "function";
}
