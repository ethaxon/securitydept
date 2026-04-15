import type {
	CancellationTokenSourceTrait,
	UserRecovery as UserRecoveryType,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	UserRecovery,
} from "@securitydept/client";
import type { AuthStateSnapshot } from "@securitydept/token-set-context-client/backend-oidc-mode";
import type { BackendOidcModeBootstrapSource as BackendOidcModeBootstrapSourceType } from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	BackendOidcModeBootstrapSource,
	resetBackendOidcModeBrowserState,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	useTokenSetAuthService,
	useTokenSetAuthState,
} from "@securitydept/token-set-context-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { TOKEN_SET_CLIENT_KEY } from "@/App";
import type {
	AuthEntry,
	CreateBasicEntryResponse,
	CreateTokenResponse,
} from "@/api/entries";
import type { Group } from "@/api/groups";
import {
	assessPropagationProbeResult,
	createBasicEntryWithTokenSet,
	createTokenEntryWithTokenSet,
	DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET,
	DEFAULT_PROPAGATION_PROBE_PATH,
	probeForwardAuthBoundaryWithTokenSet,
	probeForwardAuthWithBasicEntry,
	probeForwardAuthWithEntryToken,
	probePropagationRouteWithTokenSet,
} from "@/api/tokenSet";
import { Layout } from "@/components/layout/Layout";
import {
	tokenSetAppQueryKeys,
	useCreateGroupMutation,
	useTokenSetEntriesQuery,
	useTokenSetGroupsQuery,
} from "@/hooks/useTokenSetQueries";
import {
	type BackendOidcModeReactClient,
	tokenSetTraceTimeline,
} from "@/lib/tokenSetClient";
import {
	createTokenSetAppTraceRecorder,
	readTokenSetTraceErrorAttributes,
} from "@/routes/tokenSet/appTrace";
import { TraceTimelineSection } from "@/routes/tokenSet/TraceTimelineSection";

const BootstrapStatusKind = {
	Booting: "booting",
	Ready: "ready",
	Error: "error",
} as const;

type BootstrapStatus =
	| { kind: typeof BootstrapStatusKind.Booting }
	| {
			kind: typeof BootstrapStatusKind.Ready;
			source: BackendOidcModeBootstrapSourceType;
	  }
	| { kind: typeof BootstrapStatusKind.Error; message: string };

const MutationStatusKind = {
	Idle: "idle",
	Loading: "loading",
	Created: "created",
	Cancelled: "cancelled",
	Error: "error",
} as const;
type MutationStatus =
	| { kind: typeof MutationStatusKind.Idle }
	| { kind: typeof MutationStatusKind.Loading }
	| { kind: typeof MutationStatusKind.Created; entryName: string }
	| { kind: typeof MutationStatusKind.Cancelled }
	| {
			kind: typeof MutationStatusKind.Error;
			message: string;
			recovery: UserRecoveryType;
	  };

const ForwardAuthCredential = {
	DashboardBearer: "dashboard_bearer",
	TokenEntry: "token_entry",
	BasicEntry: "basic_entry",
} as const;
type ForwardAuthCredential =
	(typeof ForwardAuthCredential)[keyof typeof ForwardAuthCredential];

const ForwardAuthStatusKind = {
	Idle: "idle",
	Loading: "loading",
	Authenticated: "authenticated",
	Unauthorized: "unauthorized",
	Cancelled: "cancelled",
	Error: "error",
} as const;
type ForwardAuthStatus =
	| { kind: typeof ForwardAuthStatusKind.Idle }
	| {
			kind: typeof ForwardAuthStatusKind.Loading;
			credential: ForwardAuthCredential;
	  }
	| {
			kind: typeof ForwardAuthStatusKind.Authenticated;
			credential: ForwardAuthCredential;
			entryName: string | null;
	  }
	| {
			kind: typeof ForwardAuthStatusKind.Unauthorized;
			credential: ForwardAuthCredential;
			challenge: string | null;
	  }
	| {
			kind: typeof ForwardAuthStatusKind.Cancelled;
			credential: ForwardAuthCredential;
	  }
	| {
			kind: typeof ForwardAuthStatusKind.Error;
			credential: ForwardAuthCredential | null;
			message: string;
			recovery: UserRecoveryType;
	  };

const PropagationStatusKind = {
	Idle: "idle",
	Loading: "loading",
	Ready: "ready",
	Cancelled: "cancelled",
	Error: "error",
} as const;
type PropagationStatus =
	| { kind: typeof PropagationStatusKind.Idle }
	| { kind: typeof PropagationStatusKind.Loading }
	| {
			kind: typeof PropagationStatusKind.Ready;
			status: number;
			summary: string;
			configStatus: string | null;
			recommendedConfigSnippet: string | null;
	  }
	| { kind: typeof PropagationStatusKind.Cancelled }
	| {
			kind: typeof PropagationStatusKind.Error;
			message: string;
			recovery: UserRecoveryType;
	  };

const BusyActionKind = {
	Refresh: "refresh",
	Clear: "clear",
} as const;
type BusyActionKind = (typeof BusyActionKind)[keyof typeof BusyActionKind];

interface LatestBasicEntryCredential {
	entry: AuthEntry;
	username: string;
	password: string;
	groupName: string;
}

const DEFAULT_PROPAGATION_DIRECTIVE =
	"by=dashboard;for=local-health;host=localhost:7021;proto=http";

// A token cell that shows a truncated preview and expands on demand.
function CollapsibleTokenCell({
	label,
	value,
}: {
	label: string;
	value: string | null | undefined;
}) {
	const [open, setOpen] = useState(false);
	const toggle = useCallback(() => setOpen((v) => !v), []);

	const preview =
		value && value.length > 24
			? `${value.slice(0, 12)}…${value.slice(-8)}`
			: (value ?? "Unavailable");

	return (
		<div className="min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
					{label}
				</p>
				{value && (
					<button
						type="button"
						onClick={toggle}
						className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					>
						{open ? "Collapse" : "Expand"}
					</button>
				)}
			</div>
			{open ? (
				<p className="mt-2 break-all font-mono text-sm">{value}</p>
			) : (
				<p className="mt-2 truncate font-mono text-sm text-zinc-500 dark:text-zinc-400">
					{preview}
				</p>
			)}
		</div>
	);
}

function readMetadata(snapshot: AuthStateSnapshot | null): string {
	if (!snapshot) {
		return "{}";
	}
	return JSON.stringify(snapshot.metadata, null, 2);
}

function formatEntryGroups(entry: AuthEntry): string {
	if (entry.group_ids.length === 0) {
		return "No groups";
	}
	return entry.group_ids.join(", ");
}

function isCancelledClientError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"kind" in error &&
		error.kind === ClientErrorKind.Cancelled
	);
}

function readErrorDetails(
	error: unknown,
	fallback: string,
): { message: string; recovery: UserRecovery } {
	if (error instanceof ClientError) {
		const suffix =
			error.recovery !== UserRecovery.None
				? ` (${error.code}; recovery: ${error.recovery})`
				: ` (${error.code})`;
		return {
			message: `${error.message}${suffix}`,
			recovery: error.recovery,
		};
	}

	if (error instanceof Error) {
		return {
			message: error.message,
			recovery: UserRecovery.None,
		};
	}

	return {
		message: fallback,
		recovery: UserRecovery.None,
	};
}

function describeForwardAuthStatus(status: ForwardAuthStatus): string {
	switch (status.kind) {
		case ForwardAuthStatusKind.Idle:
			return "Load groups, then compare dashboard bearer, generated token entry, and generated basic entry against the same forward-auth route.";
		case ForwardAuthStatusKind.Loading:
			if (status.credential === ForwardAuthCredential.DashboardBearer) {
				return "Probing forward-auth with the dashboard token-set bearer...";
			}
			if (status.credential === ForwardAuthCredential.TokenEntry) {
				return "Probing forward-auth with the generated token entry credential...";
			}
			return "Probing forward-auth with the generated basic entry credential...";
		case ForwardAuthStatusKind.Authenticated:
			return status.entryName
				? `Forward-auth accepted the credential as ${status.entryName}.`
				: "Forward-auth accepted the credential.";
		case ForwardAuthStatusKind.Unauthorized:
			if (status.credential === ForwardAuthCredential.DashboardBearer) {
				return "Expected boundary: dashboard bearer authenticates dashboard APIs, but forward-auth validates group-scoped entry credentials.";
			}
			return "The generated downstream credential was rejected for this group.";
		case ForwardAuthStatusKind.Cancelled:
			return "Forward-auth probe was cancelled.";
		case ForwardAuthStatusKind.Error:
			return status.message;
	}
}

function describePropagationStatus(status: PropagationStatus): string {
	switch (status.kind) {
		case PropagationStatusKind.Idle:
			return "Probe the real `/api/propagation/*` path with a dashboard bearer and explicit propagation directive, then inspect what the current server config actually enables.";
		case PropagationStatusKind.Loading:
			return "Probing propagation forwarding route...";
		case PropagationStatusKind.Ready:
			return status.summary;
		case PropagationStatusKind.Cancelled:
			return "Propagation probe was cancelled.";
		case PropagationStatusKind.Error:
			return status.message;
	}
}

function readMutationStatusText(status: MutationStatus, label: string): string {
	if (status.kind === MutationStatusKind.Idle) {
		return `No ${label} mutation has been issued yet.`;
	}
	if (status.kind === MutationStatusKind.Created) {
		return `Created ${status.entryName}.`;
	}
	return `Status: ${status.kind}`;
}

export function TokenSetPage() {
	const traceTimeline = tokenSetTraceTimeline;
	const recordAppTrace = useMemo(
		() => createTokenSetAppTraceRecorder(traceTimeline),
		[],
	);

	// --- React canonical consumer path ---
	// State subscription via canonical hook (replaces manual useSyncExternalStore).
	// Client access via service for business operations.
	const service = useTokenSetAuthService(TOKEN_SET_CLIENT_KEY);
	const state = useTokenSetAuthState(
		TOKEN_SET_CLIENT_KEY,
	) as AuthStateSnapshot | null;

	// The service's client is a Proxy over BackendOidcModeClient that
	// satisfies both ReactClient and the full BackendOidcModeClient surface.
	// Narrow to BackendOidcModeReactClient so downstream code can call
	// authorizationHeader(), refresh(), authorizeUrl(), etc.
	const client = service.client as BackendOidcModeReactClient;

	const traceEvents = useSyncExternalStore(
		(listener) => traceTimeline.subscribe(listener),
		() => traceTimeline.get(),
	);

	const createTokenEntryRequestRef =
		useRef<CancellationTokenSourceTrait | null>(null);
	const createBasicEntryRequestRef =
		useRef<CancellationTokenSourceTrait | null>(null);
	const forwardAuthRequestRef = useRef<CancellationTokenSourceTrait | null>(
		null,
	);
	const propagationRequestRef = useRef<CancellationTokenSourceTrait | null>(
		null,
	);
	const [bootstrap, setBootstrap] = useState<BootstrapStatus>({
		kind: BootstrapStatusKind.Booting,
	});
	const [busyAction, setBusyAction] = useState<BusyActionKind | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// --- React Query read paths (replaces imperative loadGroups / loadEntries) ---
	const queryClient = useQueryClient();
	const groupsQuery = useTokenSetGroupsQuery(client);
	const entriesQuery = useTokenSetEntriesQuery(client);
	const protectedGroups = groupsQuery.data ?? [];

	// --- React Query mutation paths ---
	const createGroupMutation = useCreateGroupMutation(client);
	const protectedEntries = entriesQuery.data ?? [];
	const [selectedGroupId, setSelectedGroupId] = useState("");
	const [newGroupName, setNewGroupName] = useState("");
	const [selectedGroupEntryIds, setSelectedGroupEntryIds] = useState<string[]>(
		[],
	);
	const [newTokenEntryName, setNewTokenEntryName] = useState("");
	const [newBasicEntryName, setNewBasicEntryName] = useState("");
	const [newBasicEntryUsername, setNewBasicEntryUsername] = useState("");
	const [newBasicEntryPassword, setNewBasicEntryPassword] = useState("");

	const [tokenEntryStatus, setTokenEntryStatus] = useState<MutationStatus>({
		kind: MutationStatusKind.Idle,
	});
	const [basicEntryStatus, setBasicEntryStatus] = useState<MutationStatus>({
		kind: MutationStatusKind.Idle,
	});
	const [latestGeneratedEntry, setLatestGeneratedEntry] =
		useState<CreateTokenResponse | null>(null);
	const [latestCreatedGroup, setLatestCreatedGroup] = useState<Group | null>(
		null,
	);
	const [latestCreatedGroupMembers, setLatestCreatedGroupMembers] = useState<
		string[]
	>([]);
	const [latestGeneratedGroupName, setLatestGeneratedGroupName] = useState<
		string | null
	>(null);
	const [latestBasicEntryCredential, setLatestBasicEntryCredential] =
		useState<LatestBasicEntryCredential | null>(null);
	const [forwardAuthStatus, setForwardAuthStatus] = useState<ForwardAuthStatus>(
		{
			kind: ForwardAuthStatusKind.Idle,
		},
	);
	const [propagationDirective, setPropagationDirective] = useState(
		DEFAULT_PROPAGATION_DIRECTIVE,
	);
	const [propagationPath, setPropagationPath] = useState(
		DEFAULT_PROPAGATION_PROBE_PATH,
	);
	const [propagationStatus, setPropagationStatus] = useState<PropagationStatus>(
		{
			kind: PropagationStatusKind.Idle,
		},
	);

	const groupOptions = protectedGroups;
	const selectedGroup =
		groupOptions.find((group) => group.id === selectedGroupId) ?? null;

	useEffect(() => {
		if (groupOptions.length === 0) {
			setSelectedGroupId("");
			return;
		}

		if (!groupOptions.some((group) => group.id === selectedGroupId)) {
			setSelectedGroupId(groupOptions[0]?.id ?? "");
		}
	}, [groupOptions, selectedGroupId]);

	useEffect(() => {
		setSelectedGroupEntryIds((current) =>
			current.filter((entryId) =>
				protectedEntries.some((entry) => entry.id === entryId),
			),
		);
	}, [protectedEntries]);

	// Bootstrap readiness — driven by the provider's auto-restore.
	// The service.restorePromise tracks the full browser bootstrap
	// (fragment capture + callback + persistent restore), so we just
	// await it and update the page-local bootstrap status.
	useEffect(() => {
		let active = true;

		const restorePromise = service.restorePromise;
		if (restorePromise) {
			void restorePromise
				.then((snapshot) => {
					if (!active) return;
					setBootstrap({
						kind: BootstrapStatusKind.Ready,
						source: snapshot
							? (BackendOidcModeBootstrapSource.Restore as BackendOidcModeBootstrapSourceType)
							: (BackendOidcModeBootstrapSource.Empty as BackendOidcModeBootstrapSourceType),
					});
				})
				.catch((error: unknown) => {
					if (!active) return;
					setBootstrap({
						kind: BootstrapStatusKind.Error,
						message:
							error instanceof Error
								? error.message
								: "Token-set bootstrap failed",
					});
				});
		} else {
			// No restore promise means auto-restore is disabled or already done.
			setBootstrap({
				kind: BootstrapStatusKind.Ready,
				source: state
					? (BackendOidcModeBootstrapSource.Restore as BackendOidcModeBootstrapSourceType)
					: (BackendOidcModeBootstrapSource.Empty as BackendOidcModeBootstrapSourceType),
			});
		}

		return () => {
			active = false;
			forwardAuthRequestRef.current = null;
			propagationRequestRef.current = null;
			// Client lifecycle is now owned by the provider — no manual dispose.
		};
	}, [service, state]);

	async function handleRefresh() {
		setBusyAction(BusyActionKind.Refresh);
		setActionError(null);
		try {
			await client.refresh();
		} catch (error) {
			setActionError(readErrorDetails(error, "Token refresh failed").message);
		} finally {
			setBusyAction(null);
		}
	}

	async function handleClear() {
		setBusyAction(BusyActionKind.Clear);
		setActionError(null);
		createTokenEntryRequestRef.current?.cancel();
		createBasicEntryRequestRef.current?.cancel();
		forwardAuthRequestRef.current?.cancel();
		propagationRequestRef.current?.cancel();
		createTokenEntryRequestRef.current = null;
		createBasicEntryRequestRef.current = null;
		forwardAuthRequestRef.current = null;
		propagationRequestRef.current = null;

		try {
			await resetBackendOidcModeBrowserState(client);
			setBootstrap({
				kind: BootstrapStatusKind.Ready,
				source: BackendOidcModeBootstrapSource.Empty,
			});
			// Reset React Query caches — removes cached data and resets to initial state.
			void queryClient.resetQueries({
				queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
			});
			void queryClient.resetQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			setSelectedGroupId("");
			setNewGroupName("");
			setSelectedGroupEntryIds([]);
			setNewTokenEntryName("");
			setNewBasicEntryName("");
			setNewBasicEntryUsername("");
			setNewBasicEntryPassword("");
			createGroupMutation.reset();
			setTokenEntryStatus({ kind: MutationStatusKind.Idle });
			setBasicEntryStatus({ kind: MutationStatusKind.Idle });
			setLatestGeneratedEntry(null);
			setLatestCreatedGroup(null);
			setLatestCreatedGroupMembers([]);
			setLatestGeneratedGroupName(null);
			setLatestBasicEntryCredential(null);
			setForwardAuthStatus({ kind: ForwardAuthStatusKind.Idle });
			setPropagationDirective(DEFAULT_PROPAGATION_DIRECTIVE);
			setPropagationPath(DEFAULT_PROPAGATION_PROBE_PATH);
			setPropagationStatus({ kind: PropagationStatusKind.Idle });
		} catch (error) {
			setActionError(
				readErrorDetails(error, "Failed to clear token-set state").message,
			);
		} finally {
			setBusyAction(null);
		}
	}

	function toggleSelectedGroupEntryId(entryId: string) {
		setSelectedGroupEntryIds((current) =>
			current.includes(entryId)
				? current.filter((candidate) => candidate !== entryId)
				: [...current, entryId],
		);
	}

	async function handleCreateGroup() {
		if (!newGroupName.trim() || selectedGroupEntryIds.length === 0) {
			recordAppTrace("token_set.app.groups.create.validation_failed", {
				groupNameProvided: newGroupName.trim().length > 0,
				selectedEntryCount: selectedGroupEntryIds.length,
			});
			return;
		}

		const selectedEntryNames = protectedEntries
			.filter((entry) => selectedGroupEntryIds.includes(entry.id))
			.map((entry) => entry.name);

		recordAppTrace("token_set.app.groups.create.started", {
			groupName: newGroupName.trim(),
			selectedEntryCount: selectedGroupEntryIds.length,
		});

		try {
			const result = await createGroupMutation.mutateAsync({
				name: newGroupName.trim(),
				entry_ids: selectedGroupEntryIds,
			});

			// Page-local side effects on success (form reset, latest-created display).
			setLatestCreatedGroup(result);
			setLatestCreatedGroupMembers(selectedEntryNames);
			setNewGroupName("");
			setSelectedGroupEntryIds([]);
			setSelectedGroupId(result.id);
			recordAppTrace("token_set.app.groups.create.succeeded", {
				groupId: result.id,
				groupName: result.name,
				selectedEntryCount: selectedEntryNames.length,
			});
			// Post-mutation invalidation is handled by useCreateGroupMutation.onSuccess.
		} catch (error) {
			recordAppTrace("token_set.app.groups.create.failed", {
				groupName: newGroupName.trim(),
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to create group via token-set",
				),
			});
			// Error state is owned by createGroupMutation (mutation.error / mutation.isError).
		}
	}

	async function handleCreateTokenEntry() {
		if (!selectedGroup || !newTokenEntryName.trim()) {
			setTokenEntryStatus({
				kind: MutationStatusKind.Error,
				message: "Select a group and provide a token entry name first.",
				recovery: UserRecovery.None,
			});
			recordAppTrace("token_set.app.entries.token.create.validation_failed", {
				hasGroup: selectedGroup !== null,
				entryNameProvided: newTokenEntryName.trim().length > 0,
			});
			return;
		}

		if (createTokenEntryRequestRef.current) {
			recordAppTrace("token_set.app.entries.token.create.cancel_requested", {
				reason: "superseded",
			});
		}
		createTokenEntryRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		createTokenEntryRequestRef.current = cancellation;
		setTokenEntryStatus({ kind: MutationStatusKind.Loading });
		recordAppTrace("token_set.app.entries.token.create.started", {
			entryName: newTokenEntryName.trim(),
			groupId: selectedGroup.id,
			groupName: selectedGroup.name,
		});

		try {
			const result = await createTokenEntryWithTokenSet(
				client,
				{
					name: newTokenEntryName.trim(),
					group_ids: [selectedGroup.id],
				},
				{
					cancellationToken: cancellation.token,
				},
			);
			if (createTokenEntryRequestRef.current !== cancellation) {
				return;
			}

			setLatestGeneratedEntry(result);
			setLatestGeneratedGroupName(selectedGroup.name);
			setNewTokenEntryName("");
			setTokenEntryStatus({
				kind: MutationStatusKind.Created,
				entryName: result.entry.name,
			});
			recordAppTrace("token_set.app.entries.token.create.succeeded", {
				entryId: result.entry.id,
				entryName: result.entry.name,
				groupId: selectedGroup.id,
				groupName: selectedGroup.name,
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
		} catch (error) {
			if (createTokenEntryRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setTokenEntryStatus({ kind: MutationStatusKind.Cancelled });
				recordAppTrace("token_set.app.entries.token.create.cancelled", {
					entryName: newTokenEntryName.trim(),
					groupId: selectedGroup.id,
					groupName: selectedGroup.name,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to create token entry via token-set",
			);
			setTokenEntryStatus({
				kind: MutationStatusKind.Error,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.entries.token.create.failed", {
				entryName: newTokenEntryName.trim(),
				groupId: selectedGroup.id,
				groupName: selectedGroup.name,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to create token entry via token-set",
				),
			});
		} finally {
			if (createTokenEntryRequestRef.current === cancellation) {
				createTokenEntryRequestRef.current = null;
			}
		}
	}

	async function handleCreateBasicEntry() {
		if (
			!selectedGroup ||
			!newBasicEntryName.trim() ||
			!newBasicEntryUsername.trim() ||
			!newBasicEntryPassword
		) {
			setBasicEntryStatus({
				kind: MutationStatusKind.Error,
				message:
					"Select a group and provide name, username, and password first.",
				recovery: UserRecovery.None,
			});
			recordAppTrace("token_set.app.entries.basic.create.validation_failed", {
				hasGroup: selectedGroup !== null,
				entryNameProvided: newBasicEntryName.trim().length > 0,
				usernameProvided: newBasicEntryUsername.trim().length > 0,
				passwordProvided: newBasicEntryPassword.length > 0,
			});
			return;
		}

		if (createBasicEntryRequestRef.current) {
			recordAppTrace("token_set.app.entries.basic.create.cancel_requested", {
				reason: "superseded",
			});
		}
		createBasicEntryRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		createBasicEntryRequestRef.current = cancellation;
		setBasicEntryStatus({ kind: MutationStatusKind.Loading });
		recordAppTrace("token_set.app.entries.basic.create.started", {
			entryName: newBasicEntryName.trim(),
			username: newBasicEntryUsername.trim(),
			groupId: selectedGroup.id,
			groupName: selectedGroup.name,
		});

		try {
			const result: CreateBasicEntryResponse =
				await createBasicEntryWithTokenSet(
					client,
					{
						name: newBasicEntryName.trim(),
						username: newBasicEntryUsername.trim(),
						password: newBasicEntryPassword,
						group_ids: [selectedGroup.id],
					},
					{
						cancellationToken: cancellation.token,
					},
				);
			if (createBasicEntryRequestRef.current !== cancellation) {
				return;
			}

			setLatestBasicEntryCredential({
				entry: result.entry,
				username: newBasicEntryUsername.trim(),
				password: newBasicEntryPassword,
				groupName: selectedGroup.name,
			});
			setNewBasicEntryName("");
			setNewBasicEntryUsername("");
			setNewBasicEntryPassword("");
			setBasicEntryStatus({
				kind: MutationStatusKind.Created,
				entryName: result.entry.name,
			});
			recordAppTrace("token_set.app.entries.basic.create.succeeded", {
				entryId: result.entry.id,
				entryName: result.entry.name,
				groupId: selectedGroup.id,
				groupName: selectedGroup.name,
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
		} catch (error) {
			if (createBasicEntryRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setBasicEntryStatus({ kind: MutationStatusKind.Cancelled });
				recordAppTrace("token_set.app.entries.basic.create.cancelled", {
					entryName: newBasicEntryName.trim(),
					groupId: selectedGroup.id,
					groupName: selectedGroup.name,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to create basic entry via token-set",
			);
			setBasicEntryStatus({
				kind: MutationStatusKind.Error,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.entries.basic.create.failed", {
				entryName: newBasicEntryName.trim(),
				groupId: selectedGroup.id,
				groupName: selectedGroup.name,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to create basic entry via token-set",
				),
			});
		} finally {
			if (createBasicEntryRequestRef.current === cancellation) {
				createBasicEntryRequestRef.current = null;
			}
		}
	}

	async function handleProbeDashboardBearer() {
		const groupName = selectedGroup?.name ?? protectedGroups[0]?.name;
		if (!groupName) {
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.DashboardBearer,
				message: "Load groups before probing forward-auth.",
				recovery: UserRecovery.None,
			});
			recordAppTrace("token_set.app.forward_auth.dashboard.validation_failed", {
				reason: "group_missing",
			});
			return;
		}

		if (forwardAuthRequestRef.current) {
			recordAppTrace("token_set.app.forward_auth.cancel_requested", {
				reason: "superseded",
				credential: ForwardAuthCredential.DashboardBearer,
			});
		}
		forwardAuthRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		forwardAuthRequestRef.current = cancellation;
		setForwardAuthStatus({
			kind: ForwardAuthStatusKind.Loading,
			credential: ForwardAuthCredential.DashboardBearer,
		});
		recordAppTrace("token_set.app.forward_auth.dashboard.started", {
			groupName,
		});

		try {
			const result = await probeForwardAuthBoundaryWithTokenSet(
				client,
				groupName,
				{
					cancellationToken: cancellation.token,
				},
			);
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (result.authenticated) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Authenticated,
					credential: ForwardAuthCredential.DashboardBearer,
					entryName: result.authenticatedEntry,
				});
				recordAppTrace("token_set.app.forward_auth.dashboard.authenticated", {
					groupName,
					authenticatedEntry: result.authenticatedEntry,
				});
				return;
			}
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Unauthorized,
				credential: ForwardAuthCredential.DashboardBearer,
				challenge: result.authorizationChallenge,
			});
			recordAppTrace("token_set.app.forward_auth.dashboard.unauthorized", {
				groupName,
				challenge: result.authorizationChallenge,
			});
		} catch (error) {
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Cancelled,
					credential: ForwardAuthCredential.DashboardBearer,
				});
				recordAppTrace("token_set.app.forward_auth.dashboard.cancelled", {
					groupName,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to probe forward-auth with dashboard bearer",
			);
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.DashboardBearer,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.forward_auth.dashboard.failed", {
				groupName,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to probe forward-auth with dashboard bearer",
				),
			});
		} finally {
			if (forwardAuthRequestRef.current === cancellation) {
				forwardAuthRequestRef.current = null;
			}
		}
	}

	async function handleProbeGeneratedEntryToken() {
		const entryToken = latestGeneratedEntry?.token;
		const groupName = latestGeneratedGroupName;
		if (!entryToken || !groupName) {
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.TokenEntry,
				message:
					"Create a token entry first so the generated group credential can be probed.",
				recovery: UserRecovery.None,
			});
			recordAppTrace(
				"token_set.app.forward_auth.token_entry.validation_failed",
				{
					hasEntryToken: Boolean(entryToken),
					hasGroupName: Boolean(groupName),
				},
			);
			return;
		}

		if (forwardAuthRequestRef.current) {
			recordAppTrace("token_set.app.forward_auth.cancel_requested", {
				reason: "superseded",
				credential: ForwardAuthCredential.TokenEntry,
			});
		}
		forwardAuthRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		forwardAuthRequestRef.current = cancellation;
		setForwardAuthStatus({
			kind: ForwardAuthStatusKind.Loading,
			credential: ForwardAuthCredential.TokenEntry,
		});
		recordAppTrace("token_set.app.forward_auth.token_entry.started", {
			groupName,
			entryName: latestGeneratedEntry.entry.name,
		});

		try {
			const result = await probeForwardAuthWithEntryToken(
				entryToken,
				groupName,
				{
					cancellationToken: cancellation.token,
				},
			);
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (result.authenticated) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Authenticated,
					credential: ForwardAuthCredential.TokenEntry,
					entryName: result.authenticatedEntry,
				});
				recordAppTrace("token_set.app.forward_auth.token_entry.authenticated", {
					groupName,
					entryName: latestGeneratedEntry.entry.name,
					authenticatedEntry: result.authenticatedEntry,
				});
				return;
			}
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Unauthorized,
				credential: ForwardAuthCredential.TokenEntry,
				challenge: result.authorizationChallenge,
			});
			recordAppTrace("token_set.app.forward_auth.token_entry.unauthorized", {
				groupName,
				entryName: latestGeneratedEntry.entry.name,
				challenge: result.authorizationChallenge,
			});
		} catch (error) {
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Cancelled,
					credential: ForwardAuthCredential.TokenEntry,
				});
				recordAppTrace("token_set.app.forward_auth.token_entry.cancelled", {
					groupName,
					entryName: latestGeneratedEntry.entry.name,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to probe forward-auth with generated token entry",
			);
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.TokenEntry,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.forward_auth.token_entry.failed", {
				groupName,
				entryName: latestGeneratedEntry.entry.name,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to probe forward-auth with generated token entry",
				),
			});
		} finally {
			if (forwardAuthRequestRef.current === cancellation) {
				forwardAuthRequestRef.current = null;
			}
		}
	}

	async function handleProbeGeneratedBasicEntry() {
		if (!latestBasicEntryCredential) {
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.BasicEntry,
				message:
					"Create a basic entry first so the generated downstream credential can be probed.",
				recovery: UserRecovery.None,
			});
			recordAppTrace(
				"token_set.app.forward_auth.basic_entry.validation_failed",
				{
					reason: "basic_entry_missing",
				},
			);
			return;
		}

		if (forwardAuthRequestRef.current) {
			recordAppTrace("token_set.app.forward_auth.cancel_requested", {
				reason: "superseded",
				credential: ForwardAuthCredential.BasicEntry,
			});
		}
		forwardAuthRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		forwardAuthRequestRef.current = cancellation;
		setForwardAuthStatus({
			kind: ForwardAuthStatusKind.Loading,
			credential: ForwardAuthCredential.BasicEntry,
		});
		recordAppTrace("token_set.app.forward_auth.basic_entry.started", {
			groupName: latestBasicEntryCredential.groupName,
			entryName: latestBasicEntryCredential.entry.name,
		});

		try {
			const result = await probeForwardAuthWithBasicEntry(
				latestBasicEntryCredential.username,
				latestBasicEntryCredential.password,
				latestBasicEntryCredential.groupName,
				{
					cancellationToken: cancellation.token,
				},
			);
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (result.authenticated) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Authenticated,
					credential: ForwardAuthCredential.BasicEntry,
					entryName: result.authenticatedEntry,
				});
				recordAppTrace("token_set.app.forward_auth.basic_entry.authenticated", {
					groupName: latestBasicEntryCredential.groupName,
					entryName: latestBasicEntryCredential.entry.name,
					authenticatedEntry: result.authenticatedEntry,
				});
				return;
			}
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Unauthorized,
				credential: ForwardAuthCredential.BasicEntry,
				challenge: result.authorizationChallenge,
			});
			recordAppTrace("token_set.app.forward_auth.basic_entry.unauthorized", {
				groupName: latestBasicEntryCredential.groupName,
				entryName: latestBasicEntryCredential.entry.name,
				challenge: result.authorizationChallenge,
			});
		} catch (error) {
			if (forwardAuthRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setForwardAuthStatus({
					kind: ForwardAuthStatusKind.Cancelled,
					credential: ForwardAuthCredential.BasicEntry,
				});
				recordAppTrace("token_set.app.forward_auth.basic_entry.cancelled", {
					groupName: latestBasicEntryCredential.groupName,
					entryName: latestBasicEntryCredential.entry.name,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to probe forward-auth with generated basic entry",
			);
			setForwardAuthStatus({
				kind: ForwardAuthStatusKind.Error,
				credential: ForwardAuthCredential.BasicEntry,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.forward_auth.basic_entry.failed", {
				groupName: latestBasicEntryCredential.groupName,
				entryName: latestBasicEntryCredential.entry.name,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to probe forward-auth with generated basic entry",
				),
			});
		} finally {
			if (forwardAuthRequestRef.current === cancellation) {
				forwardAuthRequestRef.current = null;
			}
		}
	}

	async function handleProbePropagationRoute() {
		if (propagationRequestRef.current) {
			recordAppTrace("token_set.app.propagation_probe.cancel_requested", {
				reason: "superseded",
				path: propagationPath,
			});
		}
		propagationRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		propagationRequestRef.current = cancellation;
		setPropagationStatus({ kind: PropagationStatusKind.Loading });
		recordAppTrace("token_set.app.propagation_probe.started", {
			path: propagationPath,
			directive: propagationDirective,
		});

		try {
			const result = await probePropagationRouteWithTokenSet(
				client,
				propagationDirective,
				{
					cancellationToken: cancellation.token,
					path: propagationPath,
				},
			);
			if (propagationRequestRef.current !== cancellation) {
				return;
			}
			const assessment = assessPropagationProbeResult(
				result.status,
				result.body,
			);
			setPropagationStatus({
				kind: PropagationStatusKind.Ready,
				status: result.status,
				summary: assessment.summary,
				configStatus: assessment.configStatus,
				recommendedConfigSnippet: assessment.recommendedConfigSnippet,
			});
			recordAppTrace("token_set.app.propagation_probe.succeeded", {
				path: propagationPath,
				status: result.status,
				configStatus: assessment.configStatus,
			});
		} catch (error) {
			if (propagationRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setPropagationStatus({ kind: PropagationStatusKind.Cancelled });
				recordAppTrace("token_set.app.propagation_probe.cancelled", {
					path: propagationPath,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to probe propagation route",
			);
			setPropagationStatus({
				kind: PropagationStatusKind.Error,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.propagation_probe.failed", {
				path: propagationPath,
				...readTokenSetTraceErrorAttributes(
					error,
					"Failed to probe propagation route",
				),
			});
		} finally {
			if (propagationRequestRef.current === cancellation) {
				propagationRequestRef.current = null;
			}
		}
	}

	return (
		<Layout>
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold">Token Set</h1>
					<p className="max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
						This page now exercises three business mutation families through the
						dashboard token-set bearer: token entries, basic entries, and groups
						with cross-resource membership reloads. It also compares downstream
						forward-auth behavior across dashboard bearer, generated token
						credentials, generated basic credentials, and a more explicit
						propagation config probe. The same page now exposes both the SDK
						auth lifecycle trace and app-level request/probe events as a
						first-class debugging surface instead of leaving them hidden behind
						tests.
					</p>
				</div>

				<div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
					<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Runtime State
								</h2>
								<p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
									Bootstrap:{" "}
									{bootstrap.kind === BootstrapStatusKind.Ready
										? bootstrap.source
										: bootstrap.kind}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => {
										window.location.href = client.authorizeUrl(
											"/playground/token-set",
										);
									}}
									className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
								>
									Start Token Flow
								</button>
								<button
									type="button"
									onClick={() => void handleRefresh()}
									disabled={
										busyAction !== null || !state?.tokens.refreshMaterial
									}
									className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									{busyAction === BusyActionKind.Refresh
										? "Refreshing..."
										: "Refresh Now"}
								</button>
								<button
									type="button"
									onClick={() => void handleClear()}
									disabled={busyAction !== null}
									className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									{busyAction === BusyActionKind.Clear
										? "Clearing..."
										: "Forget Token Set"}
								</button>
							</div>
						</div>

						{bootstrap.kind === BootstrapStatusKind.Error && (
							<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
								{bootstrap.message}
							</div>
						)}
						{actionError && (
							<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
								{actionError}
							</div>
						)}

						<div className="grid gap-3 sm:grid-cols-2">
							<CollapsibleTokenCell
								label="Access Token"
								value={state?.tokens.accessToken}
							/>
							<CollapsibleTokenCell
								label="ID Token"
								value={state?.tokens.idToken}
							/>
							<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Refresh Token
								</p>
								<p className="mt-2 font-mono text-sm">
									{state?.tokens.refreshMaterial ? "Available" : "Unavailable"}
								</p>
							</div>
							<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Expires At
								</p>
								<p className="mt-2 text-sm">
									{state?.tokens.accessTokenExpiresAt ?? "Unavailable"}
								</p>
							</div>
							<CollapsibleTokenCell
								label="Authorization Header"
								value={client.authorizationHeader()}
							/>
						</div>
					</section>

					<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
							Metadata
						</h2>
						<pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
							{readMetadata(state)}
						</pre>
					</section>
				</div>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Protected Groups
							</h2>
							<p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
								Load the real `/api/groups` path through the dashboard bearer
								and use the result as the shared target set for all three
								mutation families.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void groupsQuery.refetch()}
								disabled={
									groupsQuery.isFetching ||
									bootstrap.kind !== BootstrapStatusKind.Ready ||
									!state?.tokens.accessToken
								}
								className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{groupsQuery.isFetching
									? "Loading Groups..."
									: "Load Groups via Bearer"}
							</button>
							<button
								type="button"
								onClick={() =>
									void queryClient.cancelQueries({
										queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
									})
								}
								disabled={!groupsQuery.isFetching}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Load
							</button>
						</div>
					</div>

					<div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
						<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
							Request Status
						</p>
						<p className="mt-2 text-sm">
							{groupsQuery.status === "pending" && !groupsQuery.isFetching
								? "No protected group request has been issued yet."
								: `Status: ${groupsQuery.status}${groupsQuery.isFetching ? " (fetching)" : ""}`}
						</p>
						{groupsQuery.error && (
							<p className="mt-2 text-sm text-red-600 dark:text-red-400">
								{groupsQuery.error.message}
							</p>
						)}
					</div>

					<div className="mt-4 grid gap-3 md:grid-cols-2">
						{protectedGroups.map((group) => (
							<button
								key={group.id}
								type="button"
								onClick={() => setSelectedGroupId(group.id)}
								className={`rounded-lg border p-4 text-left dark:border-zinc-800 ${
									selectedGroupId === group.id
										? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
										: "border-zinc-200 bg-white dark:bg-zinc-900"
								}`}
							>
								<p className="text-sm font-medium">{group.name}</p>
								<p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
									{group.id}
								</p>
							</button>
						))}
						{protectedGroups.length === 0 && (
							<div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
								No groups loaded yet.
							</div>
						)}
					</div>
				</section>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Group Mutation Family
							</h2>
							<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
								Create a real `/api/groups` record through the dashboard bearer
								and bind existing entries during the same mutation. Successful
								group creation reloads both `/api/groups` and `/api/entries` in
								app space because membership changes are visible on both read
								paths.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void entriesQuery.refetch()}
								disabled={
									entriesQuery.isFetching ||
									bootstrap.kind !== BootstrapStatusKind.Ready ||
									!state?.tokens.accessToken
								}
								className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{entriesQuery.isFetching
									? "Loading Members..."
									: "Load Entries for Membership"}
							</button>
							<button
								type="button"
								onClick={() => createGroupMutation.reset()}
								disabled={!createGroupMutation.isPending}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Create
							</button>
						</div>
					</div>

					<div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Create Group with Entry Membership
							</p>
							<div className="mt-4 space-y-3">
								<input
									type="text"
									value={newGroupName}
									onChange={(event) => setNewGroupName(event.target.value)}
									placeholder="Group name"
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								/>
								<div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
									<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										Select Existing Entries
									</p>
									<div className="mt-3 space-y-2">
										{protectedEntries.map((entry) => (
											<label
												key={entry.id}
												className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
											>
												<input
													type="checkbox"
													checked={selectedGroupEntryIds.includes(entry.id)}
													onChange={() => toggleSelectedGroupEntryId(entry.id)}
													className="mt-1"
												/>
												<span className="min-w-0">
													<span className="block font-medium">
														{entry.name}
													</span>
													<span className="block text-xs text-zinc-500 dark:text-zinc-400">
														{entry.kind} · {formatEntryGroups(entry)}
													</span>
												</span>
											</label>
										))}
										{protectedEntries.length === 0 && (
											<div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
												Load entries first, then select one or more members for
												the new group.
											</div>
										)}
									</div>
								</div>
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => void handleCreateGroup()}
										disabled={
											createGroupMutation.isPending ||
											bootstrap.kind !== BootstrapStatusKind.Ready ||
											!state?.tokens.accessToken ||
											newGroupName.trim().length === 0 ||
											selectedGroupEntryIds.length === 0
										}
										className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{createGroupMutation.isPending
											? "Creating..."
											: "Create Group"}
									</button>
								</div>
							</div>
						</div>

						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Mutation Status
							</p>
							<p className="mt-2 text-sm">
								{createGroupMutation.isIdle
									? "No group mutation has been issued yet."
									: createGroupMutation.isPending
										? "Status: loading"
										: createGroupMutation.isSuccess
											? `Created ${createGroupMutation.data.name}.`
											: `Status: ${createGroupMutation.status}`}
							</p>
							{createGroupMutation.isError && (
								<p className="mt-2 text-sm text-red-600 dark:text-red-400">
									{createGroupMutation.error.message}
								</p>
							)}
							{latestCreatedGroup && (
								<div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/40">
									<p className="text-xs uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
										Latest Group Result
									</p>
									<p className="mt-2 text-sm text-emerald-900 dark:text-emerald-100">
										{latestCreatedGroup.name}
									</p>
									<p className="mt-2 font-mono text-xs text-emerald-800 dark:text-emerald-200">
										{latestCreatedGroup.id}
									</p>
									<p className="mt-3 text-sm text-emerald-800 dark:text-emerald-200">
										Bound entries:{" "}
										{latestCreatedGroupMembers.length > 0
											? latestCreatedGroupMembers.join(", ")
											: "None"}
									</p>
								</div>
							)}
						</div>
					</div>
				</section>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Entry Mutation Families
							</h2>
							<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
								Exercise two entry-specific mutation families through the same
								token-set bearer: token entries and basic entries. Both families
								reload the shared `/api/entries` read path in app space after a
								successful mutation, while the separate group family above also
								reloads entries because membership changed.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void entriesQuery.refetch()}
								disabled={
									entriesQuery.isFetching ||
									bootstrap.kind !== BootstrapStatusKind.Ready ||
									!state?.tokens.accessToken
								}
								className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{entriesQuery.isFetching
									? "Loading Entries..."
									: "Load Entries via Bearer"}
							</button>
							<button
								type="button"
								onClick={() =>
									void queryClient.cancelQueries({
										queryKey:
											tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
									})
								}
								disabled={!entriesQuery.isFetching}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Load
							</button>
						</div>
					</div>

					<div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1.15fr]">
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Create Token Entry
							</p>
							<div className="mt-4 space-y-3">
								<input
									type="text"
									value={newTokenEntryName}
									onChange={(event) => setNewTokenEntryName(event.target.value)}
									placeholder="Entry name"
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								/>
								<select
									value={selectedGroupId}
									onChange={(event) => setSelectedGroupId(event.target.value)}
									disabled={groupOptions.length === 0}
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								>
									<option value="">Select target group</option>
									{groupOptions.map((group) => (
										<option key={group.id} value={group.id}>
											{group.name}
										</option>
									))}
								</select>
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => void handleCreateTokenEntry()}
										disabled={
											tokenEntryStatus.kind === MutationStatusKind.Loading ||
											bootstrap.kind !== BootstrapStatusKind.Ready ||
											!state?.tokens.accessToken ||
											!selectedGroup ||
											newTokenEntryName.trim().length === 0
										}
										className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{tokenEntryStatus.kind === MutationStatusKind.Loading
											? "Creating..."
											: "Create Token Entry"}
									</button>
									<button
										type="button"
										onClick={() => createTokenEntryRequestRef.current?.cancel()}
										disabled={
											tokenEntryStatus.kind !== MutationStatusKind.Loading
										}
										className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
									>
										Cancel Create
									</button>
								</div>
							</div>

							<div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Mutation Status
								</p>
								<p className="mt-2 text-sm">
									{readMutationStatusText(tokenEntryStatus, "token entry")}
								</p>
								{tokenEntryStatus.kind === MutationStatusKind.Error && (
									<p className="mt-2 text-sm text-red-600 dark:text-red-400">
										{tokenEntryStatus.message}
									</p>
								)}
							</div>

							{latestGeneratedEntry && (
								<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/40">
									<p className="text-xs uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
										Latest Token Credential
									</p>
									<p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
										{latestGeneratedEntry.entry.name}
										{latestGeneratedGroupName
											? ` for ${latestGeneratedGroupName}`
											: ""}
									</p>
									<code className="mt-3 block overflow-x-auto rounded bg-white px-3 py-2 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
										{latestGeneratedEntry.token}
									</code>
								</div>
							)}
						</div>

						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Create Basic Entry
							</p>
							<div className="mt-4 space-y-3">
								<input
									type="text"
									value={newBasicEntryName}
									onChange={(event) => setNewBasicEntryName(event.target.value)}
									placeholder="Entry name"
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								/>
								<input
									type="text"
									value={newBasicEntryUsername}
									onChange={(event) =>
										setNewBasicEntryUsername(event.target.value)
									}
									placeholder="Username"
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								/>
								<input
									type="password"
									value={newBasicEntryPassword}
									onChange={(event) =>
										setNewBasicEntryPassword(event.target.value)
									}
									placeholder="Password"
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								/>
								<select
									value={selectedGroupId}
									onChange={(event) => setSelectedGroupId(event.target.value)}
									disabled={groupOptions.length === 0}
									className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
								>
									<option value="">Select target group</option>
									{groupOptions.map((group) => (
										<option key={group.id} value={group.id}>
											{group.name}
										</option>
									))}
								</select>
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => void handleCreateBasicEntry()}
										disabled={
											basicEntryStatus.kind === MutationStatusKind.Loading ||
											bootstrap.kind !== BootstrapStatusKind.Ready ||
											!state?.tokens.accessToken ||
											!selectedGroup ||
											newBasicEntryName.trim().length === 0 ||
											newBasicEntryUsername.trim().length === 0 ||
											newBasicEntryPassword.length === 0
										}
										className="rounded-md bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{basicEntryStatus.kind === MutationStatusKind.Loading
											? "Creating..."
											: "Create Basic Entry"}
									</button>
									<button
										type="button"
										onClick={() => createBasicEntryRequestRef.current?.cancel()}
										disabled={
											basicEntryStatus.kind !== MutationStatusKind.Loading
										}
										className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
									>
										Cancel Create
									</button>
								</div>
							</div>

							<div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Mutation Status
								</p>
								<p className="mt-2 text-sm">
									{readMutationStatusText(basicEntryStatus, "basic entry")}
								</p>
								{basicEntryStatus.kind === MutationStatusKind.Error && (
									<p className="mt-2 text-sm text-red-600 dark:text-red-400">
										{basicEntryStatus.message}
									</p>
								)}
							</div>

							{latestBasicEntryCredential && (
								<div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
									<p className="text-xs uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">
										Latest Basic Credential
									</p>
									<p className="mt-2 text-sm text-rose-800 dark:text-rose-200">
										{latestBasicEntryCredential.entry.name} for{" "}
										{latestBasicEntryCredential.groupName}
									</p>
									<code className="mt-3 block overflow-x-auto rounded bg-white px-3 py-2 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
										{latestBasicEntryCredential.username}:
										{latestBasicEntryCredential.password}
									</code>
								</div>
							)}
						</div>

						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Protected Entries
							</p>
							<p className="mt-2 text-sm">
								{entriesQuery.status === "pending" && !entriesQuery.isFetching
									? "No protected entry request has been issued yet."
									: `Status: ${entriesQuery.status}${entriesQuery.isFetching ? " (fetching)" : ""}`}
							</p>
							{entriesQuery.error && (
								<p className="mt-2 text-sm text-red-600 dark:text-red-400">
									{entriesQuery.error.message}
								</p>
							)}
							<div className="mt-4 space-y-3">
								{protectedEntries.map((entry) => (
									<div
										key={entry.id}
										className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
									>
										<div className="flex flex-wrap items-center justify-between gap-3">
											<div>
												<p className="text-sm font-medium">{entry.name}</p>
												<p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
													{entry.kind}
												</p>
											</div>
											<p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
												{entry.id}
											</p>
										</div>
										<p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
											Groups: {formatEntryGroups(entry)}
										</p>
									</div>
								))}
								{protectedEntries.length === 0 && (
									<div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
										No entries loaded yet.
									</div>
								)}
							</div>
						</div>
					</div>
				</section>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								ForwardAuth Comparison
							</h2>
							<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
								Compare the same `/api/forwardauth/traefik/:group` route under
								three credential forms: dashboard bearer, generated token entry,
								and generated basic entry.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void handleProbeDashboardBearer()}
								disabled={
									forwardAuthStatus.kind === ForwardAuthStatusKind.Loading ||
									bootstrap.kind !== BootstrapStatusKind.Ready ||
									!state?.tokens.accessToken ||
									!selectedGroup
								}
								className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Probe Dashboard Bearer
							</button>
							<button
								type="button"
								onClick={() => void handleProbeGeneratedEntryToken()}
								disabled={
									forwardAuthStatus.kind === ForwardAuthStatusKind.Loading ||
									!latestGeneratedEntry?.token ||
									!latestGeneratedGroupName
								}
								className="rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Probe Token Entry
							</button>
							<button
								type="button"
								onClick={() => void handleProbeGeneratedBasicEntry()}
								disabled={
									forwardAuthStatus.kind === ForwardAuthStatusKind.Loading ||
									!latestBasicEntryCredential
								}
								className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Probe Basic Entry
							</button>
							<button
								type="button"
								onClick={() => forwardAuthRequestRef.current?.cancel()}
								disabled={
									forwardAuthStatus.kind !== ForwardAuthStatusKind.Loading
								}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Probe
							</button>
						</div>
					</div>

					<div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
						<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
							Probe Result
						</p>
						<p className="mt-2 text-sm">
							{describeForwardAuthStatus(forwardAuthStatus)}
						</p>
						{forwardAuthStatus.kind === ForwardAuthStatusKind.Unauthorized &&
							forwardAuthStatus.challenge && (
								<p className="mt-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
									Challenge: {forwardAuthStatus.challenge}
								</p>
							)}
						{forwardAuthStatus.kind === ForwardAuthStatusKind.Error &&
							forwardAuthStatus.recovery !== UserRecovery.None && (
								<p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Recovery: {forwardAuthStatus.recovery}
								</p>
							)}
						{selectedGroup && (
							<p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Current group: {selectedGroup.name}
							</p>
						)}
					</div>
				</section>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Route Probe
							</h2>
							<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
								Hit the real `/api/propagation/*` path with a dashboard bearer
								and explicit propagation directive. This remains app glue, but
								it now distinguishes between “route not mounted in current
								config” and “route mounted but blocked by propagation policy or
								downstream reachability”. The default probe now targets a
								same-server `/api/health` forward, which is the smallest usable
								repo-local dogfood path.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void handleProbePropagationRoute()}
								disabled={
									propagationStatus.kind === PropagationStatusKind.Loading ||
									bootstrap.kind !== BootstrapStatusKind.Ready ||
									!state?.tokens.accessToken
								}
								className="rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{propagationStatus.kind === PropagationStatusKind.Loading
									? "Probing..."
									: "Probe Propagation Route"}
							</button>
							<button
								type="button"
								onClick={() => propagationRequestRef.current?.cancel()}
								disabled={
									propagationStatus.kind !== PropagationStatusKind.Loading
								}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Probe
							</button>
						</div>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-3">
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Route
							</p>
							<input
								type="text"
								value={propagationPath}
								onChange={(event) => setPropagationPath(event.target.value)}
								className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
							<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
								With the reference config below, `/api/propagation/api/health`
								forwards to the same server's `/api/health`.
							</p>
						</div>
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Directive
							</p>
							<textarea
								value={propagationDirective}
								onChange={(event) =>
									setPropagationDirective(event.target.value)
								}
								rows={3}
								className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
							<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
								The directive still needs at least `host` and `proto`. If the
								route stays at 404 in this repo state, use the same-server
								reference config below first:
							</p>
							<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
								{DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET}
							</pre>
						</div>
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Probe Result
							</p>
							<p className="mt-2 text-sm">
								{describePropagationStatus(propagationStatus)}
							</p>
							{propagationStatus.kind === PropagationStatusKind.Ready && (
								<>
									<p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										HTTP Status: {propagationStatus.status}
									</p>
									{propagationStatus.configStatus && (
										<p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
											{propagationStatus.configStatus}
										</p>
									)}
									{propagationStatus.recommendedConfigSnippet && (
										<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
											{propagationStatus.recommendedConfigSnippet}
										</pre>
									)}
								</>
							)}
							{propagationStatus.kind === PropagationStatusKind.Error &&
								propagationStatus.recovery !== UserRecovery.None && (
									<p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										Recovery: {propagationStatus.recovery}
									</p>
								)}
						</div>
					</div>
				</section>

				<TraceTimelineSection
					events={traceEvents}
					onClear={() => traceTimeline.clear()}
				/>
			</div>
		</Layout>
	);
}
