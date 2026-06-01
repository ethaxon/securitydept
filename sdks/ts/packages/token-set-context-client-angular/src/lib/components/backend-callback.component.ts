import {
	Component,
	inject,
	input,
	type OnInit,
	type Signal,
} from "@angular/core";
import {
	type CompatFragmentParameters,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { ENVIRONMENT, toNgSignal } from "@securitydept/client-angular";
import {
	BackendOidcModeCallbackController,
	type BackendOidcModeCallbackResult,
	type BackendOidcModeCallbackState,
	type TokenSetClientQueryOptions,
} from "@securitydept/token-set-context-client/registry";
import { TokenSetClientRegistryService } from "../client-registry.service";

@Component({
	selector: "sd-token-set-backend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetBackendCallback",
})
export class TokenSetBackendCallbackComponent implements OnInit {
	readonly clientQuery = input.required<TokenSetClientQueryOptions>();
	readonly autoHandle = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TokenSetClientRegistryService);
	private compatFragmentPayload: CompatFragmentParameters | undefined;
	private readonly controller = new BackendOidcModeCallbackController({
		registry: () => this.registry,
		payload: () => this.readCompatFragmentPayload(),
		clientQuery: () => this.clientQuery(),
	});

	readonly state: Signal<BackendOidcModeCallbackState> = toNgSignal(
		this.controller.state,
		{ initialValue: this.controller.state.get() },
	);

	ngOnInit(): void {
		void this.initialize();
	}

	private async initialize(): Promise<void> {
		const router = this.environment.router;
		if (!router) {
			return;
		}

		const compatFragment = await takeCompatFragmentFromRouter(router);
		if (!compatFragment) {
			return;
		}
		this.compatFragmentPayload = compatFragment.parameters;

		if (this.autoHandle()) {
			void this.controller.handle().catch(() => undefined);
		}
	}

	handle(): Promise<BackendOidcModeCallbackResult> {
		return this.controller.handle();
	}

	private readCompatFragmentPayload(): CompatFragmentParameters {
		if (!this.compatFragmentPayload) {
			throw new Error(
				"[TokenSetBackendCallbackComponent] No compat fragment payload is available.",
			);
		}
		return this.compatFragmentPayload;
	}
}
