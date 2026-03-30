/**
 * Captures the scrollTop of every scrollable ancestor, then restores those
 * values in the next animation frame. Use as an onFocus handler to stop the
 * browser from auto-scrolling the page when an input gains focus on mobile.
 *
 * Usage:
 *   import { preventScrollOnFocus } from '../utils/preventScrollOnFocus';
 *   <input onFocus={preventScrollOnFocus} ... />
 */
export function preventScrollOnFocus(e) {
  const scrollables = [];
  let node = e.currentTarget.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      scrollables.push({ node, top: node.scrollTop });
    }
    node = node.parentElement;
  }
  if (scrollables.length === 0) return;
  requestAnimationFrame(() => {
    for (const { node, top } of scrollables) {
      node.scrollTop = top;
    }
  });
}
