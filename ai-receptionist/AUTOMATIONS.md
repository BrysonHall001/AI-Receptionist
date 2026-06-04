# Automation System

An event-driven foundation that lets the CRM react to changes and user actions.
It is split into two loosely-coupled halves — an **event system** that records
what happened, and an **automation engine** that decides what to do about it.
Neither half knows the other's internals; they meet only at the event bus.

---

## 1. Architecture overview

```
                        emit()                         subscribe()
  ┌──────────────┐   structured    ┌───────────┐    ┌──────────────────┐
  │ CRM modules  │ ───  event  ──▶ │ Event bus │ ─▶ │ Automation engine │
  │ (contacts,   │                 │  + Event  │    │  trigger match    │
  │  email, sms, │                 │   log DB  │    │  → conditions     │
  │  activity…)  │                 └───────────┘    │  → actions        │
  └──────────────┘                       │          │  → run log        │
        ▲                                │          └──────────────────┘
        │ actions mutate contacts        │                   │
        └────────────────────────────────┴───────────────────┘
            (action mutations emit events too, tagged actor=automation,
             which the engine ignores — loop-safe)
```

- **Emitters** call one function — `emitEvent()` — and move on. They never
  import the engine, so adding a new emitter (or a brand-new module) requires no
  change to automation code.
- **The bus** persists every event to the `Event` table (debug + history) and
  fans it out to subscribers asynchronously (`setImmediate`), so the user's
  request returns immediately and downstream work never blocks it.
- **The engine** is just one subscriber. It loads the automations whose trigger
  matches the event type, evaluates their conditions, runs their actions, and
  writes an `AutomationRun` row per execution.

### Why loosely coupled
The bus treats `type` as an opaque string and `payload` as open JSON. A new
event type is a new string literal; a new action type is one entry in a registry
plus an executor function. The core dispatch logic never changes — satisfying
"add new event types / modules without refactoring."

---

## 2. Data models

Persistent (Prisma — see `prisma/schema.prisma`): `Event`, `Automation`,
`AutomationRun`. `conditions` and `actions` are JSON columns so new operators or
action types need **no migration**.

TypeScript contracts (`src/events/types.ts`, `src/automation/*`):

```ts
// ---- Event ----
type ActorType = "user" | "system" | "automation";
interface DomainEvent<P = Record<string, any>> {
  id: string;
  tenantId: string;
  type: string;                 // "ContactCreated", "TagAdded", …
  actor: { type: ActorType; id?: string | null; name?: string | null };
  subject: { type: string; id: string | null };   // e.g. { type:"contact", id }
  payload: P;                   // type-specific, e.g. { changes:[…] }
  occurredAt: string;           // ISO
}

// ---- Trigger ----  (an automation is triggered by exactly one event type)
type Trigger = string;          // matches DomainEvent.type

// ---- Condition ----  (reuses the contact/report filter shape from table.js)
interface Rule {
  field: string;                // contact field key (system or custom)
  op: "contains"|"not_contains"|"is"|"is_not"|"empty"|"not_empty"
     |"before"|"after"|"gt"|"lt"|"today"|"between"|"previous";
  value?: any; value2?: any; unit?: string;
  conj?: "AND" | "OR";          // "OR" starts a new group: (A AND B) OR (C AND D)
}

// ---- Action ----
interface ActionConfig { type: string; config?: Record<string, any>; }
interface ActionResult { type: string; status: "success"|"skipped"|"failed"; detail?: string; error?: string; }

// ---- Automation / workflow ----
interface Automation {
  id: string; tenantId: string; name: string; enabled: boolean;
  triggerType: Trigger; conditions: Rule[]; actions: ActionConfig[];
}

// ---- Execution log ----
interface AutomationRun {
  id: string; automationId: string; eventType: string; contactId: string | null;
  status: "success" | "failed" | "skipped"; matched: boolean;
  results: ActionResult[]; error?: string | null; createdAt: string;
}
```

Well-known event types (`EVENT_TYPES`): `ContactCreated`, `ContactUpdated`,
`FieldChanged`, `TagAdded`, `TagRemoved`, `EmailSent`, `SMSSent`, `NoteAdded`,
`ActivityLogged`.

---

## 3. Core logic

**Emitting.** Mutation sites emit events with provenance:
- `contactService` → `ContactCreated`, `ContactUpdated`, `FieldChanged`
  (per field), `TagAdded`/`TagRemoved` (per value on `multi_select` fields).
- email / SMS routes and actions → `EmailSent`, `SMSSent`.
- `activityService.log` → `ActivityLogged` for every entry, plus `NoteAdded`
  for `note` entries (single source, no duplicates).

**Dispatch.** `emitEvent()` writes the `Event` row, then schedules each
subscriber via `setImmediate`. Failures are caught and logged — emitting an
event can never break the operation that produced it.

**Engine** (`src/automation/engine.ts`), per event:
1. If `actor.type === "automation"` → ignore (loop guard, see §6).
2. Load enabled automations where `triggerType === event.type`.
3. Load the subject contact; build condition columns from field defs.
4. For each automation: evaluate conditions (`evalRules`, identical semantics to
   the UI filters). If not matched → log a `skipped` run. If matched → run each
   action in order via the executor registry, collect `ActionResult`s, log a
   `success`/`failed` run.

**Conditions** reuse the exact rule engine from `public/js/table.js`, ported to
`src/automation/conditions.ts`, so a condition behaves the same as the filter a
user already builds on the Contacts page.

**Actions** live in a registry (`src/automation/actions.ts`):
`send_email`, `send_sms`, `update_field`, `add_tag`, `remove_tag`,
`create_note`, `assign_owner`. Text fields support `{{field_key}}` templating
(e.g. `Hi {{name}}`). Each executor is wrapped so it never throws — a failure
becomes a `failed` `ActionResult`, and the rest of the actions still run.

---

## 4. Example workflows

1. **Welcome new leads** — Trigger `ContactCreated`; no conditions; Action
   `send_email` (template "Welcome", or inline `Hi {{name}}…`).
2. **Tag hot leads & notify owner** — Trigger `FieldChanged`; Condition
   `intent contains "quote" AND score gt 50`; Actions `add_tag tags=VIP`,
   `assign_owner = Alice`, `create_note "Hot lead — follow up"`.
3. **Onboard by tier** — Trigger `TagAdded`; Condition `tier is gold`; Action
   `send_sms "Welcome to gold, {{name}}!"`.

Use the **Test** button on any automation to run it against a chosen contact and
see the per-action result immediately.

---

## 5. Folder structure

```
src/
  events/
    types.ts        # DomainEvent contract, EVENT_TYPES, triggerable list
    bus.ts          # subscribe(), emitEvent() — persist + async dispatch
  automation/
    conditions.ts   # rule evaluator (server mirror of table.js)
    contactRow.ts   # field metadata, columns, {{templating}}
    actions.ts      # ACTION_TYPES + executor registry (runAction)
    engine.ts       # handleEvent, testRunAutomation, registerAutomationEngine
  services/
    automationService.ts   # CRUD + run/event listing
    contactService.ts      # (emits Contact/Field/Tag events)
    activityService.ts     # (emits ActivityLogged / NoteAdded)
prisma/
  schema.prisma             # + Event, Automation, AutomationRun
  migrations/0009_automations/migration.sql
public/js/
  automations.js            # Automations tab UI (list, editor, logs)
```

---

## 6. Scalability & design decisions

- **JSON for conditions/actions.** Trades SQL queryability for zero-migration
  extensibility — the right call for a config blob read in full at run time.
  If reporting on action types is needed later, project them into columns.
- **In-process bus, async dispatch.** Non-blocking and simple. The single
  `dispatch()` function is the seam: swap it for BullMQ / SQS / Kafka to get
  durability, retries, and multi-worker throughput without touching emitters or
  the engine.
- **Indexed lookups.** `Automation(tenantId, triggerType, enabled)` makes
  trigger matching a single indexed query; `Event` and `AutomationRun` are
  indexed by tenant + time for log views.
- **Loop prevention (MVP).** Action-driven mutations still emit events (so they
  appear in the log), but tagged `actor=automation`; the engine ignores those,
  so automations cannot cascade or loop. To enable **multi-step workflows**
  later, replace that single guard with a depth counter + visited-automation set
  carried on the event context.
- **Designed-for, not-yet-built.** Drip campaigns, delays/scheduling, and AI
  actions slot in cleanly: scheduling = a queue with a `runAt`; AI actions = new
  entries in the action registry; multi-step = the loop-guard upgrade above.
  None require changes to the event contract or the bus.

---

## 7. Deploying this feature

This feature adds three tables, so a migration is required (the dev server does
not auto-migrate). After unzipping, from the project folder run:

```bash
npx prisma migrate deploy
npx prisma generate
```

then restart `npm run dev`. The new model access in the code is written to work
both before and after `prisma generate`, so the project type-checks either way.
