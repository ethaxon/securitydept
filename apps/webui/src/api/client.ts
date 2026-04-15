import type { UserRecovery } from "@securitydept/client";
import { AuthContextMode, resolveAuthContextMode } from "@/lib/authContext";

/** API path prefix — prepends `/basic` when using basic auth so that
 *  `/api/entries` becomes `/basic/api/entries`. */
function resolveApiBase(): string {
	return resolveAuthContextMode() === AuthContextMode.Basic ? "/basic" : "";
}

type ApiErrorPayload = {
	error?:
		| string
		| {
				code?: string;
				message?: string;
				recovery?: UserRecovery;
		  };
	error_code?: string;
	error_message?: string;
	recovery?: UserRecovery;
};

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public code?: string,
		public recovery?: UserRecovery,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const base = resolveApiBase();
	const res = await fetch(`${base}${path}`, {
		headers: {
			"Content-Type": "application/json",
			...options.headers,
		},
		...options,
	});

	if (!res.ok) {
		const body: ApiErrorPayload = await res
			.json()
			.catch(() => ({ error: res.statusText }));
		const error =
			typeof body.error === "object" && body.error !== null
				? body.error
				: undefined;
		const message =
			error?.message ??
			body.error_message ??
			(typeof body.error === "string" ? body.error : undefined) ??
			res.statusText;
		const code = error?.code ?? body.error_code;
		const recovery = error?.recovery ?? body.recovery;
		throw new ApiError(res.status, message, code, recovery);
	}

	return res.json();
}

export const api = {
	get: <T>(path: string) => request<T>(path),
	post: <T>(path: string, body: unknown) =>
		request<T>(path, { method: "POST", body: JSON.stringify(body) }),
	put: <T>(path: string, body: unknown) =>
		request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
	delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
