// ai-state.js - Mutable state shared by Webcam-Vision (abort controller).

export const AIChatState = {
  /** @type {AbortController | null} */
  currentController: null,
  /** @type {boolean} */
  isProcessing: false,
  /** @type {HTMLElement | null} */
  streamingBubbleEl: null,
};
