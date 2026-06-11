import { describe, expect, it } from "vitest";
import { UriReferenceString } from "../../struct/uri-string";
import {
	appendOrReplaceCompatFragment,
	parseCompatFragment,
	takeCompatFragment,
} from "../compat-fragment";

function updateUrlHash(url: URL, hash: string): URL {
	const next = new URL(url.href);
	next.hash = hash;
	return next;
}

describe("securitydept compat fragment", () => {
	it("appends a compat fragment without replacing an existing hash route", () => {
		const url = new URL("https://app.example.com/#/orders");

		const { url: updated } = appendOrReplaceCompatFragment(
			url,
			{
				payload: "access_token=at&id_token=idt",
			},
			updateUrlHash,
		);

		expect(updated.toString()).toBe(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at&id_token=idt",
		);
		expect(url.toString()).toBe("https://app.example.com/#/orders");
	});

	it("replaces an existing compat fragment block", () => {
		const url = new URL(
			"https://app.example.com/#/orders#securitydept=v1&kind=old&access_token=old",
		);

		const { url: updated } = appendOrReplaceCompatFragment(
			url,
			{
				payload: "kind=token_set_backend_oidc_refresh&access_token=new",
			},
			updateUrlHash,
		);

		expect(updated.toString()).toBe(
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

	it("parses compat fragments from a URI reference hash", () => {
		const parsed = parseCompatFragment(
			UriReferenceString.parse(
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

		const { compatFragment, url: cleaned } = takeCompatFragment(url, {
			update: updateUrlHash,
		});

		expect(compatFragment?.payload).toBe("access_token=at");
		expect(cleaned.toString()).toBe("https://app.example.com/#/orders");
		expect(url.toString()).toBe(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at",
		);
	});

	it("takes compat fragments from a URI reference without mutating the input", () => {
		const ref = UriReferenceString.parse(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at",
		);

		const { compatFragment, url: cleaned } = takeCompatFragment(ref, {
			update: (current, hash) => current.setHash(hash),
		});

		expect(compatFragment?.payload).toBe("access_token=at");
		expect(cleaned.raw).toBe("https://app.example.com/#/orders");
		expect(ref.raw).toBe(
			"https://app.example.com/#/orders#securitydept=v1&access_token=at",
		);
	});

	it("preserves an empty hash-route block when taking compat fragments", () => {
		const { compatFragment, fragment } = takeCompatFragment(
			"##securitydept=v1&access_token=at",
			{ update: (_, hash) => hash },
		);

		expect(compatFragment?.payload).toBe("access_token=at");
		expect(fragment).toBe("#");
	});

	it("appends compat fragments after an empty hash-route block", () => {
		const { fragment } = appendOrReplaceCompatFragment(
			"#",
			{ payload: "access_token=at" },
			(_, hash) => hash,
		);

		expect(fragment).toBe("##securitydept=v1&access_token=at");
	});

	it("clears hash entirely when taking a lone compat block", () => {
		const { fragment } = takeCompatFragment(
			"#securitydept=v1&access_token=at",
			{ update: (_, hash) => hash },
		);

		expect(fragment).toBe("");
	});

	it("does not take a compat fragment when its condition does not match", () => {
		const input =
			"#/orders#securitydept=v1&kind=another_protocol&access_token=at";
		const { compatFragment, fragment, url } = takeCompatFragment(input, {
			condition: ({ parameters }) =>
				parameters.kind === "token_set_backend_oidc_callback",
			update: (_, hash) => hash,
		});

		expect(compatFragment).toBeNull();
		expect(fragment).toBe(input);
		expect(url).toBe(input);
	});
});
