// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratedToken } from "@/routes/_authenticated/entries/-generated-token";

describe("generated token copying", () => {
	let container: HTMLDivElement;
	let root: Root;
	const onDismiss = vi.fn();
	const originalClipboard = Object.getOwnPropertyDescriptor(
		navigator,
		"clipboard",
	);

	beforeEach(async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		onDismiss.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(<GeneratedToken token="test-token" onDismiss={onDismiss} />);
		});
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		if (originalClipboard) {
			Object.defineProperty(navigator, "clipboard", originalClipboard);
		} else {
			Reflect.deleteProperty(navigator, "clipboard");
		}
		vi.unstubAllGlobals();
	});

	function setClipboard(clipboard: unknown) {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: clipboard,
		});
	}

	async function copy() {
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Copy token"]')
				?.click();
		});
	}

	it("reports successful copying without displaying the token in feedback", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });
		await copy();
		expect(writeText).toHaveBeenCalledWith("test-token");
		expect(container.querySelector('[role="status"]')?.textContent).toBe(
			"Token copied.",
		);
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it.each([
		undefined,
		{},
		{ writeText: true },
	])("provides manual copying when the clipboard API is unavailable: %s", async (clipboard) => {
		setClipboard(clipboard);
		await copy();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Ctrl+C / Cmd+C",
		);
		const input = container.querySelector("input");
		expect(input?.readOnly).toBe(true);
		expect(document.activeElement).toBe(input);
		expect(input?.selectionStart).toBe(0);
		expect(input?.selectionEnd).toBe("test-token".length);
	});

	it("handles rejected writes, supports reselecting, and allows retry", async () => {
		const writeText = vi
			.fn()
			.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
			.mockResolvedValueOnce(undefined);
		setClipboard({ writeText });
		await copy();
		const input = container.querySelector("input");
		input?.setSelectionRange(0, 0);
		await act(async () => {
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Select token for manual copy")
				?.click();
		});
		expect(input?.selectionEnd).toBe("test-token".length);
		await copy();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.querySelector('[role="status"]')?.textContent).toBe(
			"Token copied.",
		);
	});

	it("handles synchronous clipboard failures without losing the token", async () => {
		setClipboard({
			writeText: () => {
				throw new Error("clipboard unavailable");
			},
		});
		await copy();
		expect(container.querySelector('[role="alert"]')).not.toBeNull();
		expect(container.querySelector("input")?.value).toBe("test-token");
	});

	it("keeps dismissal available after copying fails", async () => {
		setClipboard(undefined);
		await copy();
		await act(async () => {
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Dismiss")
				?.click();
		});
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
