import {
	afterNextRender,
	Component,
	DestroyRef,
	inject,
	input,
	type Signal,
} from "@angular/core";
import {
	createComputed,
	createSignal,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { ENVIRONMENT, toNgSignal } from "@securitydept/client-angular";
import { type BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetBackendCallbackClientFromRegistry,
	type TokenSetBackendCallbackClientFromRegistrySelectionSignal,
	type TokenSetCallbackClientQuery,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSnapshot,
} from "@securitydept/token-set-context-client/registry";
import { TOKEN_SET_CLIENT_REGISTRY } from "../client-registry";

type BackendCallbackResult =
	OidcModeCallbackHandlingResult<TokenSetAuthSnapshot>;

@Component({
	selector: "sd-token-set-backend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetBackendCallback",
})
export class TokenSetBackendCallbackComponent {
	readonly clientQuery = input<TokenSetCallbackClientQuery | undefined>();
	readonly autoInitialize = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TOKEN_SET_CLIENT_REGISTRY);
	private readonly destroyRef = inject(DestroyRef);
	private readonly selectionSource =
		createSignal<TokenSetBackendCallbackClientFromRegistrySelectionSignal | null>(
			null,
		);
	private readonly selectionSignal = createComputed<
		TokenSetCallbackClientSelectionSnapshot<BackendOidcModeClient>
	>(
		() =>
			this.selectionSource.get()?.get() ?? {
				status: ResourceStatus.Idle,
			},
	);

	readonly selection: Signal<
		TokenSetCallbackClientSelectionSnapshot<BackendOidcModeClient>
	> = toNgSignal(this.selectionSignal, { requireSync: true });
	readonly resource = resourceFromSnapshots<BackendCallbackResult>(() => {
		const selection = this.selectionSignal.get();
		switch (selection.status) {
			case ResourceStatus.Idle:
				return { status: ResourceStatus.Idle };
			case ResourceStatus.Loading:
				return { status: ResourceStatus.Loading };
			case ResourceStatus.LoadingError:
				return selection;
			case ResourceStatus.Resolved:
				return selection.value.kind ===
					TokenSetCallbackClientSelectionKind.NotApplicable
					? {
							status: ResourceStatus.Resolved,
							value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
						}
					: selection.value.client.callback.state.get();
		}
	});
	readonly state: Signal<ResourceSnapshot<BackendCallbackResult>> = toNgSignal(
		this.resource,
		{ requireSync: true },
	);

	constructor() {
		this.destroyRef.onDestroy(() => this.resource.dispose());
		afterNextRender(() => {
			this.selectionSource.set(
				selectTokenSetBackendCallbackClientFromRegistry({
					registry: this.registry,
					callbackUrl: this.environment.router?.currentUrl()?.toString() ?? "",
					clientQuery: this.clientQuery(),
					initialize: this.autoInitialize(),
				}),
			);
		});
	}
}
