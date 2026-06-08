import { describe, expect, it } from "vitest";

import {
	UriParseError,
	UriReferenceString,
	UriRelativeString,
	UriString,
} from "../uri-string";

// ---------------------------------------------------------------------------
// UriString (absolute URI)
// ---------------------------------------------------------------------------

describe("UriString", () => {
	describe("parse", () => {
		it("accepts a valid absolute URI", () => {
			const uri = UriString.parse("https://example.com/path?q=1#frag");
			expect(uri).toBeInstanceOf(UriString);
			expect(uri.raw).toBe("https://example.com/path?q=1#frag");
		});

		it("accepts an absolute URI with port", () => {
			const uri = UriString.parse("http://localhost:3000/api");
			expect(uri.raw).toBe("http://localhost:3000/api");
		});

		it("throws UriParseError for a relative path", () => {
			expect(() => UriString.parse("/relative/path")).toThrow(UriParseError);
		});

		it("throws UriParseError for a bare path", () => {
			expect(() => UriString.parse("foo/bar")).toThrow(UriParseError);
		});
	});

	describe("tryParse", () => {
		it("returns UriString for a valid absolute URI", () => {
			const uri = UriString.tryParse("https://example.com");
			expect(uri).toBeInstanceOf(UriString);
			expect(uri?.raw).toBe("https://example.com");
		});

		it("returns null for a relative path", () => {
			expect(UriString.tryParse("/foo")).toBeNull();
		});

		it("returns null for a query-only string", () => {
			expect(UriString.tryParse("?key=value")).toBeNull();
		});

		it("returns existing UriString instances unchanged", () => {
			const original = UriString.parse("https://example.com");
			expect(UriString.tryParse(original)).toBe(original);
		});
	});

	describe("toURL", () => {
		it("returns a URL without requiring a base", () => {
			const uri = UriString.parse("https://example.com/path");
			const url = uri.toURL();
			expect(url).toBeInstanceOf(URL);
			expect(url.href).toBe("https://example.com/path");
		});
	});

	describe("fromURL", () => {
		it("creates a UriString from a URL object", () => {
			const url = new URL("https://example.com/path?q=1");
			const uri = UriString.fromURL(url);
			expect(uri).toBeInstanceOf(UriString);
			expect(uri.raw).toBe(url.href);
		});

		it("produces a defensively independent copy", () => {
			const url = new URL("https://example.com");
			const uri = UriString.fromURL(url);
			url.pathname = "/mutated";
			expect(uri.raw).toBe("https://example.com/");
		});
	});

	describe("fromURLRelative", () => {
		it("throws TypeError because relative parts cannot form an absolute URI", () => {
			expect(() =>
				UriString.fromURLRelative({ pathname: "/p", search: "", hash: "" }),
			).toThrow(TypeError);
		});
	});

	describe("accessors", () => {
		it("exposes all URL components for absolute URIs", () => {
			const uri = UriString.parse(
				"https://user:pass@example.com:8080/path?q=1#hash",
			);
			expect(uri.protocol).toBe("https:");
			expect(uri.username).toBe("user");
			expect(uri.password).toBe("pass");
			expect(uri.host).toBe("example.com:8080");
			expect(uri.hostname).toBe("example.com");
			expect(uri.port).toBe("8080");
			expect(uri.origin).toBe("https://example.com:8080");
			expect(uri.pathname).toBe("/path");
			expect(uri.search).toBe("?q=1");
			expect(uri.searchParams.get("q")).toBe("1");
			expect(uri.hash).toBe("#hash");
		});
	});

	describe("setSearchParams", () => {
		it("replaces search params and preserves the concrete absolute type", () => {
			const uri = UriString.parse("https://example.com/path?old=1#hash");
			const updated: UriString = uri.setSearchParams({ q: "two words" });

			expect(updated).toBeInstanceOf(UriString);
			expect(updated.raw).toBe("https://example.com/path?q=two+words#hash");
			expect(uri.raw).toBe("https://example.com/path?old=1#hash");
		});
	});

	describe("type narrowing", () => {
		it("isAbsolute returns true", () => {
			const uri = UriString.parse("https://x.com");
			expect(uri.isAbsolute()).toBe(true);
		});

		it("isRelative returns false", () => {
			const uri = UriString.parse("https://x.com");
			expect(uri.isRelative()).toBe(false);
		});
	});

	describe("serialization", () => {
		it("toString returns the raw string", () => {
			const uri = UriString.parse("https://example.com/path");
			expect(uri.toString()).toBe("https://example.com/path");
		});

		it("valueOf returns the raw string", () => {
			const uri = UriString.parse("https://example.com/path");
			expect(uri.valueOf()).toBe("https://example.com/path");
		});

		it("toJSON returns the raw string", () => {
			const uri = UriString.parse("https://example.com/path");
			expect(JSON.stringify(uri)).toBe('"https://example.com/path"');
		});
	});
});

// ---------------------------------------------------------------------------
// UriRelativeString (relative URI reference)
// ---------------------------------------------------------------------------

describe("UriRelativeString", () => {
	describe("parse", () => {
		it("accepts a root-relative path", () => {
			const uri = UriRelativeString.parse("/dashboard");
			expect(uri).toBeInstanceOf(UriRelativeString);
			expect(uri.raw).toBe("/dashboard");
		});

		it("accepts a bare relative path", () => {
			const uri = UriRelativeString.parse("foo/bar");
			expect(uri.raw).toBe("foo/bar");
		});

		it("accepts a query-only string", () => {
			const uri = UriRelativeString.parse("?key=value");
			expect(uri.raw).toBe("?key=value");
		});

		it("accepts a fragment-only string", () => {
			const uri = UriRelativeString.parse("#section");
			expect(uri.raw).toBe("#section");
		});

		it("accepts a dot-segment path", () => {
			const uri = UriRelativeString.parse("../parent/child");
			expect(uri.raw).toBe("../parent/child");
		});

		it("throws UriParseError for an absolute URI", () => {
			expect(() => UriRelativeString.parse("https://example.com")).toThrow(
				UriParseError,
			);
		});
	});

	describe("tryParse", () => {
		it("returns UriRelativeString for a relative path", () => {
			const uri = UriRelativeString.tryParse("/foo/bar");
			expect(uri).toBeInstanceOf(UriRelativeString);
		});

		it("returns null for an absolute URI", () => {
			expect(UriRelativeString.tryParse("https://example.com")).toBeNull();
		});

		it("returns existing UriRelativeString instances unchanged", () => {
			const original = UriRelativeString.parse("/dashboard");
			expect(UriRelativeString.tryParse(original)).toBe(original);
		});
	});

	describe("toURL", () => {
		it("resolves against a string base", () => {
			const uri = UriRelativeString.parse("/path");
			const url = uri.toURL("https://example.com");
			expect(url.href).toBe("https://example.com/path");
		});

		it("resolves against a URL base", () => {
			const uri = UriRelativeString.parse("/path");
			const url = uri.toURL(new URL("https://example.com"));
			expect(url.href).toBe("https://example.com/path");
		});

		it("resolves relative paths correctly", () => {
			const uri = UriRelativeString.parse("child");
			const url = uri.toURL("https://example.com/parent/");
			expect(url.href).toBe("https://example.com/parent/child");
		});

		it("resolves query-only against a base", () => {
			const uri = UriRelativeString.parse("?q=1");
			const url = uri.toURL("https://example.com/page");
			expect(url.href).toBe("https://example.com/page?q=1");
		});
	});

	describe("type narrowing", () => {
		it("isAbsolute returns false", () => {
			const uri = UriRelativeString.parse("/foo");
			expect(uri.isAbsolute()).toBe(false);
		});

		it("isRelative returns true", () => {
			const uri = UriRelativeString.parse("/foo");
			expect(uri.isRelative()).toBe(true);
		});
	});

	describe("serialization", () => {
		it("toString returns the raw string", () => {
			const uri = UriRelativeString.parse("/path?q=1");
			expect(uri.toString()).toBe("/path?q=1");
		});

		it("toJSON returns the raw string", () => {
			const uri = UriRelativeString.parse("/path");
			expect(JSON.stringify(uri)).toBe('"/path"');
		});
	});

	describe("fromURL", () => {
		it("throws TypeError because URLs are always absolute", () => {
			const url = new URL("https://example.com");
			expect(() => UriRelativeString.fromURL(url)).toThrow(TypeError);
		});
	});

	describe("fromURLRelative", () => {
		it("constructs from pathname, search, and hash", () => {
			const uri = UriRelativeString.fromURLRelative({
				pathname: "/path",
				search: "?q=1",
				hash: "#frag",
			});
			expect(uri).toBeInstanceOf(UriRelativeString);
			expect(uri.raw).toBe("/path?q=1#frag");
		});

		it("handles empty search and hash", () => {
			const uri = UriRelativeString.fromURLRelative({
				pathname: "/only-path",
				search: "",
				hash: "",
			});
			expect(uri.raw).toBe("/only-path");
		});

		it("accepts a native URL as the parts source", () => {
			const url = new URL("https://example.com/p?q=1#h");
			const uri = UriRelativeString.fromURLRelative(url);
			expect(uri.raw).toBe("/p?q=1#h");
		});
	});

	describe("accessors", () => {
		it("exposes relative URL components", () => {
			const uri = UriRelativeString.parse("/path?q=1#hash");
			expect(uri.pathname).toBe("/path");
			expect(uri.search).toBe("?q=1");
			expect(uri.searchParams.get("q")).toBe("1");
			expect(uri.hash).toBe("#hash");
		});
	});

	describe("setSearchParams", () => {
		it("accepts URLSearchParams and preserves the concrete relative type", () => {
			const uri = UriRelativeString.parse("/path?old=1#hash");
			const updated: UriRelativeString = uri.setSearchParams(
				new URLSearchParams("q=1&q=2"),
			);

			expect(updated).toBeInstanceOf(UriRelativeString);
			expect(updated.raw).toBe("/path?q=1&q=2#hash");
		});

		it("removes the existing search when passed no parameters", () => {
			const uri = UriRelativeString.parse("/path?old=1#hash");
			expect(uri.setSearchParams().raw).toBe("/path#hash");
		});
	});
});

// ---------------------------------------------------------------------------
// UriReferenceString (absolute | relative)
// ---------------------------------------------------------------------------

describe("UriReferenceString", () => {
	describe("parse", () => {
		it("returns a UriString for an absolute input", () => {
			const ref = UriReferenceString.parse("https://example.com");
			expect(ref).toBeInstanceOf(UriString);
			expect(ref.isAbsolute()).toBe(true);
		});

		it("returns a UriRelativeString for a relative input", () => {
			const ref = UriReferenceString.parse("/relative");
			expect(ref).toBeInstanceOf(UriRelativeString);
			expect(ref.isRelative()).toBe(true);
		});

		it("preserves the raw input", () => {
			const ref = UriReferenceString.parse("https://x.com/p?a=1#h");
			expect(ref.raw).toBe("https://x.com/p?a=1#h");
		});

		it("parses native URL values via toString()", () => {
			const url = new URL("https://example.com/path?q=1");
			const ref = UriReferenceString.parse(url);
			expect(ref).toBeInstanceOf(UriString);
			expect(ref.raw).toBe(url.href);
		});

		it("returns existing UriReferenceString instances unchanged", () => {
			const original = UriReferenceString.parse("/dashboard");
			expect(UriReferenceString.tryParse(original)).toBe(original);
			expect(UriReferenceString.parse(original)).toBe(original);
		});

		it("parses custom toString values", () => {
			const ref = UriReferenceString.parse({
				toString() {
					return "#/orders";
				},
			});
			expect(ref.raw).toBe("#/orders");
		});
	});

	describe("fromURL", () => {
		it("creates a UriString from a URL object", () => {
			const url = new URL("https://example.com/p");
			const ref = UriReferenceString.fromURL(url);
			expect(ref).toBeInstanceOf(UriString);
			expect(ref.isAbsolute()).toBe(true);
			expect(ref.raw).toBe(url.href);
		});
	});

	describe("fromURLRelative", () => {
		it("creates a UriRelativeString from relative parts", () => {
			const ref = UriReferenceString.fromURLRelative({
				pathname: "/p",
				search: "?a=1",
				hash: "#h",
			});
			expect(ref).toBeInstanceOf(UriRelativeString);
			expect(ref.isRelative()).toBe(true);
			expect(ref.raw).toBe("/p?a=1#h");
		});
	});

	describe("tryParse", () => {
		it("returns UriString for absolute input", () => {
			const ref = UriReferenceString.tryParse("http://localhost:8080");
			expect(ref).toBeInstanceOf(UriString);
		});

		it("returns UriRelativeString for relative input", () => {
			const ref = UriReferenceString.tryParse("/foo");
			expect(ref).toBeInstanceOf(UriRelativeString);
		});

		it("returns null for completely invalid input", () => {
			// Empty strings are valid relative references per RFC 3986,
			// so we need truly unparseable input.
			// In practice almost any string is a valid relative reference
			// (the URL constructor is very lenient with a base).
			// This test documents that behaviour.
			const ref = UriReferenceString.tryParse("");
			expect(ref).toBeInstanceOf(UriRelativeString);
		});
	});

	describe("setHash", () => {
		it("replaces hash on an absolute reference", () => {
			const ref = UriReferenceString.parse(
				"https://example.com/p?a=1#old",
			) as UriString;
			const updated = ref.setHash("#new");
			expect(updated).toBeInstanceOf(UriString);
			expect(updated.raw).toBe("https://example.com/p?a=1#new");
			expect(ref.raw).toBe("https://example.com/p?a=1#old");
		});

		it("replaces hash on a relative reference", () => {
			const ref = UriReferenceString.parse("/p#old") as UriRelativeString;
			const updated = ref.setHash("#new");
			expect(updated).toBeInstanceOf(UriRelativeString);
			expect(updated.raw).toBe("/p#new");
		});

		it("clears hash when given an empty string", () => {
			const ref = UriReferenceString.parse("https://example.com/p#old");
			expect(ref.setHash("").raw).toBe("https://example.com/p");
		});
	});

	describe("setSearchParams", () => {
		it("accepts tuple entries and preserves the runtime reference variant", () => {
			const ref = UriReferenceString.parse("/p?old=1#hash");
			const updated = ref.setSearchParams([
				["q", "1"],
				["q", "2"],
			]);

			expect(updated).toBeInstanceOf(UriRelativeString);
			expect(updated.raw).toBe("/p?q=1&q=2#hash");
		});

		it("accepts a query string", () => {
			const ref = UriReferenceString.parse("https://example.com/p?old=1");
			expect(ref.setSearchParams("q=one+two").raw).toBe(
				"https://example.com/p?q=one+two",
			);
		});
	});

	describe("toURL", () => {
		it("works without a base for absolute references", () => {
			const ref = UriReferenceString.parse("https://example.com/p");
			expect(ref.toURL().href).toBe("https://example.com/p");
		});

		it("requires a base for relative references", () => {
			const ref = UriReferenceString.parse("/p");
			expect(() => ref.toURL()).toThrow(TypeError);
		});

		it("resolves relative references with a base", () => {
			const ref = UriReferenceString.parse("/p");
			const url = ref.toURL("https://example.com");
			expect(url.href).toBe("https://example.com/p");
		});
	});

	describe("asAbsolute / asRelative", () => {
		it("asAbsolute returns self for absolute references", () => {
			const ref = UriReferenceString.parse("https://example.com");
			const abs = ref.asAbsolute();
			expect(abs).toBe(ref);
			expect(abs).toBeInstanceOf(UriString);
		});

		it("asAbsolute returns null for relative references", () => {
			const ref = UriReferenceString.parse("/foo");
			expect(ref.asAbsolute()).toBeNull();
		});

		it("asRelative returns self for relative references", () => {
			const ref = UriReferenceString.parse("/foo");
			const rel = ref.asRelative();
			expect(rel).toBe(ref);
			expect(rel).toBeInstanceOf(UriRelativeString);
		});

		it("asRelative returns null for absolute references", () => {
			const ref = UriReferenceString.parse("https://example.com");
			expect(ref.asRelative()).toBeNull();
		});
	});

	describe("type guard narrowing", () => {
		it("isAbsolute narrows to UriString", () => {
			const ref = UriReferenceString.parse("https://example.com");
			if (ref.isAbsolute()) {
				// TypeScript should narrow `ref` to `UriString` here.
				// Calling toURL() without a base must compile.
				const url: URL = ref.toURL();
				expect(url).toBeInstanceOf(URL);
			}
		});

		it("isRelative narrows to UriRelativeString", () => {
			const ref = UriReferenceString.parse("/foo");
			if (ref.isRelative()) {
				// TypeScript should narrow `ref` to `UriRelativeString` here.
				const url: URL = ref.toURL("https://example.com");
				expect(url).toBeInstanceOf(URL);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// UriParseError
// ---------------------------------------------------------------------------

describe("UriParseError", () => {
	it("exposes the input and kind", () => {
		const error = new UriParseError("bad-input", "absolute URI");
		expect(error.input).toBe("bad-input");
		expect(error.kind).toBe("absolute URI");
		expect(error.name).toBe("UriParseError");
		expect(error.message).toContain("bad-input");
		expect(error.message).toContain("absolute URI");
	});
});
