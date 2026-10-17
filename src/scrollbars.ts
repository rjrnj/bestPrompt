// Some webviews draw scrollbars over the content instead of beside it:
// WebKitGTK on Linux does by default, WebView2 on Windows does not. Panes
// with little padding need more room for an overlay scrollbar, so the page
// is marked once at startup and styles opt in with the
// `overlay-scrollbars:` variant (see index.css).

/**
 * Sets `data-overlay-scrollbars` on the root element when a scrollbar takes
 * no width, measured on a hidden probe that is removed again.
 */
export function markOverlayScrollbars(): void {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll";
  document.body.append(probe);
  const overlay = probe.offsetWidth === probe.clientWidth;
  probe.remove();
  if (overlay) {
    document.documentElement.dataset.overlayScrollbars = "";
  }
}
