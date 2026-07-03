import { type ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useThemePreference } from "@/theme/react";

export function Toaster(props: ComponentProps<typeof Sonner>) {
	const { preference } = useThemePreference();

	return (
		<Sonner
			closeButton
			position="top-right"
			richColors
			theme={preference}
			{...props}
		/>
	);
}
