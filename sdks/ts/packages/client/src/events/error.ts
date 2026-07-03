import { ClientError } from "../errors";

export type ClientErrorEvent =
	| { readonly error: ClientError }
	| { readonly payload: { readonly error: ClientError } };

export type ExtractClientErrorEvent<TEvent> = Extract<TEvent, ClientErrorEvent>;

export function isClientErrorEvent<TEvent>(
	event: TEvent,
): event is ExtractClientErrorEvent<TEvent> {
	if (typeof event !== "object" || event === null) {
		return false;
	}
	if ("error" in event && event.error instanceof ClientError) {
		return true;
	}
	return (
		"payload" in event &&
		typeof event.payload === "object" &&
		event.payload !== null &&
		"error" in event.payload &&
		event.payload.error instanceof ClientError
	);
}
