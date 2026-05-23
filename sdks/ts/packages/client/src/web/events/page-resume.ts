import {
	defer,
	distinctUntilChanged,
	filter,
	fromEventPattern,
	map,
	merge,
	type Observable,
} from "rxjs";
import type { EventStreamTrait } from "../../events/types";

export const PageResumeTriggerKind = {
	Visibility: "visibility",
	PageShow: "pageshow",
	Focus: "focus",
	Online: "online",
} as const;

export type PageResumeTriggerKind =
	(typeof PageResumeTriggerKind)[keyof typeof PageResumeTriggerKind];

export interface PageResumeEvent {
	trigger: PageResumeTriggerKind;
	persisted?: boolean;
}

export interface PageResumeDocumentTarget {
	addEventListener(type: "visibilitychange", handler: EventListener): void;
	removeEventListener(type: "visibilitychange", handler: EventListener): void;
	visibilityState: DocumentVisibilityState;
}

export interface PageResumeWindowTarget {
	addEventListener(
		type: "pageshow" | "focus" | "online",
		handler: EventListener,
	): void;
	removeEventListener(
		type: "pageshow" | "focus" | "online",
		handler: EventListener,
	): void;
}

export interface CreatePageResumeSourceOptions {
	documentTarget: PageResumeDocumentTarget | null | undefined;
	windowTarget: PageResumeWindowTarget | null | undefined;
}

export function createPageResumeSource(
	options: CreatePageResumeSourceOptions,
): EventStreamTrait<PageResumeEvent> {
	return defer(() => {
		const { documentTarget, windowTarget } = options;
		const streams: Observable<PageResumeEvent>[] = [];

		if (documentTarget) {
			streams.push(
				fromEventPattern<Event>(
					(handler) =>
						documentTarget.addEventListener("visibilitychange", handler),
					(handler) =>
						documentTarget.removeEventListener("visibilitychange", handler),
				).pipe(
					map(() => documentTarget.visibilityState),
					distinctUntilChanged(),
					filter((visibilityState) => visibilityState === "visible"),
					map(() => ({
						trigger: PageResumeTriggerKind.Visibility,
					})),
				),
			);
		}

		if (windowTarget) {
			streams.push(
				fromEventPattern<Event>(
					(handler) => windowTarget.addEventListener("pageshow", handler),
					(handler) => windowTarget.removeEventListener("pageshow", handler),
				).pipe(
					map((event) => ({
						trigger: PageResumeTriggerKind.PageShow,
						persisted: Boolean((event as PageTransitionEvent).persisted),
					})),
				),
			);
			streams.push(
				fromEventPattern<Event>(
					(handler) => windowTarget.addEventListener("focus", handler),
					(handler) => windowTarget.removeEventListener("focus", handler),
				).pipe(map(() => ({ trigger: PageResumeTriggerKind.Focus }))),
			);
			streams.push(
				fromEventPattern<Event>(
					(handler) => windowTarget.addEventListener("online", handler),
					(handler) => windowTarget.removeEventListener("online", handler),
				).pipe(map(() => ({ trigger: PageResumeTriggerKind.Online }))),
			);
		}

		return merge(...streams);
	});
}
