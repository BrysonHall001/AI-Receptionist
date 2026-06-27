// Survey question types (v1) and the field-mapping compatibility rules. Field types
// come from the existing custom-field system (fieldService.FIELD_TYPES): text,
// textarea, number, percent, date, checkbox, single_select, multi_select, phone,
// url, email, formula, image.

export const SURVEY_QUESTION_TYPES = [
  "short_text", "long_text", "single_select", "multi_select", "rating", "nps", "yes_no", "date",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

// For each question type, the custom-field types its answer may be mapped onto.
export const MAP_COMPAT: Record<SurveyQuestionType, string[]> = {
  short_text: ["text", "textarea", "phone", "url", "email"],
  long_text: ["textarea", "text"],
  single_select: ["single_select", "text", "textarea"],
  multi_select: ["multi_select", "text"],
  rating: ["number", "percent", "text"],
  nps: ["number", "text"],
  yes_no: ["checkbox", "text"],
  date: ["date"],
};

export function isQuestionType(t: unknown): t is SurveyQuestionType {
  return typeof t === "string" && (SURVEY_QUESTION_TYPES as readonly string[]).includes(t);
}

export function compatibleFieldTypes(qType: string): string[] {
  return MAP_COMPAT[qType as SurveyQuestionType] || [];
}

// A mapping is valid when the field's type is in the question type's compatible set.
export function isMappingCompatible(qType: string, fieldType: string): boolean {
  return compatibleFieldTypes(qType).includes(fieldType);
}
