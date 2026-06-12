// Sentinel base used internally to parse relative URIs via the URL constructor.
// The specific value is never exposed; it only serves as a structural anchor
// so that `new URL(relativeInput, SENTINEL_BASE)` succeeds.
const RELATIVE_URI_SENTINEL_BASE = "http://localhost";

/**
 * Thrown when a string cannot be parsed into the requested URI variant.
 */
export class UriParseError extends Error {
	readonly input: string;
	readonly kind: string;

	constructor(input: string, kind: string, options?: ErrorOptions) {
		super(`Failed to parse "${input}" as ${kind}`, options);
		this.name = "UriParseError";
		this.input = input;
		this.kind = kind;
	}
}

/**
 * The relative components of a URL — pathname, search, and hash.
 *
 * All fields use the same format as the native `URL` accessors:
 * - `pathname` starts with `/` (e.g. `"/path"`).
 * - `search` includes the leading `?` when present (e.g. `"?q=1"`).
 * - `hash` includes the leading `#` when present (e.g. `"#section"`).
 */
export interface UriRelativeParts {
	readonly pathname: string;
	readonly search: string;
	readonly hash: string;
}

/**
 * Minimal structural type for URI fragment parsing.
 *
 * Matches any value that exposes a URL-style `hash` accessor — for example
 * `URL`, `Location`, or {@link UriReferenceString}.
 */
export interface UriFragmentPart {
	readonly hash: string;
}

/**
 * Minimal structural type for URI reference parsing.
 *
 * Matches any value that can be serialized via `toString()` — for example
 * native `URL`, `Location`, or {@link UriReferenceString}.
 */
export interface UriReferenceStringLike {
	toString(): string;
}

export type UriReferenceStringInput = string | UriReferenceStringLike;

export type UriSearchParamsInit = NonNullable<
	ConstructorParameters<typeof URLSearchParams>[0]
>;

// ---------------------------------------------------------------------------
// UriReferenceString — the URI-reference supertype (absolute | relative)
// ---------------------------------------------------------------------------

/**
 * Immutable wrapper around a URI-reference string.
 *
 * A URI-reference (RFC 3986 §4.1) is either an absolute URI or a relative
 * reference.  Concrete subclasses {@link UriString} and
 * {@link UriRelativeString} carry the additional type-level guarantee of
 * which variant they hold.
 *
 * Instances created via `UriReferenceString.parse` / `.tryParse` are always
 * one of the two subclasses, so {@link isAbsolute} and {@link isRelative}
 * narrow correctly.
 */
export class UriReferenceString {
	/** The original, unmodified input string. */
	protected readonly _raw: string;

	/**
	 * Eagerly parsed URL helper.
	 *
	 * - Absolute URIs: `new URL(raw)`.
	 * - Relative URIs: `new URL(raw, RELATIVE_URI_SENTINEL_BASE)`.
	 *
	 * For relative URIs the scheme and host originate from the sentinel and
	 * MUST NOT be used for origin-sensitive operations.
	 */
	protected readonly _parsed: URL;

	protected readonly _isAbsolute: boolean;

	protected constructor(raw: string, parsed: URL, isAbsolute: boolean) {
		this._raw = raw;
		this._parsed = parsed;
		this._isAbsolute = isAbsolute;
	}

	// ---- Static factories ------------------------------------------------

	/**
	 * Parse any valid URI reference (absolute or relative).
	 *
	 * The returned instance is always a {@link UriString} or
	 * {@link UriRelativeString}.
	 *
	 * @throws {UriParseError} when the input is not a valid URI reference.
	 */
	static parse(input: UriReferenceStringInput): UriReferenceString {
		const result = UriReferenceString.tryParse(input);
		if (!result) {
			throw new UriParseError(
				typeof input === "string" ? input : input.toString(),
				"URI reference",
			);
		}
		return result;
	}

	/**
	 * Try to parse a URI reference, returning `null` on failure.
	 *
	 * The returned instance is always a {@link UriString} or
	 * {@link UriRelativeString}.
	 */
	static tryParse(input: UriReferenceStringInput): UriReferenceString | null {
		if (input instanceof UriReferenceString) {
			return input;
		}
		const source = typeof input === "string" ? input : input.toString();
		return UriString.tryParse(source) ?? UriRelativeString.tryParse(source);
	}

	/** Create from a native `URL`. Always produces a {@link UriString}. */
	static fromURL(url: URL): UriString {
		return UriString.fromURL(url);
	}

	/**
	 * Create from the relative components of a URL.
	 * Always produces a {@link UriRelativeString}.
	 */
	static fromURLRelative(parts: UriRelativeParts): UriRelativeString {
		return UriRelativeString.fromURLRelative(parts);
	}

	// ---- Accessors -------------------------------------------------------

	/** The original input string. */
	get raw(): string {
		return this._raw;
	}

	get pathname(): string {
		return this._parsed.pathname;
	}

	get hash(): string {
		return this._parsed.hash;
	}

	get search(): string {
		return this._parsed.search;
	}

	get searchParams(): URLSearchParams {
		return this._parsed.searchParams;
	}

	// ---- Type narrowing --------------------------------------------------

	/** Type-guard: narrows to {@link UriString} when the reference is absolute. */
	isAbsolute(): this is UriString {
		return this._isAbsolute;
	}

	/** Type-guard: narrows to {@link UriRelativeString} when the reference is relative. */
	isRelative(): this is UriRelativeString {
		return !this._isAbsolute;
	}

	/** Narrow to {@link UriString} or return `null`. */
	asAbsolute(): UriString | null {
		return this.isAbsolute() ? this : null;
	}

	/** Narrow to {@link UriRelativeString} or return `null`. */
	asRelative(): UriRelativeString | null {
		return this.isRelative() ? this : null;
	}

	// ---- Mutation (immutable) --------------------------------------------

	/**
	 * Returns a new instance with `hash` replaced.
	 *
	 * @param value URL-style hash, including a leading `#` when non-empty.
	 */
	setHash(value: string): this {
		const hashIndex = this._raw.indexOf("#");
		const base = hashIndex >= 0 ? this._raw.slice(0, hashIndex) : this._raw;
		return UriReferenceString.parse(`${base}${value}`) as this;
	}

	/** Returns a new instance with the complete query parameter set replaced. */
	setSearchParams(init?: UriSearchParamsInit): this {
		const hashIndex = this._raw.indexOf("#");
		const hash = hashIndex >= 0 ? this._raw.slice(hashIndex) : "";
		const withoutHash =
			hashIndex >= 0 ? this._raw.slice(0, hashIndex) : this._raw;
		const searchIndex = withoutHash.indexOf("?");
		const base =
			searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
		const search = new URLSearchParams(init).toString();
		return UriReferenceString.parse(
			`${base}${search.length > 0 ? `?${search}` : ""}${hash}`,
		) as this;
	}

	// ---- Conversion ------------------------------------------------------

	/**
	 * Convert to a native `URL`.
	 *
	 * A `base` is required when the reference is relative; it is ignored
	 * for absolute references.
	 *
	 * @throws {TypeError} when the reference is relative and no base is provided.
	 */
	toURL(base?: string | URL): URL {
		if (this._isAbsolute) {
			return new URL(this._parsed.href);
		}
		if (base == null) {
			throw new TypeError(
				"A base URL is required to convert a relative URI reference to a URL",
			);
		}
		return new URL(this._raw, base);
	}

	toString(): string {
		return this._raw;
	}

	valueOf(): string {
		return this._raw;
	}

	toJSON(): string {
		return this._raw;
	}
}

// ---------------------------------------------------------------------------
// UriString — absolute URI (must include a scheme)
// ---------------------------------------------------------------------------

/**
 * Immutable wrapper around an absolute URI string.
 *
 * An absolute URI (RFC 3986 §4.3) always starts with a scheme component
 * (e.g. `https://example.com/path`).
 */
export class UriString extends UriReferenceString {
	protected constructor(raw: string, parsed: URL) {
		super(raw, parsed, true);
	}

	// ---- Static factories ------------------------------------------------

	/**
	 * Parse an absolute URI string.
	 *
	 * @throws {UriParseError} when the input is not a valid absolute URI.
	 */
	static override parse(input: string): UriString {
		const result = UriString.tryParse(input);
		if (!result) {
			throw new UriParseError(input, "absolute URI");
		}
		return result;
	}

	/**
	 * Try to parse an absolute URI, returning `null` if the input is not
	 * a valid absolute URI.
	 */
	static override tryParse(input: string | UriString): UriString | null {
		if (input instanceof UriString) {
			return input;
		}
		try {
			const parsed = new URL(input);
			return new UriString(input, parsed);
		} catch {
			return null;
		}
	}

	/** Create from a native `URL`, using its `href` as the raw string. */
	static override fromURL(url: URL): UriString {
		return new UriString(url.href, new URL(url.href));
	}

	/**
	 * Not supported — relative parts cannot produce an absolute URI.
	 *
	 * @throws {TypeError} unconditionally.
	 */
	static override fromURLRelative(_parts: UriRelativeParts): never {
		throw new TypeError(
			"Cannot create a UriString from relative URL parts. " +
				"Use UriRelativeString.fromURLRelative() or UriReferenceString.fromURLRelative() instead.",
		);
	}

	// ---- Accessors -------------------------------------------------------

	get host(): string {
		return this._parsed.host;
	}

	get hostname(): string {
		return this._parsed.hostname;
	}

	get origin(): string {
		return this._parsed.origin;
	}

	get password(): string {
		return this._parsed.password;
	}

	get port(): string {
		return this._parsed.port;
	}

	get protocol(): string {
		return this._parsed.protocol;
	}

	get username(): string {
		return this._parsed.username;
	}

	// ---- Conversion ------------------------------------------------------

	/** Convert to a native `URL`. No base is required for absolute URIs. */
	override toURL(): URL {
		return new URL(this.raw);
	}
}

// ---------------------------------------------------------------------------
// UriRelativeString — relative URI reference (no scheme)
// ---------------------------------------------------------------------------

/**
 * Immutable wrapper around a relative URI reference string.
 *
 * A relative reference (RFC 3986 §4.2) has no scheme and must be resolved
 * against a base URI to obtain an absolute URI.
 *
 * Internally, the raw string is parsed against a sentinel base
 * (`http://localhost`) to enable eager validation and URL-component
 * extraction.  The sentinel origin is never leaked through the public API.
 */
export class UriRelativeString extends UriReferenceString {
	protected constructor(raw: string, parsed: URL) {
		super(raw, parsed, false);
	}

	// ---- Static factories ------------------------------------------------

	/**
	 * Parse a relative URI reference.
	 *
	 * @throws {UriParseError} when the input is absolute or not a valid
	 *   relative URI reference.
	 */
	static override parse(input: string): UriRelativeString {
		const result = UriRelativeString.tryParse(input);
		if (!result) {
			throw new UriParseError(input, "relative URI reference");
		}
		return result;
	}

	/**
	 * Try to parse a relative URI reference, returning `null` if the input
	 * is an absolute URI or otherwise invalid.
	 */
	static override tryParse(
		input: string | UriRelativeString,
	): UriRelativeString | null {
		if (input instanceof UriRelativeString) {
			return input;
		}
		// Reject absolute URIs — they belong in UriString.
		try {
			new URL(input);
			return null;
		} catch {
			// Not absolute — fall through to relative parsing.
		}
		try {
			const parsed = new URL(input, RELATIVE_URI_SENTINEL_BASE);
			return new UriRelativeString(input, parsed);
		} catch {
			return null;
		}
	}

	/**
	 * Not supported — a native `URL` is always absolute and cannot be
	 * represented as a relative URI reference.
	 *
	 * @throws {TypeError} unconditionally.
	 */
	static override fromURL(_url: URL): never {
		throw new TypeError(
			"Cannot create a UriRelativeString from a URL; URLs are always absolute. " +
				"Use UriString.fromURL() or UriReferenceString.fromURL() instead.",
		);
	}

	/**
	 * Create from the relative components of a URL.
	 *
	 * Concatenates `pathname + search + hash` into a relative URI string.
	 */
	static override fromURLRelative(parts: UriRelativeParts): UriRelativeString {
		const raw = `${parts.pathname}${parts.search}${parts.hash}`;
		return UriRelativeString.parse(raw);
	}

	// ---- Conversion ------------------------------------------------------

	/**
	 * Convert to a native `URL` by resolving against the given base.
	 *
	 * @param base - The base URL to resolve against (required).
	 */
	override toURL(base: string | URL): URL {
		return new URL(this.raw, base);
	}
}
