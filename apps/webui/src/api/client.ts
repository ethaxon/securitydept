import { ClientError } from "@securitydept/client";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		headers: {
			"Content-Type": "application/json",
			...options.headers,
		},
		...options,
	});

	if (!res.ok) {
		const body = await res.json().catch(() => undefined);
		throw ClientError.fromHttpResponse(res.status, body);
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
