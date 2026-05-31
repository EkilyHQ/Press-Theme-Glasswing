// Compatibility facade for DOM-free block editor model helpers.

export {
  appendInlineRun,
  applyInlineLinkToRuns,
  applyInlineMathToRuns,
  inlineMarksAtOffset,
  inlineRangeAnyMarked,
  inlineRangeFullyMarked,
  inlineRangeText,
  inlineRenderedTextLength,
  inlineRun,
  inlineRunsTextLength,
  insertInlineRunsAtRange,
  linkTitleForRun,
  mergeInlineRuns,
  normalizeEditableMarkdownText,
  parseInlineRuns,
  rangeHasInlineText,
  removeInlineMarkAroundOffset,
  removeInlineMarkInRange,
  sanitizeEditorLinkHref,
  sanitizeEditorLinkTitle,
  serializeInlineRuns,
  toggleInlineMarkOnRuns
} from './editor-blocks-inline-model.js?v=press-system-v3.4.116';

export {
  convertListTailItemAfterEmptyToParagraph,
  dedentIndentedListSource,
  defaultListItems,
  editableListItems,
  effectiveListItemType,
  indentationColumn,
  isListItemLine,
  isMergeableListBlock,
  itemIndentLevel,
  listBlockItems,
  listItemHasNestedChildren,
  listItemText,
  listVisualMarkerLabels,
  mergeListItemIntoPreviousItem,
  normalizeListItemType,
  normalizeSplitListStartItems,
  normalizeStandardListType,
  outdentEmptyListItemForEnter,
  parseListBlock,
  parseListLineInfo,
  patchListItem,
  patchListItemType,
  patchStandardListItemType,
  serializeList,
  splitListItemsAtEmptyItem,
  summarizeListType
} from './editor-blocks-list-model.js?v=press-system-v3.4.116';

export {
  editableTableData,
  normalizeTableAlignment,
  normalizeTableCellValue,
  parseTableBlock,
  serializeTable,
  tableColumnCount
} from './editor-blocks-table-model.js?v=press-system-v3.4.116';

export {
  isBlockEmptyForBackspace,
  isMergeableTextBlock,
  joinMergedEditableText,
  mergeFirstListItemIntoPreviousBlock,
  mergeTextBlockIntoPrevious,
  mergeTextBlockIntoPreviousList,
  splitTextBlockIntoParagraph
} from './editor-blocks-block-flow-model.js?v=press-system-v3.4.116';

export {
  BLOCK_TYPES,
  escapeHtml,
  makeBlankBlock,
  makeBlock,
  normalizeText,
  splitBlankLineUnits
} from './editor-blocks-block-core-model.js?v=press-system-v3.4.116';

export {
  autofixMarkdownSourceBlock,
  parseMarkdownBlocks
} from './editor-blocks-markdown-parse-model.js?v=press-system-v3.4.116';

export {
  serializeMarkdownBlocks
} from './editor-blocks-markdown-serialize-model.js?v=press-system-v3.4.116';
