export type Severity = "none" | "low" | "medium" | "high";
export type AnalysisType = "none" | "term_replacement" | "sentence_rewrite";

export type EditSpan = {
  start: number;
  end: number;
  replacement: string;
};

export type UIStrings = {
  message: string;
  change_label: string;
  keep_label: string;
};

export type AnalysisResponse = {
  severity: Severity;
  type: AnalysisType;
  reason?: string | null;
  edits: EditSpan[];
  suggested_text?: string | null;
  ui?: UIStrings | null;
};
