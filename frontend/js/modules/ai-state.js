// ai-state.js - Mutable state shared between llm-service.js (chat driver)
// and safety.js (panic abort). Kept separate to avoid circular imports.

export const AIChatState = {
  /** @type {AbortController | null} */
  currentController: null,
  /** @type {boolean} */
  isProcessing: false,
  /** @type {HTMLElement | null} */
  streamingBubbleEl: null,
};
