import { EditSpan } from "@/types/analysis";

export function applyEdits(original: string, edits: EditSpan[]): string {
  // Start indexler original string’e göre geldiği için
  // sağdan sola uyguluyoruz ki index kaymasın
  const sorted = [...edits].sort((a, b) => b.start - a.start);

  let text = original;
  for (const e of sorted) {
    text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  }
  return text;
}
