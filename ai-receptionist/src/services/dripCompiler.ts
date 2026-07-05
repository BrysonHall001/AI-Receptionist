// Drip compiler — validate a drip graph and compile it into automation payload(s).
//   • Linear drip  -> ONE Automation (triggerType + conditions + ordered actions), as in slice 2.
//   • Branched drip -> a PAIR of FlowDefinitions ("if" + "otherwise") that dripService lands via the
//     engine's existing applyFlowDefinition path, sharing a pairId — exactly like the branching
//     wizard. A branch node holds a condition and has two labeled outgoing edges (edge.branch:
//     "if" | "otherwise"); the "otherwise" flow uses the negated condition.
// Pure + DB-free so it's unit-testable. Scope: at most one branch node; each side is linear.
import { ruleComplete, type Rule } from "../automation/conditions";

export interface DripNode { id: string; type: string; x: number; y: number; config: Record<string, any> }
export interface DripEdge { source: string; target: string; branch?: "if" | "otherwise" }
export interface DripGraph { nodes: DripNode[]; edges: DripEdge[] }

export interface DripError { nodeId?: string; message: string }
export interface CompiledAction { id?: string; type: string; config: Record<string, any> }
export interface FlowDef { name?: string; triggerType: string; conditions: any[]; actions: CompiledAction[] }
export interface CompileResult {
  ok: boolean;
  errors: DripError[];
  kind?: "linear" | "branched";
  automation?: { triggerType: string; conditions: any[]; actions: CompiledAction[] }; // linear
  ifDef?: FlowDef;       // branched: the "if (match)" half
  elseDef?: FlowDef;     // branched: the "otherwise" half
  branchNodeId?: string;
  triggerNodeId?: string;
}

export const TRIGGER_TYPES = ["enroll_audience", "enroll_condition"];
const ACTION_MAP: Record<string, string> = { wait: "wait", send_email: "send_email", send_survey: "send_survey", unenroll: "unenroll" };
// Exactly-negatable operators (mirrors the branching wizard's NEGATE map) — a branch condition must
// use one of these so the "otherwise" path is provably the complement of the "if" path.
export const NEGATE: Record<string, string> = { is: "is_not", is_not: "is", contains: "not_contains", not_contains: "contains", empty: "not_empty", not_empty: "empty" };
export function negateRule(r: Rule): Rule { return { ...r, op: NEGATE[(r as any).op] || (r as any).op }; }

export function normalizeGraph(graph: any): DripGraph {
  const nodes: DripNode[] = (graph && Array.isArray(graph.nodes) ? graph.nodes : []).map((n: any) => ({
    id: String(n?.id ?? ""), type: String(n?.type ?? ""),
    x: Number(n?.x) || 0, y: Number(n?.y) || 0,
    config: (n && typeof n.config === "object" && n.config) ? n.config : {},
  })).filter((n: DripNode) => n.id && n.type);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: DripEdge[] = (graph && Array.isArray(graph.edges) ? graph.edges : [])
    .map((e: any) => {
      const edge: DripEdge = { source: String(e?.source ?? ""), target: String(e?.target ?? "") };
      if (e?.branch === "if" || e?.branch === "otherwise") edge.branch = e.branch;
      return edge;
    })
    .filter((e: DripEdge) => {
      if (!e.source || !e.target || e.source === e.target) return false;
      if (!ids.has(e.source) || !ids.has(e.target)) return false;
      const k = e.source + ">" + e.target;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  return { nodes, edges };
}

function configError(node: DripNode): string | null {
  const c = node.config || {};
  switch (node.type) {
    case "enroll_audience": return (Array.isArray(c.audienceIds) && c.audienceIds.length) ? null : "Pick an audience to enroll.";
    case "enroll_condition": return (Array.isArray(c.rules) && c.rules.some((r: Rule) => ruleComplete(r))) ? null : "Add at least one condition.";
    case "wait": return (Number(c.amount) > 0 && c.unit) ? null : "Set a wait duration.";
    case "send_email":
      if (c.mode === "template") return c.templateId ? null : "Pick an email template.";
      return (String(c.subject || "").trim() && String(c.html || "").trim()) ? null : "Add a subject and message.";
    case "send_survey":
      if (!c.surveyId) return "Pick a survey.";
      return String(c.subject || "").trim() ? null : "Add an invite subject.";
    case "unenroll": return null;
    case "branch": {
      const rules = Array.isArray(c.rules) ? c.rules : [];
      const complete = rules.filter((r: Rule) => ruleComplete(r));
      if (!complete.length) return "Add a branch condition.";
      const bad = complete.find((r: any) => !NEGATE[r.op]);
      if (bad) return "Branch conditions must use a yes/no style operator (is, contains, is empty, …).";
      return null;
    }
    case "enroll": return "“Enroll” can only be used as the starting step (as an audience enrollment).";
    default: return `Unknown step type “${node.type}”.`;
  }
}

function toAction(node: DripNode): CompiledAction {
  const c = node.config || {};
  const type = ACTION_MAP[node.type];
  if (node.type === "wait") return { id: node.id, type, config: { amount: Number(c.amount) || 0, unit: c.unit || "days" } };
  if (node.type === "send_email") {
    return c.mode === "template" ? { id: node.id, type, config: { templateId: c.templateId } } : { id: node.id, type, config: { subject: c.subject || "", html: c.html || "" } };
  }
  if (node.type === "send_survey") return { id: node.id, type, config: { surveyId: c.surveyId, subject: c.subject || "", html: c.html || "" } };
  if (node.type === "unenroll") return { id: node.id, type, config: {} };
  return { id: node.id, type, config: {} };
}

// Walk a single linear chain from `startId` following the one outgoing edge per node, stopping at a
// branch node (returned separately) or the end. Returns the ordered nodes (excluding the branch) and
// the branch node if the chain hits one.
function walkLinear(startId: string, byId: Map<string, DripNode>, outEdges: Map<string, DripEdge[]>, visited: Set<string>): { chain: DripNode[]; branch: DripNode | null; cycle: boolean } {
  const chain: DripNode[] = [];
  let cur: string | undefined = startId;
  let cycle = false;
  while (cur) {
    if (visited.has(cur)) { cycle = true; break; }
    visited.add(cur);
    const n = byId.get(cur); if (!n) break;
    if (n.type === "branch") return { chain, branch: n, cycle };
    chain.push(n);
    const outs: DripEdge[] = outEdges.get(cur) || [];
    cur = outs.length ? outs[0].target : undefined;
  }
  return { chain, branch: null, cycle };
}

export function compileDrip(rawGraph: any): CompileResult {
  const graph = normalizeGraph(rawGraph);
  const errors: DripError[] = [];
  const { nodes, edges } = graph;
  if (!nodes.length) return { ok: false, errors: [{ message: "This drip is empty — add a trigger and some steps." }] };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const triggers = nodes.filter((n) => TRIGGER_TYPES.includes(n.type));
  const branches = nodes.filter((n) => n.type === "branch");
  if (triggers.length === 0) errors.push({ message: "Add a starting step (Enroll audience or Enroll on condition)." });
  if (triggers.length > 1) triggers.forEach((t) => errors.push({ nodeId: t.id, message: "Only one starting step is allowed." }));
  if (branches.length > 1) branches.forEach((b) => errors.push({ nodeId: b.id, message: "Only one branch is supported per drip (for now)." }));

  // Build edge maps + linear guards. Branch nodes may have 2 outgoing (one "if", one "otherwise");
  // every other node at most 1. Every node at most 1 incoming (no merges).
  const outEdges = new Map<string, DripEdge[]>();
  const inCount = new Map<string, number>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) { errors.push({ message: "A connector points to a missing step." }); continue; }
    const arr = outEdges.get(e.source) || [];
    arr.push(e); outEdges.set(e.source, arr);
    inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
  }
  nodes.forEach((n) => {
    const outs: DripEdge[] = outEdges.get(n.id) || [];
    if (n.type === "branch") {
      const labels = outs.map((e) => e.branch);
      if (outs.length > 2) errors.push({ nodeId: n.id, message: "A branch can have at most two paths (If and Otherwise)." });
      if (outs.some((e) => e.branch !== "if" && e.branch !== "otherwise")) errors.push({ nodeId: n.id, message: "Each branch connector must be an If or Otherwise path." });
      if (labels.filter((l) => l === "if").length > 1) errors.push({ nodeId: n.id, message: "Only one “If” path is allowed." });
      if (labels.filter((l) => l === "otherwise").length > 1) errors.push({ nodeId: n.id, message: "Only one “Otherwise” path is allowed." });
    } else if (outs.length > 1) {
      errors.push({ nodeId: n.id, message: "This step branches to more than one — only a Branch step can split the flow." });
    }
    if ((inCount.get(n.id) || 0) > 1) errors.push({ nodeId: n.id, message: "This step is joined from more than one — merges aren't supported." });
  });

  const hasStructuralError = errors.some((e) => /branches|joined|missing step|at most two|If or Otherwise|“If”|“Otherwise”/.test(e.message));

  // Per-node config completeness (always reported).
  nodes.forEach((n) => { const ce = configError(n); if (ce) errors.push({ nodeId: n.id, message: ce }); });

  // Walk the graph from the trigger.
  let trunk: DripNode[] = [];
  let branchNode: DripNode | null = null;
  let ifChain: DripNode[] = [];
  let elseChain: DripNode[] = [];
  if (triggers.length === 1 && branches.length <= 1 && !hasStructuralError) {
    const start = triggers[0];
    if ((inCount.get(start.id) || 0) > 0) errors.push({ nodeId: start.id, message: "The starting step can't have anything connected into it." });
    const visited = new Set<string>();
    const w = walkLinear(start.id, byId, outEdges, visited);
    if (w.cycle) errors.push({ message: "The steps form a loop — remove the connector that points backwards." });
    trunk = w.chain; branchNode = w.branch;
    if (branchNode) {
      const outs = outEdges.get(branchNode.id) || [];
      const ifEdge = outs.find((e) => e.branch === "if");
      const elseEdge = outs.find((e) => e.branch === "otherwise");
      if (ifEdge) { const wi = walkLinear(ifEdge.target, byId, outEdges, visited); ifChain = wi.chain; if (wi.branch) errors.push({ nodeId: wi.branch.id, message: "Nested branches aren't supported yet." }); if (wi.cycle) errors.push({ message: "The If path loops back on itself." }); }
      if (elseEdge) { const we = walkLinear(elseEdge.target, byId, outEdges, visited); elseChain = we.chain; if (we.branch) errors.push({ nodeId: we.branch.id, message: "Nested branches aren't supported yet." }); if (we.cycle) errors.push({ message: "The Otherwise path loops back on itself." }); }
    }
    nodes.forEach((n) => { if (!visited.has(n.id)) errors.push({ nodeId: n.id, message: "This step isn't connected to the flow." }); });
  }

  if (errors.length) return { ok: false, errors };

  const trigger = triggers[0];
  const triggerType = "Manual";
  const baseConditions = trigger.type === "enroll_condition" && Array.isArray(trigger.config.rules)
    ? trigger.config.rules.filter((r: Rule) => ruleComplete(r)) : [];
  // The trigger node defines the triggerType + enroll conditions — it is NOT an action.
  const actionsOf = (chain: DripNode[]) => chain.filter((n) => !TRIGGER_TYPES.includes(n.type)).map(toAction);

  if (!branchNode) {
    // Linear: trigger + trunk.
    return { ok: true, errors: [], kind: "linear", automation: { triggerType, conditions: baseConditions, actions: actionsOf(trunk) }, triggerNodeId: trigger.id };
  }

  // Branched: build the two flows. Both replay the shared trunk (actions before the branch), then
  // their own path. The branch condition (and its negation) gate each flow.
  const branchRules = (Array.isArray(branchNode.config.rules) ? branchNode.config.rules : []).filter((r: Rule) => ruleComplete(r));
  const ifConditions = [...baseConditions, ...branchRules];
  const elseConditions = [...baseConditions, ...branchRules.map(negateRule)];
  const trunkActions = actionsOf(trunk);
  const ifDef: FlowDef = { triggerType, conditions: ifConditions, actions: [...trunkActions, ...actionsOf(ifChain)] };
  const elseDef: FlowDef = { triggerType, conditions: elseConditions, actions: [...trunkActions, ...actionsOf(elseChain)] };
  return { ok: true, errors: [], kind: "branched", ifDef, elseDef, branchNodeId: branchNode.id, triggerNodeId: trigger.id };
}
