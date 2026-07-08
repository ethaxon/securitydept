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
import { type FrontendOidcModeCallbackResult } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
} from "@securitydept/token-set-context-client/orchestration";
import {
	selectTokenSetFrontendCallbackClientFromRegistry,
	type TokenSetCallbackClientGuard,
	type TokenSetCallbackClientQuery,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSnapshot,
	type TokenSetFrontendCallbackClient,
	type TokenSetFrontendCallbackClientFromRegistrySelectionSignal,
} from "@securitydept/token-set-context-client/registry";
import { TOKEN_SET_CLIENT_REGISTRY } from "../client-registry";

type FrontendCallbackResult =
	OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>;

@Component({
	selector: "sd-token-set-frontend-callback",
	standalone: true,
	template: "",
	exportAs: "sdTokenSetFrontendCallback",
})
export class TokenSetFrontendCallbackComponent {
	readonly clientQuery = input<TokenSetCallbackClientQuery | undefined>();
	readonly clientGuard =
		input<TokenSetCallbackClientGuard<TokenSetFrontendCallbackClient>>();
	readonly autoInitialize = input(true);

	private readonly environment = inject(ENVIRONMENT);
	private readonly registry = inject(TOKEN_SET_CLIENT_REGISTRY);
	private readonly destroyRef = inject(DestroyRef);
	private readonly selectionSource =
		createSignal<TokenSetFrontendCallbackClientFromRegistrySelectionSignal | null>(
			null,
		);
	private readonly selectionSignal = createComputed<
		TokenSetCallbackClientSelectionSnapshot<TokenSetFrontendCallbackClient>
	>(
		() =>
			this.selectionSource.get()?.get() ?? {
				status: ResourceStatus.Idle,
			},
	);

	readonly selection: Signal<
		TokenSetCallbackClientSelectionSnapshot<TokenSetFrontendCallbackClient>
	> = toNgSignal(this.selectionSignal, { requireSync: true });
	readonly resource = resourceFromSnapshots<FrontendCallbackResult>(() => {
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
	readonly state: Signal<ResourceSnapshot<FrontendCallbackResult>> = toNgSignal(
		this.resource,
		{ requireSync: true },
	);

	constructor() {
		this.destroyRef.onDestroy(() => this.resource.dispose());
		afterNextRender(() => {
			this.selectionSource.set(
				selectTokenSetFrontendCallbackClientFromRegistry({
					registry: this.registry,
					callbackUrl: this.environment.router?.currentUrl()?.toString() ?? "",
					clientQuery: this.clientQuery(),
					clientGuard: this.clientGuard(),
					initialize: this.autoInitialize(),
				}),
			);
		});
	}
}
