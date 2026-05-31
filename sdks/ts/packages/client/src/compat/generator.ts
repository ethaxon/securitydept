export async function* promisesToRacedAsyncGenerator<T>(
	promises: Promise<T>[],
): AsyncGenerator<T, void, unknown> {
	const pending = new Map(
		promises.map((promise, index) => [
			index,
			promise.then((value) => ({ value, index }) as const),
		]),
	);
	while (pending.size > 0) {
		const next = await Promise.race(pending.values());
		pending.delete(next.index);
		yield next.value;
	}
}
