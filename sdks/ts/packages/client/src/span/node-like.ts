import { createSpanContextHost } from "./context-host";

export function createSpanContextHostForNodeLike() {
	return createSpanContextHost();
}
