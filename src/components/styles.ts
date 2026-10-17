// Class lists shared by the buttons, fields and dialogs of several components.

// Unavailable buttons are marked with aria-disabled, not disabled, and their
// click handlers ignore clicks: a disabled button drops keyboard focus to the
// page, and some disable themselves on use (Clear always, Copy and Save
// while saving, Create while the project is being created).
const button =
  "rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
// sky-700, red-700 and darker keep white text above 4.5:1 at rest and on
// hover (about 5.9 and 6.4 to 1); sky-600 would fall below it. The dark
// theme keeps the same fills, stated so that they are a choice for it too.
export const primaryButton = `${button} bg-sky-700 text-white not-aria-disabled:hover:bg-sky-800 dark:bg-sky-700 dark:text-white dark:not-aria-disabled:hover:bg-sky-800`;
export const secondaryButton = `${button} border border-slate-400 bg-white text-slate-900 not-aria-disabled:hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:not-aria-disabled:hover:bg-slate-700`;
export const dangerButton = `${button} bg-red-700 text-white not-aria-disabled:hover:bg-red-800 dark:bg-red-700 dark:text-white dark:not-aria-disabled:hover:bg-red-800`;

export const fieldLabel =
  "block text-sm font-medium text-slate-700 dark:text-slate-300";
export const fieldHelp = "text-xs text-slate-600 dark:text-slate-400";
export const textInput =
  "block w-full rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100";

// Dialogs sit below the toasts (z-50), so a failure toasted while a dialog
// is open is not dimmed by its overlay. Dialogs are portalled outside the
// app's root, so the panel sets its own colours.
export const dialogOverlay =
  "fixed inset-0 z-40 bg-slate-950/40 dark:bg-black/60";
export const dialogPanel =
  "fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 text-slate-900 shadow-xl focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
export const dialogTitle = "text-base font-semibold";
export const dialogDescription = "text-sm text-slate-600 dark:text-slate-400";
export const dialogButtons = "flex flex-wrap justify-end gap-2";

export const selectLabel =
  "text-sm font-medium text-slate-700 dark:text-slate-300";
export const selectTrigger =
  "inline-flex min-w-40 items-center justify-between gap-2 rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700";
// In popper mode Radix leaves the size to us; without the caps a long list
// of projects or frameworks, or a long name, would run off the window.
export const selectContent =
  "z-50 max-h-(--radix-select-content-available-height) max-w-[min(20rem,var(--radix-select-content-available-width))] min-w-(--radix-select-trigger-width) rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800";
export const selectItem =
  "relative flex cursor-default items-center rounded py-1.5 pr-2 pl-7 text-sm wrap-break-word text-slate-900 outline-none select-none data-highlighted:bg-sky-100 data-highlighted:text-sky-900 dark:text-slate-100 dark:data-highlighted:bg-sky-900 dark:data-highlighted:text-sky-100";
export const selectSeparator = "my-1 h-px bg-slate-200 dark:bg-slate-700";
