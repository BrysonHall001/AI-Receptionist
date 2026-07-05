// Server-side mirror of the rule engine in public/js/table.js so automation
// conditions use the EXACT same shape and semantics as the contact/report
// filters users already build. Rule shape:
//   { field, op, value, value2?, unit?, conj? }   (conj "OR" starts a new group)
// AND binds tighter than OR -> (A AND B) OR (C AND D).

export interface Rule {
  field: string;
  op: string;
  value?: any;
  value2?: any;
  unit?: string;
  conj?: "AND" | "OR";
}

export interface Column {
  key: string;
  type: string;
  get: (row: any) => any;
  text?: (row: any) => any;
}

function colText(col: Column, row: any): string {
  const v = col.text ? col.text(row) : col.get(row);
  if (v == null || v === "—") return "";
  return String(v);
}
function colSort(col: Column, row: any): any {
  return col.get ? col.get(row) : col.text ? col.text(row) : "";
}
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function subtractTime(fromMs: number, amount: any, unit: string): number {
  const d = new Date(fromMs);
  const n = Number(amount) || 0;
  if (unit === "weeks") d.setDate(d.getDate() - n * 7);
  else if (unit === "months") d.setMonth(d.getMonth() - n);
  else if (unit === "years") d.setFullYear(d.getFullYear() - n);
  else d.setDate(d.getDate() - n);
  return d.getTime();
}

function evalRule(row: any, rule: Rule, cols: Column[]): boolean {
  const col = cols.find((c) => c.key === rule.field);
  if (!col) return true;
  // Audience membership: the column value is the array of audience ids the contact is in (attached
  // at eval time). "in_audience" / "not_in_audience" test whether the rule's audience id is present.
  if (rule.op === "in_audience" || rule.op === "not_in_audience") {
    const ids = col.get ? col.get(row) : [];
    const inIt = Array.isArray(ids) && ids.includes(rule.value);
    return rule.op === "in_audience" ? inIt : !inIt;
  }
  const text = colText(col, row).toLowerCase();
  const raw = colSort(col, row);
  const val = (rule.value == null ? "" : String(rule.value)).toLowerCase();
  const t = raw ? new Date(raw).getTime() : NaN;
  switch (rule.op) {
    case "contains": return text.includes(val);
    case "not_contains": return !text.includes(val);
    case "is": return text === val;
    case "is_not": return text !== val;
    case "empty": return text === "";
    case "not_empty": return text !== "";
    case "before": return !!raw && t < new Date(rule.value).getTime();
    case "after": return !!raw && t > new Date(rule.value).getTime();
    case "gt": return Number(raw) > Number(rule.value);
    case "lt": return Number(raw) < Number(rule.value);
    case "today": {
      if (!raw) return false;
      const s = startOfToday();
      return t >= s && t < s + 86400000;
    }
    case "between": {
      if (!raw) return false;
      const a = new Date(rule.value).getTime();
      const end = new Date(rule.value2);
      end.setHours(23, 59, 59, 999);
      return t >= a && t <= end.getTime();
    }
    case "previous": {
      if (!raw) return false;
      const now = Date.now();
      return t >= subtractTime(now, rule.value, rule.unit || "days") && t <= now;
    }
    default: return true;
  }
}

export function ruleComplete(rule: Rule): boolean {
  if (!rule || !rule.field || !rule.op) return false;
  if (rule.op === "empty" || rule.op === "not_empty" || rule.op === "today") return true;
  if (rule.op === "in_audience" || rule.op === "not_in_audience") return rule.value != null && rule.value !== "";
  if (rule.op === "between") return rule.value != null && rule.value !== "" && rule.value2 != null && rule.value2 !== "";
  if (rule.op === "previous") return rule.value != null && rule.value !== "" && !!rule.unit;
  return rule.value != null && rule.value !== "";
}

/** Evaluate a rule array against a row. Empty/incomplete rules => always true. */
export function evalRules(row: any, rules: Rule[], cols: Column[]): boolean {
  const active = (rules || []).filter(ruleComplete);
  if (!active.length) return true;
  const groups: Rule[][] = [];
  let cur: Rule[] = [];
  active.forEach((r, idx) => {
    if (idx > 0 && r.conj === "OR") {
      groups.push(cur);
      cur = [];
    }
    cur.push(r);
  });
  if (cur.length) groups.push(cur);
  return groups.some((g) => g.every((r) => evalRule(row, r, cols)));
}
