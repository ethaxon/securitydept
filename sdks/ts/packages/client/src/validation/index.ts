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

import { type StandardSchemaV1 } from "@standard-schema/spec";
import { ClientError, ClientErrorKind, UserRecovery } from "../errors";

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

export type TraitInputValidator = StandardSchemaV1<unknown, unknown>;

export type TraitInputBundledSchema = StandardSchemaV1<unknown, unknown>;

export interface WithTraitInputValidator<TValidator = TraitInputValidator> {
	validators?: TValidator;
}

export interface ValidateTraitInputOptions {
	value: unknown;
	bundledSchema: TraitInputBundledSchema;
	validator?: TraitInputValidator;
	optional?: boolean;
	onInvalid(failure: ValidationFailure): never;
}

export function formatValidationFailure(
	failure: ValidationFailure | undefined,
): string | null {
	if (!failure) {
		return null;
	}
	const summary = failure.issues
		.map((issue) =>
			issue.path && issue.path.length > 0
				? `${issue.path.join(".")}: ${issue.message}`
				: issue.message,
		)
		.join("; ");
	return summary.length > 0 ? summary : null;
}

export function throwValidationClientError(options: {
	code: string;
	source: string;
	messagePrefix: string;
	failure?: ValidationFailure;
}): never {
	const issueSummary = formatValidationFailure(options.failure);
	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: options.code,
		message: issueSummary
			? `${options.messagePrefix}: ${issueSummary}.`
			: `${options.messagePrefix}.`,
		recovery: UserRecovery.RestartFlow,
		source: options.source,
		cause: options.failure?.issues,
	});
}

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

export function validateTraitInput(options: ValidateTraitInputOptions): void {
	if (
		options.optional === true &&
		(options.value === undefined || options.value === null)
	) {
		return;
	}
	const validator = options.validator ?? options.bundledSchema;
	const result = validateWithSchemaSync(validator, options.value);
	if (result.success) {
		return;
	}
	options.onInvalid(result);
}
