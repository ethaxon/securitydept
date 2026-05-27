import { type BaseTransportTrait, type ExternalTransportTrait } from "./types";

/**
 * Semantic narrowing from foundation/base transport to protocol/bootstrap
 * transport. This helper does not wrap or decorate behavior.
 */
export function createExternalTransportFromBase(
	baseTransport: BaseTransportTrait,
): ExternalTransportTrait {
	return baseTransport;
}
