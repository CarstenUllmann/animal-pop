/**
 * Kid-proofing for the browser shell (SPEC §15, "Kid-proofing").
 *
 * The CSS already disables zoom, scrolling, selection and tap highlights. These
 * listeners cover the browser gestures that ignore CSS on Chrome/Android: long-press
 * context menus, pinch-zoom gestures and double-tap zoom.
 *
 * Nothing here blocks a single-finger tap, so game input stays untouched.
 */
export function installKidProofing(): void {
  const prevent = (event: Event): void => {
    event.preventDefault()
  }

  document.addEventListener('contextmenu', prevent)
  document.addEventListener('selectstart', prevent)
  document.addEventListener('dragstart', prevent)

  // WebKit/Chromium gesture events; harmless on browsers that never emit them.
  document.addEventListener('gesturestart', prevent)
  document.addEventListener('gesturechange', prevent)
  document.addEventListener('gestureend', prevent)
  document.addEventListener('dblclick', prevent, { passive: false })

  // Belt and braces for multi-finger gestures when `touch-action: none` is ignored.
  const blockMultiTouch = (event: TouchEvent): void => {
    if (event.touches.length > 1) event.preventDefault()
  }
  document.addEventListener('touchstart', blockMultiTouch, { passive: false })
  document.addEventListener('touchmove', blockMultiTouch, { passive: false })
}
