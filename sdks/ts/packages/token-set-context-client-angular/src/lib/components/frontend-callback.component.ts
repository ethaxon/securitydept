import {
	Component,
	DestroyRef,
	inject,
	input,
	type OnInit,
	type Signal,
} from "@angular/core";
import {
	ClientError,
	ClientErrorKind,
	createSignal,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { ENVIRONMENT, toNgSignal } from "@securitydept/client-angular";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetFrontendCallbackClientFromRegistry,
	TokenSetCallbackClientSelectionKind,
	type TokenSetClientQueryOptions,
	TokenSetClientRegistryEntryStatus,
	type TokenSetFrontendCallbackClientFromRegistrySelection,
	TokenSetRegistryCallbackErrorCode,
	TokenSetRegistryCallbackErrorSource,
} from "@securitydept/token-set-context-client/registry";
import { TokenSetClientRegistryService } from "../client-registry.service";

type FrontendCallbackResult =
	OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>;

@Component({
	selector: "sd-token-set-frontend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetFrontendCallback",
})
export class TokenSetFrontendCallbackComponent implements OnInit {
	readonly clientQuery = input<TokenSetClientQueryOptions | undefined>();
	readonly autoInitialize = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TokenSetClientRegistryService);
	private readonly destroyRef = inject(DestroyRef);
	private readonly selectionSignal =
		createSignal<TokenSetFrontendCallbackClientFromRegistrySelection>({
			kind: TokenSetCallbackClientSelectionKind.NotApplicable,
		});

	readonly resource = resourceFromSnapshots<FrontendCallbackResult>(() => {
		const selection = this.selectionSignal.get();
		if (selection.kind === TokenSetCallbackClientSelectionKind.NotApplicable) {
			return {
				status: ResourceStatus.Resolved,
				value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
			};
		}

		const record = selection.clientRecord.get();
		switch (record.status) {
			case TokenSetClientRegistryEntryStatus.Registered:
				return { status: ResourceStatus.Idle };
			case TokenSetClientRegistryEntryStatus.Initializing:
				return { status: ResourceStatus.Loading };
			case TokenSetClientRegistryEntryStatus.Failed:
				return {
					status: ResourceStatus.LoadingError,
					error: record.error,
				};
			case TokenSetClientRegistryEntryStatus.Ready:
				return record.client instanceof FrontendOidcModeClient
					? record.client.callback.state.get()
					: {
							status: ResourceStatus.LoadingError,
							error: new ClientError({
								kind: ClientErrorKind.Configuration,
								code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch,
								message: `Client "${record.meta.clientKey}" is not a FrontendOidcModeClient.`,
								source: TokenSetRegistryCallbackErrorSource,
							}),
						};
		}
	});
	readonly state: Signal<ResourceSnapshot<FrontendCallbackResult>> = toNgSignal(
		this.resource,
		{ requireSync: true },
	);

	constructor() {
		this.destroyRef.onDestroy(() => this.resource.dispose());
	}

	ngOnInit(): void {
		this.selectionSignal.set(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry: this.registry,
				callbackUrl: this.environment.router?.currentUrl()?.toString() ?? "",
				clientQuery: this.clientQuery(),
			}),
		);
		if (this.autoInitialize()) {
			void this.initialize().catch(() => undefined);
		}
	}

	async initialize(): Promise<FrontendOidcModeClient | null> {
		const selection = this.selectionSignal.get();
		return selection.kind === TokenSetCallbackClientSelectionKind.Selected
			? await selection.clientResolver()
			: null;
	}
}
