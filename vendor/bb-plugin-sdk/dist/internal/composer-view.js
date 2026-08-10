// src/internal/composer-view.ts
function isComposerDraftEmpty(text, attachmentCount) {
  return text.trim().length === 0 && attachmentCount === 0;
}
export {
  isComposerDraftEmpty
};
