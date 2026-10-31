/**
 * Browser gestures that CSS cannot disable on Chrome/Android: context menus, pinch zoom,
 * double-tap zoom and multi-finger touches. A single-finger tap is never blocked.
 */
export function installKidProofing(): void {
  const prevent = (event: Event): void => {
    event.preventDefault()
  }

  document.addEventListener('contextmenu', prevent)
  document.addEventListener('selectstart', prevent)
  document.addEventListener('dragstart', prevent)
  document.addEventListener('gesturestart', prevent)
  document.addEventListener('gesturechange', prevent)
  document.addEventListener('gestureend', prevent)
  document.addEventListener('dblclick', prevent, { passive: false })

  const blockMultiTouch = (event: TouchEvent): void => {
    if (event.touches.length > 1) event.preventDefault()
  }
  document.addEventListener('touchstart', blockMultiTouch, { passive: false })
  document.addEventListener('touchmove', blockMultiTouch, { passive: false })
}
