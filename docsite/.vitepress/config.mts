import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { defineConfig } from "vitepress";

const REPO_URL = "https://github.com/ethaxon/securitydept";
const DOCSITE_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DOCSITE_ROOT, "..");

interface DocItem {
	en: string;
	zh: string;
	slug: string;
}

type MarkdownEnv = {
	path?: string;
	realPath?: string;
};

type MarkdownAttrs = [string, string][];

type MarkdownToken = {
	attrs: MarkdownAttrs | null;
	content: string;
	attrIndex(name: string): number;
};

type MarkdownRendererOptions = unknown;

type MarkdownRendererSelf = {
	renderToken(
		tokens: MarkdownToken[],
		idx: number,
		options: MarkdownRendererOptions,
	): string;
};

type MarkdownRenderRule = (
	tokens: MarkdownToken[],
	idx: number,
	options: MarkdownRendererOptions,
	env: MarkdownEnv,
	self: MarkdownRendererSelf,
) => string;

const DOC_ITEMS: DocItem[] = [
	{ slug: "000-OVERVIEW", en: "Overview", zh: "概览" },
	{ slug: "001-ARCHITECTURE", en: "Architecture", zh: "架构" },
	{ slug: "002-FEATURES", en: "Features", zh: "能力矩阵" },
	{
		slug: "005-ERROR_SYSTEM_DESIGN",
		en: "Error System Design",
		zh: "错误系统设计",
	},
	{ slug: "006-REALIP", en: "Real-IP", zh: "Real-IP" },
	{
		slug: "007-CLIENT_SDK_GUIDE",
		en: "Client SDK Guide",
		zh: "Client SDK 指南",
	},
	{
		slug: "020-AUTH_CONTEXT_AND_MODES",
		en: "Auth Context and Modes",
		zh: "认证上下文与模式",
	},
	{
		slug: "021-REFERENCE-APP-OUTPOSTS",
		en: "Outposts Calibration",
		zh: "Outposts Calibration",
	},
	{ slug: "100-ROADMAP", en: "Roadmap", zh: "路线图" },
	{
		slug: "110-TS_SDK_MIGRATIONS",
		en: "TS SDK Migrations",
		zh: "TS SDK 迁移记录",
	},
];

function buildSidebar(prefix: string, lang: "en" | "zh", title: string) {
	return [
		{
			text: title,
			items: DOC_ITEMS.map((item) => ({
				text: item[lang],
				link: `${prefix}/${item.slug}`,
			})),
		},
	];
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}

function resolveSourcePath(filePath: string): string {
	if (!filePath) return "";
	const sourcePath = isAbsolute(filePath)
		? filePath
		: resolve(DOCSITE_ROOT, filePath);

	try {
		return realpathSync(sourcePath);
	} catch {
		return sourcePath;
	}
}

function resolveRepoRelativePath(
	filePath: string,
	hrefPath: string,
): string | null {
	if (!filePath || !hrefPath || hrefPath.startsWith("/")) return null;

	const sourcePath = resolveSourcePath(filePath);
	if (!sourcePath) return null;

	const targetPath = resolve(dirname(sourcePath), hrefPath);
	const repoRelativePath = relative(REPO_ROOT, targetPath);
	if (!repoRelativePath) return null;
	if (repoRelativePath.startsWith("..") || isAbsolute(repoRelativePath)) {
		return null;
	}

	return normalizePath(repoRelativePath);
}

/**
 * Rewrite repository-relative Markdown / HTML links so the symlinked source
 * documents render correctly inside VitePress without a content-staging step.
 */
function rewriteHref(
	href: string,
	filePath: string,
	lang: "en" | "zh",
): string {
	if (
		!href ||
		/^[a-z][a-z0-9+.-]*:/i.test(href) ||
		href.startsWith("#") ||
		href.startsWith("//")
	) {
		return href;
	}

	const pathEndIdx = href.search(/[?#]/);
	const path = pathEndIdx === -1 ? href : href.slice(0, pathEndIdx);
	const suffix = pathEndIdx === -1 ? "" : href.slice(pathEndIdx);

	if (!path || path.startsWith("/")) return href;

	const normalized = normalizePath(path).replace(/^\.\//, "");
	const repoRelativePath = resolveRepoRelativePath(filePath, path);
	const resolved = repoRelativePath ?? normalized;
	const langPrefix = lang === "en" ? "" : "/zh";
	const map = (target: string) => `${target}${suffix}`;

	if (resolved === "README.md") return map("/");
	if (resolved === "README_zh.md") return map("/zh/");
	if (resolved === "AGENTS.md") return map(`${langPrefix}/agents`);
	if (/^LICENSE(\.md)?$/i.test(resolved)) return map(`${langPrefix}/license`);

	const repoDocs = resolved.match(/^docs\/(en|zh)\/([^/]+)\.md$/i);
	if (repoDocs) {
		const target =
			repoDocs[1] === "en" ? `/docs/${repoDocs[2]}` : `/zh/docs/${repoDocs[2]}`;
		return map(target);
	}

	const sibling = resolved.match(/^(?:\.\.\/)?(en|zh)\/([^/]+)\.md$/i);
	if (sibling) {
		const target =
			sibling[1] === "en" ? `/docs/${sibling[2]}` : `/zh/docs/${sibling[2]}`;
		return map(target);
	}

	const assets = resolved.match(/^(?:\.\.\/)*assets\/icons\/(.+)$/i);
	if (assets) return map(`/${assets[1]}`);

	const localDoc = resolved.match(/^([^/]+)\.md$/i);
	if (localDoc) return map(`${langPrefix}/docs/${localDoc[1]}`);

	if (
		repoRelativePath &&
		!repoRelativePath.startsWith("docs/") &&
		!repoRelativePath.startsWith("assets/")
	) {
		return `${REPO_URL}/blob/main/${repoRelativePath}${suffix}`;
	}

	return href;
}

function detectLang(filePath: string): "en" | "zh" {
	const p = filePath.replace(/\\/g, "/");
	if (/\/zh\//.test(p) || /\/README_zh\.md$/i.test(p)) return "zh";
	return "en";
}

export default defineConfig({
	title: "SecurityDept",
	description:
		"Layered authentication and authorization crates, SDKs, and reference applications.",
	base: "/",
	cleanUrls: true,
	lastUpdated: true,
	vite: {
		resolve: { preserveSymlinks: true },
	},
	ignoreDeadLinks: [/^\.\/(docs|docsite|data|temp)\b/, /mise\.toml$/],
	themeConfig: {
		logo: "/icon.png",
		search: { provider: "local" },
		socialLinks: [{ icon: "github", link: REPO_URL }],
		footer: {
			message: "MIT License.",
			copyright: "Copyright (c) 2026 Exthaxon",
		},
	},
	locales: {
		root: {
			label: "English",
			lang: "en",
			themeConfig: {
				nav: [
					{ text: "Home", link: "/" },
					{ text: "Docs", link: "/docs/000-OVERVIEW", activeMatch: "^/docs/" },
					{ text: "Agents", link: "/agents" },
					{ text: "License", link: "/license" },
				],
				sidebar: { "/docs/": buildSidebar("/docs", "en", "English Docs") },
			},
		},
		zh: {
			label: "中文",
			lang: "zh-CN",
			link: "/zh/",
			themeConfig: {
				nav: [
					{ text: "首页", link: "/zh/" },
					{
						text: "文档",
						link: "/zh/docs/000-OVERVIEW",
						activeMatch: "^/zh/docs/",
					},
					{ text: "Agents", link: "/zh/agents" },
					{ text: "许可证", link: "/zh/license" },
				],
				sidebar: { "/zh/docs/": buildSidebar("/zh/docs", "zh", "中文文档") },
				outlineTitle: "本页内容",
				darkModeSwitchLabel: "外观",
				returnToTopLabel: "返回顶部",
				sidebarMenuLabel: "菜单",
				docFooter: { prev: "上一页", next: "下一页" },
				lastUpdatedText: "最后更新于",
			},
		},
	},
	markdown: {
		config(md) {
			const renderToken: MarkdownRenderRule = (tokens, idx, opts, _env, self) =>
				self.renderToken(tokens, idx, opts);

			const defaultLinkOpen = md.renderer.rules.link_open ?? renderToken;
			md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
				const token = tokens[idx];
				const hrefIdx = token.attrIndex("href");
				if (hrefIdx >= 0 && token.attrs) {
					const filePath = env.realPath ?? env.path ?? "";
					token.attrs[hrefIdx][1] = rewriteHref(
						token.attrs[hrefIdx][1],
						filePath,
						detectLang(filePath),
					);
				}
				return defaultLinkOpen(tokens, idx, opts, env, self);
			};

			const rewriteHtmlAttrs = (
				html: string,
				filePath: string,
				lang: "en" | "zh",
			) =>
				html
					.replace(
						/\b(href|src)="([^"]+)"/g,
						(_m, attr, value) =>
							`${attr}="${rewriteHref(value, filePath, lang)}"`,
					)
					.replace(
						/\b(href|src)='([^']+)'/g,
						(_m, attr, value) =>
							`${attr}='${rewriteHref(value, filePath, lang)}'`,
					);

			for (const ruleName of ["html_block", "html_inline"] as const) {
				const original = md.renderer.rules[ruleName] ?? renderToken;
				md.renderer.rules[ruleName] = (tokens, idx, opts, env, self) => {
					const filePath = env.realPath ?? env.path ?? "";
					const lang = detectLang(filePath);
					tokens[idx].content = rewriteHtmlAttrs(
						tokens[idx].content,
						filePath,
						lang,
					);
					return original(tokens, idx, opts, env, self);
				};
			}
		},
	},
});
