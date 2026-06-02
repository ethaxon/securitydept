import { ClientError, ClientErrorKind } from "../errors";
import {
	PopupAttachFailureReason,
	type PopupAttachResult,
	type PopupOpenOptions,
	type PopupTrait,
} from "../popup";

export interface PopupForTestOpenCall {
	url: string;
	options?: PopupOpenOptions;
}

export interface PopupForTestCreateOptions {
	attachResult?: PopupAttachResult;
}

export interface TestPopupTrait extends PopupTrait {
	readonly openCalls: readonly PopupForTestOpenCall[];
	setAttachResult(result: PopupAttachResult): void;
}

export function createPopupForTest(
	options: PopupForTestCreateOptions = {},
): TestPopupTrait {
	const openCalls: PopupForTestOpenCall[] = [];
	let attachResult = options.attachResult ?? createMissingOpenerAttachFailure();
	return {
		open(url, openOptions) {
			openCalls.push({ url, options: openOptions });
			throw new Error("Test popup open was not configured.");
		},
		attach() {
			return attachResult;
		},
		get openCalls() {
			return openCalls;
		},
		setAttachResult(result) {
			attachResult = result;
		},
	};
}

function createMissingOpenerAttachFailure(): PopupAttachResult {
	return {
		kind: "failure",
		reason: PopupAttachFailureReason.MissingOpener,
		error: new ClientError({
			kind: ClientErrorKind.Configuration,
			code: "test.popup.missing_opener",
			source: "test",
			message: "Test popup attach was not configured.",
		}),
	};
}
