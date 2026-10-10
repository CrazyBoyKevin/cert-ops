/** Copy without requiring HTTPS; preserve PEM whitespace and the user's focus. */
export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Permissions or browser policy may deny the modern API even on HTTPS.
    }
  }

  if (typeof document === "undefined") throw new Error("Clipboard unavailable");
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const inputSelection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection }
    : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  // Keep it rendered/selectable: display:none and visibility:hidden cannot copy.
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;";
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    // Deprecated, but still needed for HTTP deployments where Clipboard API is absent.
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (inputSelection?.start != null && inputSelection.end != null &&
        (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
      focused.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    }
  }
}
