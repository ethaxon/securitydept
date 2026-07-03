export const SpanSharedAttributeName = {
	ClientName: "client.name",
	ClientId: "client.id",
	OperationName: "operation.name",
} as const;

export type SpanSharedAttributeName =
	(typeof SpanSharedAttributeName)[keyof typeof SpanSharedAttributeName];
