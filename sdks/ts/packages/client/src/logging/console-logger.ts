import type { LogEntry, LoggerTrait } from "./types";

/** Simple console-based logger implementation. */
export function createConsoleLogger(scope?: string): LoggerTrait {
	return {
		log(entry: LogEntry) {
			const prefix = entry.scope ?? scope ?? "securitydept";
			const label = `[${prefix}]`;

			switch (entry.level) {
				case "debug":
					console.debug(label, entry.message, entry.attributes ?? "");
					break;
				case "info":
					console.info(label, entry.message, entry.attributes ?? "");
					break;
				case "warn":
					console.warn(label, entry.message, entry.attributes ?? "");
					break;
				case "error":
					console.error(
						label,
						entry.message,
						entry.error ?? "",
						entry.attributes ?? "",
					);
					break;
			}
		},
	};
}
