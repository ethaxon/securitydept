import {
	ErrorPresentationTone,
	readErrorPresentationDescriptor,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { toast } from "sonner";

export const MESSAGE_SERVICE = new SecuritydeptInjectionToken<MessageService>(
	"MESSAGE_SERVICE",
);

export class MessageService {
	showError(error: unknown): void {
		const presentation = readErrorPresentationDescriptor(error);
		const options = { description: presentation.description };

		switch (presentation.tone) {
			case ErrorPresentationTone.Neutral:
				toast.info(presentation.title, options);
				break;
			case ErrorPresentationTone.Warning:
				toast.warning(presentation.title, options);
				break;
			case ErrorPresentationTone.Danger:
				toast.error(presentation.title, options);
				break;
		}
	}
}

export function provideMessageService(): readonly SecuritydeptProvider[] {
	return [
		{
			provide: MESSAGE_SERVICE,
			useFactory: () => new MessageService(),
		},
	];
}
