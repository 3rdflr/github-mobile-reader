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
} from './parser';

export type {
  FlowNode,
  ParseResult,
  ReaderMarkdownMeta,
  ClassNameChange,
} from './parser';
