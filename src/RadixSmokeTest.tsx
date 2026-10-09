// Smoke test proving raw Radix primitives work with Tailwind styling.
// Throwaway: delete once real dialogs exist (Phase 2).
import * as Dialog from "@radix-ui/react-dialog";

export function RadixSmokeTest() {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="rounded-md bg-sky-500 px-4 py-2 font-medium text-white hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
        Open dialog
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-slate-800 p-6 text-slate-100 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">
            Radix works
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-slate-300">
            This dialog comes from a raw Radix primitive, styled with Tailwind.
          </Dialog.Description>
          <Dialog.Close className="mt-4 rounded-md bg-slate-600 px-3 py-1.5 text-sm hover:bg-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
            Close
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
