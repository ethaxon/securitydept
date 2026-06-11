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
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetBackendCallbackClientFromRegistry,
	type TokenSetBackendCallbackClientFromRegistrySelection,
	TokenSetCallbackClientSelectionKind,
	TokenSetClientRegistryEntryStatus,
	TokenSetRegistryCallbackErrorCode,
	TokenSetRegistryCallbackErrorSource,
} from "@securitydept/token-set-context-client/registry";
import { TokenSetClientRegistryService } from "../client-registry.service";

type BackendCallbackResult =
	OidcModeCallbackHandlingResult<TokenSetAuthSnapshot>;

@Component({
	selector: "sd-token-set-backend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetBackendCallback",
})
export class TokenSetBackendCallbackComponent implements OnInit {
	readonly autoInitialize = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TokenSetClientRegistryService);
	private readonly destroyRef = inject(DestroyRef);
	private readonly selectionSignal =
		createSignal<TokenSetBackendCallbackClientFromRegistrySelection>({
			kind: TokenSetCallbackClientSelectionKind.NotApplicable,
		});

	readonly resource = resourceFromSnapshots<BackendCallbackResult>(() => {
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
				return record.client instanceof BackendOidcModeClient
					? record.client.callback.state.get()
					: {
							status: ResourceStatus.LoadingError,
							error: new ClientError({
								kind: ClientErrorKind.Configuration,
								code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch,
								message: `Client "${record.meta.clientKey}" is not a BackendOidcModeClient.`,
								source: TokenSetRegistryCallbackErrorSource,
							}),
						};
		}
	});
	readonly state: Signal<ResourceSnapshot<BackendCallbackResult>> = toNgSignal(
		this.resource,
		{ requireSync: true },
	);

	constructor() {
		this.destroyRef.onDestroy(() => this.resource.dispose());
	}

	ngOnInit(): void {
		this.selectionSignal.set(
			selectTokenSetBackendCallbackClientFromRegistry({
				registry: this.registry,
				callbackUrl: this.environment.router?.currentUrl()?.toString() ?? "",
			}),
		);
		if (this.autoInitialize()) {
			void this.initialize().catch(() => undefined);
		}
	}

	async initialize(): Promise<BackendOidcModeClient | null> {
		const selection = this.selectionSignal.get();
		return selection.kind === TokenSetCallbackClientSelectionKind.Selected
			? await selection.clientResolver()
			: null;
	}
}
