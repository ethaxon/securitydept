import type { PopupTrait } from "../../environment/types";
import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";
import {
	openPopupWindow,
	relayPopupCallback,
	waitForPopupRelay,
} from "../popup/popup";

export interface CreatePopupForNativeWebOptions {
	window?: unknown;
	location?: unknown;
	validators?: Pick<EnvironmentValidators, "popup">;
}

export function createPopupForNativeWeb(
	options: CreatePopupForNativeWebOptions = {},
): PopupTrait {
	const popupHost = options.window ?? globalThis;
	validateEnvTraitInput({
		traitName: "popup",
		hostAdapter: "createPopupForNativeWeb",
		value: {
			window: popupHost,
			location:
				options.location ?? (globalThis as { location?: unknown }).location,
		},
		validator: options.validators?.popup,
		bundleValidate: (value) => {
			const input = value as { window?: unknown };
			return typeof (input.window as { open?: unknown })?.open === "function";
		},
	});
	const popup: PopupTrait = {
		open: openPopupWindow,
		waitForRelay: waitForPopupRelay,
		relayCallback: relayPopupCallback,
	};
	return popup;
}
