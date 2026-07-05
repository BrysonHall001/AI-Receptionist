// Drip compiler (slice 2): validate a LINEAR drip graph and compile it into an Automation payload
// (triggerType + conditions + ordered actions) identical in shape to one authored in the normal
// automations builder. Pure + DB-free so it's unit-testable. Branching is out of scope — a node
// may have at most one outgoing edge.
import { ruleComplete, type Rule } from "../automation/conditions";

export interface DripNode { id: string; type: string; x: number; y: number; config: Record<string, any> }
export interface DripEdge { source: string; target: string }
export interface DripGraph { nodes: DripNode[]; edges: DripEdge[] }

export interface DripError { nodeId?: string; message: string }
export interface CompiledAutomation { triggerType: string; conditions: any[]; actions: Array<{ id?: string; type: string; config: Record<string, any> }> }
export interface CompileResult { ok: boolean; errors: DripError[]; automation?: CompiledAutomation; triggerNodeId?: string }

export const TRIGGER_TYPES = ["enroll_audience", "enroll_condition"];
// Drip node types that map to a real engine action (D0 + base). "enroll" as a mid-flow step has no
// engine action — it's only valid as the starting trigger (enroll_audience).
const ACTION_MAP: Record<string, string> = {
  wait: "wait",
  send_email: "send_email",
  send_survey: "send_survey",
  unenroll: "unenroll",
};

export function normalizeGraph(graph: any): DripGraph {
  const nodes: DripNode[] = (graph && Array.isArray(graph.nodes) ? graph.nodes : []).map((n: any) => ({
    id: String(n?.id ?? ""), type: String(n?.type ?? ""),
    x: Number(n?.x) || 0, y: Number(n?.y) || 0,
    config: (n && typeof n.config === "object" && n.config) ? n.config : {},
  })).filter((n: DripNode) => n.id && n.type);
  const seen = new Set<string>();
  const edges: DripEdge[] = (graph && Array.isArray(graph.edges) ? graph.edges : [])
    .map((e: any) => ({ source: String(e?.source ?? ""), target: String(e?.target ?? "") }))
    .filter((e: DripEdge) => {
      if (!e.source || !e.target || e.source === e.target) return false;
      const k = e.source + ">" + e.target;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  return { nodes, edges };
}

// Per-node config completeness. Returns an error message or null.
function configError(node: DripNode): string | null {
  const c = node.config || {};
  switch (node.type) {
    case "enroll_audience":
      return (Array.isArray(c.audienceIds) && c.audienceIds.length) ? null : "Pick an audience to enroll.";
    case "enroll_condition":
      return (Array.isArray(c.rules) && c.rules.some((r: Rule) => ruleComplete(r))) ? null : "Add at least one condition.";
    case "wait":
      return (Number(c.amount) > 0 && c.unit) ? null : "Set a wait duration.";
    case "send_email":
      if (c.mode === "template") return c.templateId ? null : "Pick an email template.";
      return (String(c.subject || "").trim() && String(c.html || "").trim()) ? null : "Add a subject and message.";
    case "send_survey":
      if (!c.surveyId) return "Pick a survey.";
      return String(c.subject || "").trim() ? null : "Add an invite subject.";
    case "unenroll":
      return null; // a terminal exit step — no config required
    case "enroll":
      return "“Enroll” can only be used as the starting step (as an audience enrollment).";
    default:
      return `Unknown step type “${node.type}”.`;
  }
}

// Map a validated node to its automation action.
function toAction(node: DripNode): { id?: string; type: string; config: Record<string, any> } {
  const c = node.config || {};
  const type = ACTION_MAP[node.type];
  if (node.type === "wait") return { id: node.id, type, config: { amount: Number(c.amount) || 0, unit: c.unit || "days" } };
  if (node.type === "send_email") {
    return c.mode === "template"
      ? { id: node.id, type, config: { templateId: c.templateId } }
      : { id: node.id, type, config: { subject: c.subject || "", html: c.html || "" } };
  }
  if (node.type === "send_survey") return { id: node.id, type, config: { surveyId: c.surveyId, subject: c.subject || "", html: c.html || "" } };
  if (node.type === "unenroll") return { id: node.id, type, config: {} }; // exits THIS flow (default scope)
  return { id: node.id, type, config: {} };
}

/**
 * Validate + compile. A valid LINEAR drip: exactly one trigger node, a single connected chain from
 * it covering every node, ≤1 outgoing (and ≤1 incoming) edge per node, no cycle, all configs
 * complete. Returns ordered actions + trigger-derived triggerType/conditions.
 */
export function compileDrip(rawGraph: any): CompileResult {
  const graph = normalizeGraph(rawGraph);
  const errors: DripError[] = [];
  const { nodes, edges } = graph;

  if (!nodes.length) return { ok: false, errors: [{ message: "This drip is empty — add a trigger and some steps." }] };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const triggers = nodes.filter((n) => TRIGGER_TYPES.includes(n.type));
  if (triggers.length === 0) errors.push({ message: "Add a starting step (Enroll audience or Enroll on condition)." });
  if (triggers.length > 1) triggers.forEach((t) => errors.push({ nodeId: t.id, message: "Only one starting step is allowed." }));

  // Edge integrity + linear guards (≤1 outgoing, ≤1 incoming).
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  const outTarget = new Map<string, string>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) { errors.push({ message: "A connector points to a missing step." }); continue; }
    outCount.set(e.source, (outCount.get(e.source) || 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
    outTarget.set(e.source, e.target);
  }
  nodes.forEach((n) => {
    if ((outCount.get(n.id) || 0) > 1) errors.push({ nodeId: n.id, message: "This step branches to more than one — branching isn't supported yet." });
    if ((inCount.get(n.id) || 0) > 1) errors.push({ nodeId: n.id, message: "This step is joined from more than one — merges aren't supported yet." });
  });

  // A trigger must not be a target; walk the single chain from the trigger.
  let chain: DripNode[] = [];
  if (triggers.length === 1 && !errors.some((e) => e.message.includes("branches") || e.message.includes("joined") || e.message.includes("missing step"))) {
    const start = triggers[0];
    if ((inCount.get(start.id) || 0) > 0) errors.push({ nodeId: start.id, message: "The starting step can't have anything connected into it." });
    const visited = new Set<string>();
    let cur: string | undefined = start.id;
    let cycle = false;
    while (cur) {
      if (visited.has(cur)) { cycle = true; break; }
      visited.add(cur);
      const nn = byId.get(cur); if (nn) chain.push(nn);
      cur = outTarget.get(cur);
    }
    if (cycle) errors.push({ message: "The steps form a loop — remove the connector that points backwards." });
    // Orphans: any node not on the chain.
    nodes.forEach((n) => { if (!visited.has(n.id)) errors.push({ nodeId: n.id, message: "This step isn't connected to the flow." }); });
  }

  // Per-node config completeness (report regardless, so users see everything to fix).
  nodes.forEach((n) => { const ce = configError(n); if (ce) errors.push({ nodeId: n.id, message: ce }); });

  if (errors.length) return { ok: false, errors };

  // Compile: trigger drives triggerType/conditions; the rest of the chain -> ordered actions.
  const trigger = triggers[0];
  const triggerType = "Manual"; // drips are enrolled (audience/manual), not fired by a system event
  const conditions = trigger.type === "enroll_condition" && Array.isArray(trigger.config.rules)
    ? trigger.config.rules.filter((r: Rule) => ruleComplete(r))
    : [];
  const actions = chain.slice(1).map(toAction);
  return { ok: true, errors: [], automation: { triggerType, conditions, actions }, triggerNodeId: trigger.id };
}
