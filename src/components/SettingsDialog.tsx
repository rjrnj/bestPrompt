import * as Dialog from "@radix-ui/react-dialog";
import type { ThemeChoice } from "../bindings/ThemeChoice";
import { useAppActions, useAppState } from "../state/AppState";
import { Gear } from "./icons";
import {
  dialogButtons,
  dialogOverlay,
  dialogPanel,
  dialogTitle,
  iconButton,
  radioInput,
  radioLabel,
  radioLegend,
  secondaryButton,
} from "./styles";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The header's Settings button and the dialog it opens. Choosing a theme
 * applies and saves it at once; there is nothing to confirm.
 */
export function SettingsDialog() {
  const { settings } = useAppState();
  const { saveSetting } = useAppActions();
  const theme = settings?.theme ?? "system";
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={iconButton}
          aria-label="Settings"
          title="Settings"
        >
          <Gear />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogPanel} aria-describedby={undefined}>
          <Dialog.Title className={dialogTitle}>Settings</Dialog.Title>
          <fieldset className="flex flex-col gap-2">
            <legend className={radioLegend}>Theme</legend>
            {THEMES.map(({ value, label }) => (
              <label key={value} className={radioLabel}>
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => void saveSetting({ theme: value })}
                  className={radioInput}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className={dialogButtons}>
            <Dialog.Close asChild>
              <button type="button" className={secondaryButton}>
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
