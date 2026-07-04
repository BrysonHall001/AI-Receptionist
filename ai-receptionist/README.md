# AI Phone Receptionist — MVP

A working, end-to-end SaaS MVP: **a real inbound phone call → an AI conversation → structured data extraction → a database record → an email notification.**

Stack (locked): **Node.js + TypeScript + Express + Prisma + PostgreSQL (Neon-compatible) + Twilio Voice webhooks + OpenAI + Resend.**

The "AI conversation" uses Twilio's speech `<Gather>` plus OpenAI text reasoning (not realtime audio). Twilio transcribes the caller's speech, OpenAI decides what to say next and what to extract, and the server speaks the reply back with `<Say>`. This is the version that runs with nothing more than webhooks, an OpenAI key, and an email key.

## Web dashboard & demo mode

Open the server's root URL in a browser and you get a built-in dashboard (Linear/Notion-style): a **Dashboard** with stats + recent calls, a **Calls** table (click a row for the full transcript), and a **Contacts** list (click for call history). A **Simulate call** button in the top-right runs a complete fake call end-to-end so records appear with no phone needed.

**Demo mode is automatic.** If your OpenAI / Resend keys are still placeholders (the values in `.env.example`), the app uses a local mock receptionist that extracts name/phone/intent without any API calls, and logs emails instead of sending them. The moment you put in a real OpenAI key, it switches to the real model — no code change. You can also force it with `AI_PROVIDER` / `EMAIL_PROVIDER` (`auto` | `mock` | `openai`/`resend`).

---

## File tree

```
ai-receptionist/
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   ├── schema.prisma            # Tenant, CallSession, Contact + CallStatus enum
│   └── migrations/
│       ├── migration_lock.toml
│       └── 0001_init/migration.sql
├── scripts/
│   └── simulate-call.ts         # drive a whole call through the internal API (no phone)
└── src/
    ├── index.ts                 # server bootstrap + graceful shutdown
    ├── app.ts                   # express app, body parsers, route mounting, /healthz
    ├── config/
    │   └── env.ts               # zod env validation; process exits if a required var is missing
    ├── db/
    │   ├── client.ts            # Prisma client singleton + connect/disconnect
    │   └── seed.ts              # seed one default tenant bound to TWILIO_PHONE_NUMBER
    ├── telephony/
    │   ├── twiml.ts             # TwiML builders (sayAndGather / sayAndHangup)
    │   └── twilioParams.ts      # parse webhook params + optional signature validation
    ├── ai/
    │   ├── schema.ts            # zod schemas for the strict AI JSON contract
    │   ├── prompt.ts            # receptionist system-prompt builder
    │   └── engine.ts            # runAITurn(): OpenAI call + JSON enforcement + retry
    ├── callflow/
    │   └── stateMachine.ts      # INIT → GREETING → COLLECTING_INFO → COMPLETED (+FAILED)
    ├── services/
    │   ├── callSessionService.ts   # create/get/update + atomic finalization claim
    │   ├── contactService.ts       # createOrUpdateContact (upsert, no duplicates)
    │   ├── notificationService.ts  # Resend wrapper + sendCallSummaryEmail
    │   └── callOrchestrator.ts     # the core: ties state machine + AI + DB + email together
    ├── routes/
    │   ├── twilioWebhooks.ts    # POST /webhooks/twilio/inbound, /status
    │   └── internal.ts          # POST /internal/call/start, /update, /end
    └── utils/
        ├── logger.ts
        └── transcript.ts        # transcript turns, OpenAI message mapping, summary
```

---

## Execution flow (maps exactly to code)

1. **Call arrives.** Twilio receives a call to your number and POSTs to `/webhooks/twilio/inbound` → `src/routes/twilioWebhooks.ts`.
2. **Session created.** No session exists for this `CallSid`, so `callOrchestrator.startCall()` resolves the tenant (by the called number, `src/services/callOrchestrator.ts` → `resolveTenantId`) and `callSessionService.createCallSession()` writes a `CallSession` row (status `GREETING`).
3. **Greeting spoken.** The deterministic tenant greeting is returned as TwiML `<Say>` + `<Gather input="speech">` (`telephony/twiml.ts`), pointed back at `/webhooks/twilio/inbound`.
4. **Caller speaks.** Twilio transcribes the speech and POSTs `SpeechResult` to the same endpoint. A session now exists, so the route calls `callOrchestrator.handleTurn()`.
5. **AI called + validated.** `handleTurn` builds the prompt (`ai/prompt.ts`), sends the transcript to OpenAI (`ai/engine.ts` → `runAITurn`), forces `response_format: json_object`, parses, and validates against the zod contract (`ai/schema.ts`). Invalid output is retried up to `AI_MAX_RETRIES`.
6. **State + DB updated.** Extracted fields are merged (caller ID backfills the phone), the state machine clamps the AI's requested transition (`callflow/stateMachine.ts`), and `updateCallSession()` persists transcript + extracted data + status.
7. **Reply spoken / loop.** If not terminal, TwiML speaks the reply and gathers again (back to step 4). If `COMPLETED`, the call is finalized and the TwiML hangs up.
8. **Finalized once, email sent.** `finalizeCall()` atomically claims finalization (`claimFinalization` via `updateMany ... where finalizedAt: null`), upserts the `Contact` (`contactService.ts`), and sends the summary email exactly once (`notificationService.ts`). Twilio also POSTs to `/webhooks/twilio/status`; on `completed` it calls `finalizeCall` again, which is a no-op because finalization was already claimed.

The strict AI JSON contract (LAYER 3):

```json
{
  "message_to_speak": "string",
  "extracted": { "name": "string|null", "intent": "string|null", "phone": "string|null", "email": "string|null" },
  "state_update": "GREETING | COLLECTING_INFO | COMPLETED"
}
```

---

## Build & run

### 1. Prerequisites
- Node.js 18+ (uses global `fetch`)
- A PostgreSQL database (Neon works; copy its connection string)
- Accounts: Twilio (a voice-capable phone number), OpenAI, Resend

### 2. Install
```bash
npm install
```

### 3. Configure env
```bash
cp .env.example .env
# fill in the six REQUIRED variables (the server refuses to boot otherwise)
```

### 4. Generate the Prisma client + create tables
```bash
npm run prisma:generate     # prisma generate
npm run prisma:migrate      # prisma migrate deploy  (applies prisma/migrations)
npm run seed                # creates one tenant bound to TWILIO_PHONE_NUMBER
```
> If you'd rather let Prisma author the migration against your own DB, run
> `npm run prisma:migrate:dev` instead of `prisma:migrate` — the schema and the
> committed `0001_init` migration are identical.

### 5. Run the server
```bash
npm run dev      # tsx watch (development)
# or
npm run build && npm start   # compiled (dist/src/index.js)
```
Health check: `GET http://localhost:3000/healthz` → `{ "ok": true }`.

### 6. Expose to Twilio with ngrok
```bash
ngrok http 3000
```
In the Twilio console, set your number's **Voice "A call comes in"** webhook to
`https://<your-ngrok-subdomain>.ngrok.app/webhooks/twilio/inbound` (HTTP POST),
and the **status callback** to `.../webhooks/twilio/status` (HTTP POST).
For production, set `TWILIO_VALIDATE_SIGNATURE=true` to verify request signatures.

### 7. Test
- **Real call:** dial your Twilio number, talk to the receptionist, then check (a) the `CallSession`/`Contact` rows in your DB and (b) the summary email in the tenant's `notifyEmail` inbox.
- **No phone needed:** with the server running, `npm run simulate` drives a full scripted call through `/internal/call/*` (this makes real OpenAI calls and sends a real email).

---

## Environment variables (LAYER 10)

Required (validated in `src/config/env.ts`; missing any of these exits the process):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OPENAI_API_KEY`, `DATABASE_URL`, `RESEND_API_KEY`.

Optional (defaults shown in `.env.example`): `OPENAI_MODEL`, `RESEND_FROM`, `PORT`, `TWILIO_VALIDATE_SIGNATURE`, `MAX_TURNS`, `MAX_EMPTY_TURNS`, `AI_MAX_RETRIES`.

> **Resend note:** `RESEND_FROM` must be a sender Resend will accept. The default
> `onboarding@resend.dev` only delivers to your own account email; for real
> delivery, verify a domain in Resend and set `RESEND_FROM` to an address on it.

---

## Failure modes & handling (LAYER 13)

- **AI returns invalid JSON.** `runAITurn` parses + zod-validates and retries up to `AI_MAX_RETRIES`, nudging the model to return only JSON. If it still fails, `handleTurn` catches the `AIEngineError`, speaks a safe fallback line, keeps the partial data, and (after repeated failures) finalizes gracefully so the lead is still saved and emailed.
- **Twilio webhook retries / duplicate posts.** Sessions are keyed by `CallSid`. A duplicate inbound for a known call re-greets idempotently; finalization is guarded so retries never double-write or double-email.
- **Race on call end.** The conversation can hit `COMPLETED` at the same time Twilio's status webhook fires. `claimFinalization` does an atomic `updateMany(where finalizedAt: null)`; only the first wins, so the contact upsert + email happen exactly once.
- **DB write failure during finalize.** The `CallSession` row is created on call start and finalized before notification, so the call always persists. The contact upsert and the email send are each wrapped in try/catch and logged; a failure in one does not abort the others.
- **Missing/invalid env vars.** `loadEnv()` runs on first import and calls `process.exit(1)` with a precise list of what's missing — the server cannot boot misconfigured.
- **Caller silence / timeout.** `<Gather actionOnEmptyResult>` still posts on silence; `handleTurn` counts empty turns and ends the call cleanly after `MAX_EMPTY_TURNS`. A hard `MAX_TURNS` cap prevents runaway loops.

---

## Sandbox note (Prisma engine)

This project was authored and fully type-checked in a network-restricted sandbox where Prisma's engine CDN (`binaries.prisma.sh`) was unreachable, so the **typed** client could not be generated there. The code is written to compile with or without the generated client. In your environment, `npm run prisma:generate` downloads the engine and produces the fully typed client normally. The migration runs against your real Postgres with `npm run prisma:migrate`.

---

## Final guarantee

**This system can handle a real inbound phone call and persist a lead end-to-end if environment variables are correctly configured and the server is publicly reachable.**

## Going live with Stripe

Billing runs in Stripe **test mode** while `STRIPE_SECRET_KEY` starts with `sk_test_`. To go live:

1. Replace `STRIPE_SECRET_KEY` with your **live** key (`sk_live_...`).
2. Add a **live-mode** webhook in the Stripe Dashboard pointing at `https://<your-app>/webhooks/stripe` (events: `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`, `invoice.finalized`, `invoice.sent`), then set `STRIPE_WEBHOOK_SECRET` to that endpoint's `whsec_...` signing secret.
3. Complete Stripe business/identity verification so live invoices can be paid.

The **Billing & Usage** page shows a `Stripe: TEST mode` / `Stripe: LIVE mode` badge so you always know whether real money is in play. All keys are read from the environment — nothing is hardcoded.
