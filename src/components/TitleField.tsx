import { useId } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import { currentTitle } from "../state/reducer";
import { fieldHelp, fieldLabel, textInput } from "./styles";

/** The title input's id, for moving focus to it from outside the Builder. */
export const TITLE_INPUT_ID = "builder-title";

/**
 * The selected framework's optional title: a one-line name for the prompt
 * in History, kept with the draft and never rendered into the prompt.
 */
export function TitleField() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const helpId = useId();

  return (
    <div>
      <label htmlFor={TITLE_INPUT_ID} className={fieldLabel}>
        Title
      </label>
      <p id={helpId} className={`mt-0.5 ${fieldHelp}`}>
        Optional. Names the prompt in History; it isn&apos;t part of the prompt.
      </p>
      <input
        id={TITLE_INPUT_ID}
        type="text"
        aria-describedby={helpId}
        value={currentTitle(state)}
        onChange={(event) =>
          dispatch({ type: "editTitle", value: event.target.value })
        }
        className={`mt-1.5 ${textInput}`}
      />
    </div>
  );
}
