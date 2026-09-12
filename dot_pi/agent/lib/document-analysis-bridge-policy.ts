export const DOCUMENT_ANALYSIS_LOADER_TOOL_NAME = "document_analysis_load" as const;
export const DOCUMENT_ANALYSIS_ACTIVATION_GROUP = "document-analysis.operations" as const;

export const DOCUMENT_ANALYSIS_OPERATION_TOOL_NAMES = [
  "document_analysis_list",
  "document_analysis_status",
  "document_analysis_attach",
  "document_analysis_show",
  "document_analysis_ingest",
  "document_analysis_enrich",
  "document_analysis_archive",
  "document_analysis_delete",
] as const;

export const DOCUMENT_ANALYSIS_TOOL_NAMES = [
  DOCUMENT_ANALYSIS_LOADER_TOOL_NAME,
  ...DOCUMENT_ANALYSIS_OPERATION_TOOL_NAMES,
] as const;

export function isDocumentAnalysisBridgeTool(value: unknown): boolean {
  return typeof value === "string" && DOCUMENT_ANALYSIS_TOOL_NAMES.includes(value as typeof DOCUMENT_ANALYSIS_TOOL_NAMES[number]);
}
