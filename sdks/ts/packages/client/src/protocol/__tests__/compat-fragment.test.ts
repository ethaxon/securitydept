import { describe, expect, it } from "vitest";
import {
	appendOrReplaceCompatFragment,
	parseCompatFragment,
	removeCompatFragment,
} from "../compat-fragment";

describe("securitydept compat fragment", () => {
	it("appends a compat fragment without replacing an existing hash route", () => {
		const url = new URL("https://app.example.com/#/orders");

		appendOrReplaceCompatFragment(url, {
			payload: "access_token=at&id_token=idt",
		});

		expect(url.toString()).toBe(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at&id_token=idt",
		);
	});

	it("replaces an existing compat fragment block", () => {
		const url = new URL(
			"https://app.example.com/#/orders#securitydept=v1&kind=old&access_token=old",
		);

		appendOrReplaceCompatFragment(url, {
			payload: "kind=token_set_backend_oidc_refresh&access_token=new",
		});

		expect(url.toString()).toBe(
			"https://app.example.com/#/orders#securitydept=v1&kind=token_set_backend_oidc_refresh&access_token=new",
		);
	});

	it("parses only the last compat fragment block", () => {
		const parsed = parseCompatFragment(
			new URL(
				"https://app.example.com/#/orders#securitydept=v1&kind=token_set_backend_oidc_callback&access_token=at",
			),
		);

		expect(parsed?.payload).toBe(
			"kind=token_set_backend_oidc_callback&access_token=at",
		);
	});

	it("ignores non-compat hash routes", () => {
		expect(parseCompatFragment("#/orders")).toBeNull();
	});

	it("removes only the compat fragment block", () => {
		const url = new URL(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at",
		);

		const removed = removeCompatFragment(url);

		expect(removed?.payload).toBe("access_token=at");
		expect(url.toString()).toBe("https://app.example.com/#/orders");
	});
});
