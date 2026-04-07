// @securitydept/client — Foundation validation baseline
//
// Provides a vendor-neutral validation entry aligned with @standard-schema/spec.
// Any StandardSchemaV1-compatible schema (zod, valibot, arktype, etc.) can be
// used as the validation contract.
//
// Design principles:
//   - The foundation owns the validate-and-interpret contract
//   - Individual SDK packages supply schemas that implement StandardSchemaV1
//   - Consumers never need to know which validation library produced the schema

import type { StandardSchemaV1 } from "@standard-schema/spec";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Successful validation result.
 *
 * Contains the parsed, typed output value from the schema.
 */
export interface ValidationSuccess<T> {
	readonly success: true;
	readonly value: T;
}

/**
 * Failed validation result.
 *
 * Contains the list of issues reported by the schema.
 */
export interface ValidationFailure {
	readonly success: false;
	readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}

/**
 * Discriminated union of validation outcomes.
 *
 * Consumers can narrow on `success` to access either the typed value
 * or the issue list.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ---------------------------------------------------------------------------
// Core validation function
// ---------------------------------------------------------------------------

/**
 * Validate an unknown input against a `@standard-schema`-compatible schema.
 *
 * This is the foundation-level entry point for SDK validation. It accepts
 * any schema implementing `StandardSchemaV1` and returns a discriminated
 * `ValidationResult`.
 *
 * @example
 * ```ts
 * import { validateWithSchema } from "@securitydept/client";
 * import { z } from "zod";
 *
 * const UserSchema = z.object({ name: z.string() });
 * const result = await validateWithSchema(UserSchema, { name: "Alice" });
 * if (result.success) {
 *   console.log(result.value.name);
 * } else {
 *   console.error(result.issues);
 * }
 * ```
 */
export async function validateWithSchema<I, O>(
	schema: StandardSchemaV1<I, O>,
	input: unknown,
): Promise<ValidationResult<O>> {
	const result = await schema["~standard"].validate(input);

	if ("value" in result) {
		return { success: true, value: result.value };
	}

	return { success: false, issues: result.issues };
}

/**
 * Validate an unknown input synchronously against a `@standard-schema`-compatible schema.
 *
 * Only use this when you know the schema's validate function returns synchronously.
 * Throws if the schema returns a Promise.
 */
export function validateWithSchemaSync<I, O>(
	schema: StandardSchemaV1<I, O>,
	input: unknown,
): ValidationResult<O> {
	const result = schema["~standard"].validate(input);

	if (result instanceof Promise) {
		throw new Error(
			"validateWithSchemaSync: schema returned a Promise. Use validateWithSchema instead.",
		);
	}

	if ("value" in result) {
		return { success: true, value: result.value };
	}

	return { success: false, issues: result.issues };
}

// ---------------------------------------------------------------------------
// Schema creation helper (minimal, vendor-neutral)
// ---------------------------------------------------------------------------

/**
 * Options for creating a foundation schema.
 */
export interface CreateSchemaOptions<O> {
	/** Validation function: returns typed output or returns issues. */
	readonly validate: (
		input: unknown,
	) =>
		| { readonly value: O }
		| { readonly issues: ReadonlyArray<StandardSchemaV1.Issue> };
}

/**
 * Create a minimal `@standard-schema`-compatible schema without requiring
 * an external validation library.
 *
 * This is useful for SDK-internal schemas where pulling in zod/valibot
 * would be excessive. For adopter-facing schemas, prefer a real validation
 * library.
 *
 * @example
 * ```ts
 * import { createSchema, validateWithSchema } from "@securitydept/client";
 *
 * const NameSchema = createSchema<unknown, { name: string }>({
 *   validate(input) {
 *     if (typeof input === "object" && input !== null && "name" in input &&
 *         typeof (input as any).name === "string") {
 *       return { value: { name: (input as any).name } };
 *     }
 *     return { issues: [{ message: "Expected object with string 'name'" }] };
 *   },
 * });
 *
 * const result = await validateWithSchema(NameSchema, { name: "Alice" });
 * ```
 */
export function createSchema<O>(
	options: CreateSchemaOptions<O>,
): StandardSchemaV1<unknown, O> {
	return {
		"~standard": {
			version: 1,
			vendor: "securitydept",
			validate: options.validate,
		},
	};
}
