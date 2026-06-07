export const ResourceErrorCode = {
	ValueUnavailable: "resource.value_unavailable",
} as const;

export type ResourceErrorCode =
	(typeof ResourceErrorCode)[keyof typeof ResourceErrorCode];

export interface ResourceValueUnavailableErrorOptions {
	readonly status: string;
}

export class ResourceError extends Error {
	override readonly name = "ResourceError";
	readonly code: ResourceErrorCode;
	readonly status?: string;

	constructor(
		message: string,
		options: { code: ResourceErrorCode; status?: string },
	) {
		super(message);
		this.code = options.code;
		this.status = options.status;
	}

	static valueUnavailable(
		options: ResourceValueUnavailableErrorOptions,
	): ResourceError {
		return new ResourceError(
			`Resource value is not available while status is "${options.status}".`,
			{
				code: ResourceErrorCode.ValueUnavailable,
				status: options.status,
			},
		);
	}
}
