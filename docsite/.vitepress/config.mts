import { defineConfig } from "vitepress";

const REPO_URL = "https://github.com/ethaxon/securitydept";

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

type MarkdownRendererOptions = Record<string, unknown>;

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

/**
 * Rewrite repository-relative Markdown / HTML links so the symlinked source
 * documents render correctly inside VitePress without a content-staging step.
 */
function rewriteHref(href: string, lang: "en" | "zh"): string {
	if (
		!href ||
		/^[a-z][a-z0-9+.-]*:/i.test(href) ||
		href.startsWith("#") ||
		href.startsWith("//")
	) {
		return href;
	}

	const hashIdx = href.indexOf("#");
	const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
	const hash = hashIdx === -1 ? "" : href.slice(hashIdx);

	if (!path || path.startsWith("/")) return href;

	const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
	const langPrefix = lang === "en" ? "" : "/zh";
	const map = (target: string) => `${target}${hash}`;

	if (normalized === "README.md") return map("/");
	if (normalized === "README_zh.md") return map("/zh/");
	if (normalized === "AGENTS.md") return map(`${langPrefix}/agents`);
	if (/^LICENSE(\.md)?$/i.test(normalized)) return map(`${langPrefix}/license`);

	const repoDocs = normalized.match(/^docs\/(en|zh)\/([^/]+)\.md$/i);
	if (repoDocs) {
		const target =
			repoDocs[1] === "en" ? `/docs/${repoDocs[2]}` : `/zh/docs/${repoDocs[2]}`;
		return map(target);
	}

	const sibling = normalized.match(/^(?:\.\.\/)?(en|zh)\/([^/]+)\.md$/i);
	if (sibling) {
		const target =
			sibling[1] === "en" ? `/docs/${sibling[2]}` : `/zh/docs/${sibling[2]}`;
		return map(target);
	}

	const assets = normalized.match(/^(?:\.\.\/)*assets\/icons\/(.+)$/i);
	if (assets) return map(`/${assets[1]}`);

	const localDoc = normalized.match(/^([^/]+)\.md$/i);
	if (localDoc) return map(`${langPrefix}/docs/${localDoc[1]}`);

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
						detectLang(filePath),
					);
				}
				return defaultLinkOpen(tokens, idx, opts, env, self);
			};

			const rewriteHtmlAttrs = (html: string, lang: "en" | "zh") =>
				html
					.replace(
						/\b(href|src)="([^"]+)"/g,
						(_m, attr, value) => `${attr}="${rewriteHref(value, lang)}"`,
					)
					.replace(
						/\b(href|src)='([^']+)'/g,
						(_m, attr, value) => `${attr}='${rewriteHref(value, lang)}'`,
					);

			for (const ruleName of ["html_block", "html_inline"] as const) {
				const original = md.renderer.rules[ruleName] ?? renderToken;
				md.renderer.rules[ruleName] = (tokens, idx, opts, env, self) => {
					const lang = detectLang(env.realPath ?? env.path ?? "");
					tokens[idx].content = rewriteHtmlAttrs(tokens[idx].content, lang);
					return original(tokens, idx, opts, env, self);
				};
			}
		},
	},
});
