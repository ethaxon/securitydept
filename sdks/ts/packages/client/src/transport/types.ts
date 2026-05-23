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

/** Neutral request executor trait. */
export interface BaseTransportTrait {
	execute(request: HttpRequest): Promise<HttpResponse>;
}

/**
 * External transport protocol — auth/runtime bootstrap and protocol traffic.
 */
export interface ExternalTransportTrait extends BaseTransportTrait {}

/**
 * Managed transport protocol — higher-level resource traffic that may be
 * decorated by auth-aware wrappers.
 */
export interface ManagedTransportTrait extends BaseTransportTrait {}
