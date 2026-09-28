/**
 * Universal clipboard copy helper that works across:
 * 1. Secure contexts (HTTPS, localhost) via navigator.clipboard
 * 2. Insecure contexts (HTTP IP addresses e.g. http://100.113.232.109:3001) via document.execCommand fallback
 * 3. Electron desktop apps via Electron clipboard / web fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard (available in HTTPS or localhost)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[Clipboard] navigator.clipboard.writeText failed, attempting execCommand fallback:', err);
    }
  }

  // 2. Fallback to document.execCommand('copy') with temporary textarea
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      // Prevent scrolling to bottom or zooming on mobile
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');

      document.body.appendChild(textArea);
      textArea.focus({ preventScroll: true });
      textArea.select();
      textArea.setSelectionRange(0, text.length);

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        return true;
      }
    } catch (err) {
      console.error('[Clipboard] document.execCommand fallback failed:', err);
    }
  }

  // 3. Fallback for Electron renderer if electronAPI is exposed
  try {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.clipboard?.writeText) {
      (window as any).electronAPI.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  return false;
}
