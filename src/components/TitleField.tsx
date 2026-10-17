import { useId } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import { currentTitle } from "../state/reducer";
import { fieldHelp, fieldLabel, textInput } from "./styles";

/**
 * The selected framework's optional title: a one-line name for the prompt
 * in History, kept with the draft and never rendered into the prompt.
 */
export function TitleField() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const inputId = useId();
  const helpId = useId();

  return (
    <div>
      <label htmlFor={inputId} className={fieldLabel}>
        Title
      </label>
      <p id={helpId} className={`mt-0.5 ${fieldHelp}`}>
        Optional. Names the prompt in History; it isn&apos;t part of the prompt.
      </p>
      <input
        id={inputId}
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
