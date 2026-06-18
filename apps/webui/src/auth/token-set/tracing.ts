import {
	createTraceTimelineStore,
	type DisposableTrait,
	ENVIRONMENT_TOKEN,
	type EventSubscriptionTrait,
	type FoundationEnvironment,
	INJECTOR_TOKEN,
	SecuritydeptDestroyRef,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
	type SpanTrait,
	SYMBOL_DISPOSE,
	type TraceTimelineStore,
	type TracingEvent,
	type TracingTrait,
} from "@securitydept/client";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "./config";

export class TokenSetTracingService implements DisposableTrait {
	readonly backendTimeline: TraceTimelineStore = createTraceTimelineStore();
	readonly frontendTimeline: TraceTimelineStore = createTraceTimelineStore();
	readonly tracing: TracingTrait;
	readonly backendHostSpan: SpanTrait;
	private readonly subscription: EventSubscriptionTrait;

	constructor(environment: FoundationEnvironment) {
		this.tracing = environment.tracing;
		this.backendHostSpan = environment.span.fork({
			attributes: {
				target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget,
				role: "host",
			},
		});
		this.subscription = environment.tracing.events.subscribe({
			next: (event) => this.record(event),
		});
	}

	dispose(): void {
		this.subscription.unsubscribe();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private record(event: TracingEvent): void {
		if (
			event.target === TOKEN_SET_BACKEND_MODE_CONFIG.tracing.clientTarget ||
			event.target === TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget
		) {
			this.backendTimeline.record(event);
			return;
		}
		if (event.target === TOKEN_SET_FRONTEND_MODE_CONFIG.tracing.clientTarget) {
			this.frontendTimeline.record(event);
		}
	}
}

export function provideTokenSetTracing(): readonly SecuritydeptProvider[] {
	return [
		{
			provide: TokenSetTracingService,
			useFactory: (
				environment: FoundationEnvironment,
				injector: SecuritydeptInjector,
			) => {
				const service = new TokenSetTracingService(environment);
				injector
					.get(SecuritydeptDestroyRef, null)
					?.onDestroy(() => service.dispose());
				return service;
			},
			deps: [ENVIRONMENT_TOKEN, INJECTOR_TOKEN],
		},
	];
}
