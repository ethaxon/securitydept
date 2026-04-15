import { FlaskConical, KeyRound, Lock, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveLoginUrl } from "@/api/auth";
import { AppIcon } from "@/components/common/AppIcon";
import { Header } from "@/components/layout/Header";
import { AuthContextMode, setAuthContextMode } from "@/lib/authContext";
import { getTokenSetClient } from "@/lib/tokenSetClient";

/**
 * Login chooser — three real auth-context entry points, plus a Playgrounds
 * section for developer tooling routes.
 */
export function LoginPage() {
	const [sessionHref, setSessionHref] = useState("/auth/session/login");
	// Token Set login — no post_auth_redirect_uri, so the server's Resolved
	// policy defaults to "/", redirecting to the dashboard after callback.
	const tokenSetHref = getTokenSetClient().authorizeUrl();

	useEffect(() => {
		let cancelled = false;
		void resolveLoginUrl().then((href) => {
			if (!cancelled) {
				setSessionHref(href);
			}
		});

		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
			<Header />
			<div className="flex flex-1 items-center justify-center p-4">
				<div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-col items-center gap-2">
						<AppIcon className="h-10 w-10" />
						<h1 className="text-xl font-semibold">SecurityDept</h1>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							Choose an authentication context to continue
						</p>
					</div>

					<div className="space-y-3">
						{/* Session context — OIDC session-based auth */}
						<a
							id="login-session"
							href={sessionHref}
							onClick={() => setAuthContextMode(AuthContextMode.Session)}
							className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-left text-sm font-medium transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-600 dark:hover:bg-blue-950/40"
						>
							<Shield className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
							<div className="min-w-0">
								<span className="block font-medium">Session (OIDC)</span>
								<span className="block text-xs text-zinc-500 dark:text-zinc-400">
									Cookie-based session — dashboard management
								</span>
							</div>
						</a>

						{/* Token-set context — redirects to / after callback */}
						<a
							id="login-token-set"
							href={tokenSetHref}
							onClick={() => setAuthContextMode(AuthContextMode.TokenSet)}
							className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-left text-sm font-medium transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-zinc-700 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/40"
						>
							<KeyRound className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
							<div className="min-w-0">
								<span className="block font-medium">Token Set (OIDC)</span>
								<span className="block text-xs text-zinc-500 dark:text-zinc-400">
									Bearer-token auth — API-oriented workflows
								</span>
							</div>
						</a>

						{/* Basic context — HTTP Basic auth */}
						<a
							id="login-basic"
							href="/basic/login"
							onClick={() => setAuthContextMode(AuthContextMode.Basic)}
							className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-left text-sm font-medium transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-zinc-700 dark:hover:border-amber-600 dark:hover:bg-amber-950/40"
						>
							<Lock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
							<div className="min-w-0">
								<span className="block font-medium">Basic Auth</span>
								<span className="block text-xs text-zinc-500 dark:text-zinc-400">
									HTTP Basic — username &amp; password
								</span>
							</div>
						</a>
					</div>

					{/* Playgrounds — developer tooling, separated from auth choices */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
							<span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
								Playgrounds
							</span>
							<div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
						</div>

						<a
							id="playground-token-set"
							href="/playground/token-set"
							className="flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-200 px-4 py-3 text-left text-sm font-medium transition-colors hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-700 dark:hover:border-violet-600 dark:hover:bg-violet-950/40"
						>
							<FlaskConical className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
							<div className="min-w-0">
								<span className="block font-medium">Token Set Playground</span>
								<span className="block text-xs text-zinc-500 dark:text-zinc-400">
									Requires Token Set (OIDC) context
								</span>
							</div>
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}
