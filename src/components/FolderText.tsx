import { FOLDER_MAX_CHARS, shortenPath } from "../paths";

/**
 * A folder path, or "No folder". A path too long to show is shortened for
 * the eye; screen readers get the whole of it, and mouse users a tooltip.
 */
export function FolderText({
  folder,
  className,
}: {
  folder: string | null;
  className: string;
}) {
  const colors = "text-slate-600 dark:text-slate-400";
  if (folder === null)
    return <span className={`${className} ${colors}`}>No folder</span>;
  const shown = shortenPath(folder, FOLDER_MAX_CHARS);
  if (shown === folder) {
    return <span className={`${className} break-all ${colors}`}>{folder}</span>;
  }
  return (
    <span className={`${className} break-all ${colors}`} title={folder}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{folder}</span>
    </span>
  );
}
