import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import toml from "toml";

type CargoDependency = {
	name: string;
	optional: boolean;
	features: string[];
};

type CargoPackage = {
	name: string;
	manifestPath: string;
	dependencies: CargoDependency[];
	features: Record<string, string[]>;
};

type InternalReexportCrate = {
	feature: string;
	packageName: string;
	title: string;
	rustCrate: string;
	exportAlias: string;
};

const ROOT = process.cwd();
const CORE_MANIFEST_PATH = path.join(ROOT, "packages/core/Cargo.toml");
const CORE_LIB_PATH = path.join(ROOT, "packages/core/src/lib.rs");

const INTERNAL_REEXPORT_CRATES: InternalReexportCrate[] = [
	{
		feature: "auth-runtime",
		packageName: "securitydept-auth-runtime",
		title: "Auth Runtime",
		rustCrate: "securitydept_auth_runtime",
		exportAlias: "auth_runtime",
	},
	{
		feature: "basic-auth-context",
		packageName: "securitydept-basic-auth-context",
		title: "Basic Auth Context",
		rustCrate: "securitydept_basic_auth_context",
		exportAlias: "basic_auth_context",
	},
	{
		feature: "creds",
		packageName: "securitydept-creds",
		title: "Creds",
		rustCrate: "securitydept_creds",
		exportAlias: "creds",
	},
	{
		feature: "creds-manage",
		packageName: "securitydept-creds-manage",
		title: "Creds Manage",
		rustCrate: "securitydept_creds_manage",
		exportAlias: "creds_manage",
	},
	{
		feature: "oauth-provider",
		packageName: "securitydept-oauth-provider",
		title: "Oauth Provider",
		rustCrate: "securitydept_oauth_provider",
		exportAlias: "oauth_provider",
	},
	{
		feature: "oauth-resource-server",
		packageName: "securitydept-oauth-resource-server",
		title: "Oauth Resource Server",
		rustCrate: "securitydept_oauth_resource_server",
		exportAlias: "oauth_resource_server",
	},
	{
		feature: "oidc-client",
		packageName: "securitydept-oidc-client",
		title: "Oidc Client",
		rustCrate: "securitydept_oidc_client",
		exportAlias: "oidc",
	},
	{
		feature: "realip",
		packageName: "securitydept-realip",
		title: "Realip",
		rustCrate: "securitydept_realip",
		exportAlias: "realip",
	},
	{
		feature: "session-context",
		packageName: "securitydept-session-context",
		title: "Session Context",
		rustCrate: "securitydept_session_context",
		exportAlias: "session_context",
	},
	{
		feature: "token-set-context",
		packageName: "securitydept-token-set-context",
		title: "Token Set Context",
		rustCrate: "securitydept_token_set_context",
		exportAlias: "token_set_context",
	},
	{
		feature: "utils",
		packageName: "securitydept-utils",
		title: "Utils",
		rustCrate: "securitydept_utils",
		exportAlias: "utils",
	},
];

const STANDALONE_EXTERNAL_REEXPORTS = new Map<string, string>([
	["oauth2", "reexport-oauth2"],
	["openidconnect", "reexport-openidconnect"],
	["jsonwebtoken", "reexport-jsonwebtoken"],
	["josekit", "reexport-josekit"],
]);

const EXCLUDED_FEATURE_PATTERNS = [/(?:^|[-_])test$/];

function main() {
	const corePackage = parseCargoPackage(CORE_MANIFEST_PATH);
	const coreDependencyNames = new Set(
		corePackage.dependencies.map((dependency) => dependency.name),
	);
	const exportedPackages = new Map<string, string>(
		INTERNAL_REEXPORT_CRATES.map((item) => [item.packageName, item.feature]),
	);
	const packageMap = new Map(
		INTERNAL_REEXPORT_CRATES.map((item) => {
			const manifestPath = path.join(
				ROOT,
				"packages",
				item.packageName.replace("securitydept-", ""),
				"Cargo.toml",
			);
			return [item.packageName, parseCargoPackage(manifestPath)] as const;
		}),
	);
	const generatedFeatures = new Map<string, string[]>();

	for (const [externalCrate, featureName] of STANDALONE_EXTERNAL_REEXPORTS) {
		const deps =
			externalCrate === "openidconnect"
				? ["dep:openidconnect", "reexport-oauth2"]
				: [`dep:${externalCrate}`];
		generatedFeatures.set(featureName, deps);
	}

	for (const item of INTERNAL_REEXPORT_CRATES) {
		const cargoPackage = packageMap.get(item.packageName);
		if (!cargoPackage) {
			throw new Error(`Missing cargo package for ${item.packageName}`);
		}

		generatedFeatures.set(
			item.feature,
			buildRootFeatureDeps(cargoPackage, exportedPackages),
		);

		for (const featureName of Object.keys(cargoPackage.features)) {
			if (shouldSkipFeature(featureName)) {
				continue;
			}

			generatedFeatures.set(
				`${item.feature}-${featureName}`,
				buildNestedFeatureDeps(
					cargoPackage,
					item.feature,
					featureName,
					exportedPackages,
					coreDependencyNames,
				),
			);
		}
	}

	const fullFeatureDeps = [
		...STANDALONE_EXTERNAL_REEXPORTS.values(),
		...buildOrderedFeatureNames(),
	];

	const featuresSection = renderFeaturesSection(
		packageMap,
		generatedFeatures,
		fullFeatureDeps,
	);
	const coreManifest = readFileSync(CORE_MANIFEST_PATH, "utf8");
	const nextManifest = coreManifest.replace(
		/\[features\][\s\S]*?\n(?=\[dependencies\])/m,
		`${featuresSection}\n`,
	);
	const nextLibSource = renderCoreLibSource();
	const currentLibSource = readFileSync(CORE_LIB_PATH, "utf8");

	if (nextManifest === coreManifest && nextLibSource === currentLibSource) {
		console.log(
			"packages/core/Cargo.toml and src/lib.rs are already up to date",
		);
		return;
	}

	writeFileSync(CORE_MANIFEST_PATH, nextManifest);
	writeFileSync(CORE_LIB_PATH, nextLibSource);
	console.log(
		"Updated packages/core/Cargo.toml feature gates and src/lib.rs reexports",
	);
}

function parseCargoPackage(manifestPath: string): CargoPackage {
	const source = readFileSync(manifestPath, "utf8");
	const parsed = toml.parse(source) as {
		package?: { name?: string };
		dependencies?: Record<string, unknown>;
		features?: Record<string, unknown>;
	};
	const nameValue = parsed.package?.name;

	if (!nameValue) {
		throw new Error(`Missing [package].name in ${manifestPath}`);
	}

	const dependencies = Object.entries(parsed.dependencies ?? {}).map(
		([key, value]) => parseDependencyEntry(key, value),
	);
	const features = Object.fromEntries(
		Object.entries(parsed.features ?? {}).map(([key, value]) => [
			key,
			parseStringArray(value),
		]),
	);

	return {
		name: nameValue,
		manifestPath,
		dependencies,
		features,
	};
}
function parseDependencyEntry(key: string, value: unknown): CargoDependency {
	if (typeof value === "string") {
		return {
			name: key,
			optional: false,
			features: [],
		};
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Unsupported dependency format for ${key}`);
	}

	const record = value as {
		package?: unknown;
		optional?: unknown;
		features?: unknown;
	};
	const packageName = typeof record.package === "string" ? record.package : key;
	const optional = record.optional === true;
	const features = parseStringArray(record.features);

	return {
		name: packageName,
		optional,
		features,
	};
}

function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string");
}

function buildRootFeatureDeps(
	pkg: CargoPackage,
	exportedPackages: Map<string, string>,
): string[] {
	const deps = new Set<string>([`dep:${pkg.name}`]);

	for (const dependency of pkg.dependencies) {
		if (dependency.optional) {
			continue;
		}

		for (const featureName of mapDependencyToCoreFeatures(
			dependency,
			exportedPackages,
		)) {
			deps.add(featureName);
		}
	}

	return [...deps];
}

function buildNestedFeatureDeps(
	pkg: CargoPackage,
	rootFeatureName: string,
	featureName: string,
	exportedPackages: Map<string, string>,
	coreDependencyNames: Set<string>,
): string[] {
	const deps = new Set<string>([rootFeatureName, `${pkg.name}/${featureName}`]);

	for (const rawItem of pkg.features[featureName] ?? []) {
		const mapped = mapFeatureItem(
			rawItem,
			rootFeatureName,
			exportedPackages,
			coreDependencyNames,
		);
		if (mapped) {
			deps.add(mapped);
		}
	}

	return [...deps];
}

function mapDependencyToCoreFeatures(
	dependency: CargoDependency,
	exportedPackages: Map<string, string>,
): string[] {
	const rootFeature = exportedPackages.get(dependency.name);
	if (rootFeature) {
		if (dependency.features.length === 0) {
			return [rootFeature];
		}

		return dependency.features.map(
			(featureName) => `${rootFeature}-${featureName}`,
		);
	}

	const externalFeature = STANDALONE_EXTERNAL_REEXPORTS.get(dependency.name);
	return externalFeature ? [externalFeature] : [];
}

function mapFeatureItem(
	rawItem: string,
	rootFeatureName: string,
	exportedPackages: Map<string, string>,
	coreDependencyNames: Set<string>,
): string | null {
	if (rawItem.startsWith("dep:")) {
		const dependencyName = rawItem.slice("dep:".length);
		const internalRootFeature = exportedPackages.get(dependencyName);
		if (internalRootFeature) {
			return internalRootFeature;
		}

		if (STANDALONE_EXTERNAL_REEXPORTS.has(dependencyName)) {
			return STANDALONE_EXTERNAL_REEXPORTS.get(dependencyName) ?? null;
		}

		return coreDependencyNames.has(dependencyName) ? rawItem : null;
	}

	if (rawItem.includes("/")) {
		const [dependencyName, dependencyFeature] = rawItem.split("/", 2);
		const internalRootFeature = exportedPackages.get(dependencyName);
		if (internalRootFeature) {
			return `${internalRootFeature}-${dependencyFeature}`;
		}

		return coreDependencyNames.has(dependencyName) ? rawItem : null;
	}

	return `${rootFeatureName}-${rawItem}`;
}

function buildOrderedFeatureNames(): string[] {
	const ordered: string[] = [];

	for (const item of INTERNAL_REEXPORT_CRATES) {
		ordered.push(item.feature);
		const cargoPackage = parseCargoPackage(
			path.join(
				ROOT,
				"packages",
				item.packageName.replace("securitydept-", ""),
				"Cargo.toml",
			),
		);

		for (const featureName of Object.keys(cargoPackage.features)) {
			if (shouldSkipFeature(featureName)) {
				continue;
			}

			ordered.push(`${item.feature}-${featureName}`);
		}
	}

	return ordered;
}

function shouldSkipFeature(featureName: string): boolean {
	return EXCLUDED_FEATURE_PATTERNS.some((pattern) => pattern.test(featureName));
}

function renderFeaturesSection(
	packageMap: Map<string, CargoPackage>,
	features: Map<string, string[]>,
	fullFeatureDeps: string[],
): string {
	const lines = [
		"[features]",
		"# Keep this in sync with all user-facing features below.",
		"# IMPORTANT: Any new feature added to this crate must also be added to `full`.",
		renderFeature("full", fullFeatureDeps),
		"",
		"# Reexports",
		renderFeature("reexport-oauth2", features.get("reexport-oauth2") ?? []),
		renderFeature(
			"reexport-openidconnect",
			features.get("reexport-openidconnect") ?? [],
		),
		renderFeature(
			"reexport-jsonwebtoken",
			features.get("reexport-jsonwebtoken") ?? [],
		),
		renderFeature("reexport-josekit", features.get("reexport-josekit") ?? []),
	];

	for (const item of INTERNAL_REEXPORT_CRATES) {
		const cargoPackage = packageMap.get(item.packageName);
		if (!cargoPackage) {
			throw new Error(`Missing cargo package for ${item.packageName}`);
		}

		lines.push("");
		lines.push(`# ${item.title}`);
		lines.push(renderFeature(item.feature, features.get(item.feature) ?? []));

		for (const featureName of Object.keys(cargoPackage.features)) {
			if (shouldSkipFeature(featureName)) {
				continue;
			}

			lines.push(
				renderFeature(
					`${item.feature}-${featureName}`,
					features.get(`${item.feature}-${featureName}`) ?? [],
				),
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

function renderFeature(name: string, deps: string[]): string {
	if (deps.length === 0) {
		return `${name} = []`;
	}

	if (deps.length === 1) {
		return `${name} = ["${deps[0]}"]`;
	}

	return `${name} = [\n${deps.map((dep) => `    "${dep}",`).join("\n")}\n]`;
}

function renderCoreLibSource(): string {
	const lines = [
		'#[cfg(feature = "reexport-josekit")]',
		"pub use josekit;",
		'#[cfg(feature = "reexport-jsonwebtoken")]',
		"pub use jsonwebtoken;",
		'#[cfg(feature = "reexport-oauth2")]',
		"pub use oauth2;",
		'#[cfg(feature = "reexport-openidconnect")]',
		"pub use openidconnect;",
	];

	for (const item of INTERNAL_REEXPORT_CRATES) {
		lines.push(`#[cfg(feature = "${item.feature}")]`);
		if (item.rustCrate === item.exportAlias) {
			lines.push(`pub use ${item.rustCrate};`);
		} else {
			lines.push(`pub use ${item.rustCrate} as ${item.exportAlias};`);
		}
	}

	return `${lines.join("\n")}\n`;
}

main();
