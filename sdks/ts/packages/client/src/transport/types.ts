import { type as defineType } from "arktype";
import { type CancellationTokenTrait } from "../cancellation/types";
import { SecuritydeptInjectionToken } from "../injection";

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

export type HttpResponseJsonBody = Record<string, unknown>;

/** Neutral request executor trait. */
export interface BaseTransportTrait {
	execute(request: HttpRequest): Promise<HttpResponse>;
}

export const BaseTransportTraitSchema = defineType({
	execute: "Function",
});

export const TRANSPORT_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<BaseTransportTrait>("TRANSPORT_TRAIT_TOKEN");
