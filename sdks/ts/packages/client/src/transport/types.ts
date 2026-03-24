import type { CancellationTokenTrait } from "../cancellation/types";

// --- Transport abstraction ---

/** Neutral HTTP request representation. */
export interface HttpRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
	cancellationToken?: CancellationTokenTrait;
}

/** Neutral HTTP response representation. */
export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	body?: unknown;
}

/** Transport protocol — decoupled from any specific HTTP client. */
export interface HttpTransport {
	execute(request: HttpRequest): Promise<HttpResponse>;
}
