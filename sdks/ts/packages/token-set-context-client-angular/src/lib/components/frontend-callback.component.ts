import {
	Component,
	inject,
	input,
	type OnInit,
	type Signal,
} from "@angular/core";
import { ENVIRONMENT, toNgSignal } from "@securitydept/client-angular";
import {
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
	type TokenSetClientQueryOptions,
} from "@securitydept/token-set-context-client/registry";
import { TokenSetClientRegistryService } from "../client-registry.service";

@Component({
	selector: "sd-token-set-frontend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetFrontendCallback",
})
export class TokenSetFrontendCallbackComponent implements OnInit {
	readonly clientQuery = input<TokenSetClientQueryOptions | undefined>(
		undefined,
	);
	readonly autoHandle = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TokenSetClientRegistryService);
	private readonly controller = new FrontendOidcModeCallbackController({
		registry: () => this.registry,
		currentUrl: () => this.environment.router?.currentUrl()?.toString(),
		clientQuery: () => this.clientQuery(),
	});

	readonly state: Signal<FrontendOidcModeCallbackState> = toNgSignal(
		this.controller.state,
		{ initialValue: this.controller.state.get() },
	);

	ngOnInit(): void {
		if (this.autoHandle() && this.controller.isCallback()) {
			void this.controller.handle().catch(() => undefined);
		}
	}

	handle(): Promise<FrontendOidcModeCallbackResult> {
		return this.controller.handle();
	}
}
