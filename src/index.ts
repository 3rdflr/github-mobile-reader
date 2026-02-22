/**
 * github-mobile-reader
 * Public API surface for the npm library.
 */

export {
  parseDiffToLogicalFlow,
  generateReaderMarkdown,
  filterDiffLines,
  normalizeCode,
  renderFlowTree,
  parseToFlowTree,
  Priority,
  // JSX/Tailwind
  isJSXFile,
  hasJSXContent,
  isClassNameOnlyLine,
  extractClassName,
  parseClassNameChanges,
  renderStyleChanges,
  isJSXElement,
  extractJSXComponentName,
  parseJSXToFlowTree,
  extractChangedSymbols,
  renderJSXTreeCompact,
  // New symbol-diff API
  parseDiffHunks,
  attributeLinesToSymbols,
  extractPropsChanges,
  generateSymbolSections,
} from './parser';

export type {
  FlowNode,
  ParseResult,
  ReaderMarkdownMeta,
  ClassNameChange,
  // New types
  SymbolDiff,
  PropsChange,
} from './parser';
