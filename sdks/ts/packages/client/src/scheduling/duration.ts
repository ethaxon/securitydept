/**
 * Parse a human-readable duration string (for example `5m` or `300s`) into
 * milliseconds.
 */
export function parseDurationToMs(duration: string): number {
	const match = duration.match(/^(\d+(?:\.\d+)?)\s*(s|ms|m|h)$/);
	if (!match) {
		return 0;
	}
	const value = Number(match[1]);

	switch (match[2]) {
		case "ms":
			return value;
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		default:
			return 0;
	}
}
