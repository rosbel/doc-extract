import { useCallback } from "react";
import {
	unstable_usePrompt as usePrompt,
	useBeforeUnload,
} from "react-router-dom";

const UNSAVED_MESSAGE = "You have unsaved schema changes. Leave this page?";

export function useUnsavedChangesPrompt(when: boolean) {
	usePrompt({
		when,
		message: UNSAVED_MESSAGE,
	});

	useBeforeUnload(
		useCallback(
			(event) => {
				if (!when) {
					return;
				}

				event.preventDefault();
				event.returnValue = "";
			},
			[when],
		),
		{ capture: true },
	);
}
