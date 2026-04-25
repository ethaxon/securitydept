function toPublishedWorkspaceVersion(workspaceSpecifier, publishedVersion) {
	const rawSpecifier = workspaceSpecifier.slice("workspace:".length);

	if (rawSpecifier === "*" || rawSpecifier === "") {
		return publishedVersion;
	}

	if (rawSpecifier === "^") {
		return `^${publishedVersion}`;
	}

	if (rawSpecifier === "~") {
		return `~${publishedVersion}`;
	}

	if (rawSpecifier.startsWith("^") || rawSpecifier.startsWith("~")) {
		return rawSpecifier;
	}

	return publishedVersion;
}

function rewriteWorkspaceProtocols(dependencies, publishedVersion) {
	if (!dependencies) {
		return false;
	}

	let changed = false;
	for (const [dependencyName, dependencyVersion] of Object.entries(
		dependencies,
	)) {
		if (!dependencyName.startsWith("@securitydept/")) {
			continue;
		}

		if (!dependencyVersion.startsWith("workspace:")) {
			continue;
		}

		dependencies[dependencyName] = toPublishedWorkspaceVersion(
			dependencyVersion,
			publishedVersion,
		);
		changed = true;
	}

	return changed;
}

function stripMonorepoTscExports(exportsField) {
	if (!exportsField || typeof exportsField !== "object") {
		return false;
	}

	let changed = false;
	if (Object.hasOwn(exportsField, "monorepo-tsc")) {
		delete exportsField["monorepo-tsc"];
		changed = true;
	}

	for (const nestedValue of Object.values(exportsField)) {
		if (stripMonorepoTscExports(nestedValue)) {
			changed = true;
		}
	}

	return changed;
}

module.exports = {
	hooks: {
		beforePacking(pkg) {
			const dependencyFields = [
				"dependencies",
				"peerDependencies",
				"optionalDependencies",
				"devDependencies",
			];

			for (const field of dependencyFields) {
				rewriteWorkspaceProtocols(pkg[field], pkg.version);
			}

			stripMonorepoTscExports(pkg.exports);

			if (pkg.name.endsWith("-angular")) {
				delete pkg.files;
				delete pkg.devDependencies;
			}

			return pkg;
		},
	},
};
