import { type as defineType } from "arktype";
import { type ClientError } from "../errors";
import { SecuritydeptInjectionToken } from "../injection";
import {
	type PopupClientWindowHandleTrait,
	type PopupServerWindowHandleTrait,
} from "./handle";

export { PopupErrorCode } from "./errors";

export type {
	PopupClientWindowHandleTrait,
	PopupMessageChannelTrait,
	PopupServerWindowHandleTrait,
	PopupWindowHandleTrait,
} from "./handle";
export { PopupClientWindowHandle, PopupServerWindowHandle } from "./handle";
export type {
	CreatePopupClientSessionOptions,
	CreatePopupServerSessionOptions,
} from "./session";

export const PopupAttachFailureReason = {
	MissingOpener: "missing_opener",
	MissingOrigin: "missing_origin",
} as const;

export type PopupAttachFailureReason =
	(typeof PopupAttachFailureReason)[keyof typeof PopupAttachFailureReason];

export interface PopupAttachSuccess {
	kind: "success";
	handle: PopupServerWindowHandleTrait;
}

export interface PopupAttachFailure {
	kind: "failure";
	reason: PopupAttachFailureReason;
	error: ClientError;
}

export type PopupAttachResult = PopupAttachSuccess | PopupAttachFailure;

export interface PopupOpenOptions {
	target?: string;
	width?: number;
	height?: number;
	expectedOrigin?: string;
}

export interface PopupTrait {
	open(url: string, options?: PopupOpenOptions): PopupClientWindowHandleTrait;
	attach(): PopupAttachResult;
}

export const PopupTraitSchema = defineType({
	open: "Function",
	attach: "Function",
});

export const POPUP_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<PopupTrait | null>("POPUP_TRAIT_TOKEN");
