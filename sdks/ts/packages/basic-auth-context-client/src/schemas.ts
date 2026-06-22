import { type as defineType } from "arktype";

export const BasicAuthZoneConfigSchema = defineType({
	zonePrefix: "string > 0",
	"loginSubpath?": "string",
});

export const BasicAuthContextClientConfigSchema = defineType({
	"id?": "string > 0",
	baseUrl: "string > 0",
	zones: BasicAuthZoneConfigSchema.array().atLeastLength(1),
	"probePath?": "string > 0",
	"autoStart?": "boolean",
	"tracing?": {
		"target?": "string > 0",
		"prefix?": "string > 0",
	},
});
