# Self-test inventory

Run started **2026-07-30 15:26 UTC** — mode `gate`.

One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.

## Summary

| result | count | what it means |
| --- | --- | --- |
| Passed | 46 | every assertion in the suite held |
| Failed | 4 | the suite ran and at least one assertion did not hold |
| Timed out | 0 | no result within 120s — not the same thing as failing |
| Not run | 0 | never started; the reason is on the row |
| **Total recorded** | **50** | of 50 suites |

Measured time across the recorded suites: **541.4s**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.

## Every suite

| suite | lane | result | took | first failing assertion |
| --- | --- | --- | --- | --- |
| `selfTest_devToolsTabs` | server | **FAILED** | 17.0s | Tools renders a strip of exactly one tab labelled "Demo Data" () |
| `selfTest_hubPolish3` | server | **FAILED** | 23.5s | both panels render (Pages \| Modules) |
| `selfTest_rowAnatomy` | server | **FAILED** | 32.5s | the Pages checklist host carries the narrow-consumer class |
| `selfTest_tenantIdentity` | server | **FAILED** | 55.3s | PICKER OFFERS FIELDS THE CARD IGNORES: name, demo, status, created, ai, calls, contacts, users, actions — add them to buildCard or remove them from the picker |
| `selfTest_adaptationCounters` | server | passed | 14.1s |  |
| `selfTest_aiIntake` | database | passed | 4.1s |  |
| `selfTest_aiSchedulingTarget` | database | passed | 3.9s |  |
| `selfTest_allThemeContrast` | scanner | passed | 431ms |  |
| `selfTest_auditViewer` | database | passed | 455ms |  |
| `selfTest_bellOrganic` | server | passed | 14.4s |  |
| `selfTest_createUi2` | server | passed | 7.3s |  |
| `selfTest_customerComms` | database | passed | 6.6s |  |
| `selfTest_demoSeeder` | server | passed | 28.9s |  |
| `selfTest_demoTenantSafety` | server | passed | 61.7s |  |
| `selfTest_demoTooling` | server | passed | 18.8s |  |
| `selfTest_designRatchet` | scanner | passed | 339ms |  |
| `selfTest_devToolsShell` | database | passed | 500ms |  |
| `selfTest_domSmoke` | server | passed | 14.3s |  |
| `selfTest_estimates` | database | passed | 3.3s |  |
| `selfTest_fileStorage` | database | passed | 34.0s |  |
| `selfTest_fsPunchlist1` | database | passed | 3.2s |  |
| `selfTest_globalSearchA` | server | passed | 9.8s |  |
| `selfTest_globalSearchB` | server | passed | 8.4s |  |
| `selfTest_hubPolish` | server | passed | 10.7s |  |
| `selfTest_hubUiConsistency` | server | passed | 11.9s |  |
| `selfTest_lcFieldServices` | server | passed | 9.4s |  |
| `selfTest_lcRecruitment` | server | passed | 11.3s |  |
| `selfTest_learningCenter3` | database | passed | 600ms |  |
| `selfTest_linkConventions` | database | passed | 2.5s |  |
| `selfTest_listpageIntegrity` | database | passed | 3.2s |  |
| `selfTest_multiVisitCardFix` | server | passed | 10.2s |  |
| `selfTest_notifications1` | server | passed | 8.5s |  |
| `selfTest_notifUiFit` | server | passed | 7.7s |  |
| `selfTest_priceBook` | database | passed | 2.8s |  |
| `selfTest_recurringWork` | database | passed | 3.4s |  |
| `selfTest_rmContentPack` | server | passed | 8.4s |  |
| `selfTest_rmTemplate1` | server | passed | 9.3s |  |
| `selfTest_routeAwareness` | server | passed | 5.5s |  |
| `selfTest_runnerHarness` | database | passed | 5.2s |  |
| `selfTest_schedulingCalendar` | database | passed | 3.9s |  |
| `selfTest_servicePlans` | server | passed | 7.0s |  |
| `selfTest_settingsSweep` | server | passed | 11.1s |  |
| `selfTest_suggestions1` | server | passed | 12.1s |  |
| `selfTest_tablePersistence` | server | passed | 6.3s |  |
| `selfTest_tenantsTableUi` | scanner | passed | 301ms |  |
| `selfTest_tenantTemplates1` | server | passed | 6.1s |  |
| `selfTest_tenantTemplates2` | server | passed | 7.2s |  |
| `selfTest_transcriptInsights` | server | passed | 7.7s |  |
| `selfTest_widgetChrome` | scanner | passed | 2.8s |  |
| `selfTest_workOrders1` | database | passed | 3.4s |  |

## Triage — the ones that did not pass, grouped by likely cause

These groupings are a **judgement about cause, not a diagnosis**, and nothing here has been repaired. A suite that fails because an approved change moved a string it was pinned to needs a completely different decision from one that fails because the product is actually broken, which is exactly why they are separated before anyone touches either.

### Pins a string that a later batch deliberately changed — 0

_None._

### Asserts behaviour that appears genuinely broken — 0

_None._

### Could not run at all — 0

_None._

### Red, cause not yet determined — 4

- `selfTest_devToolsTabs` — Tools renders a strip of exactly one tab labelled "Demo Data" ()
- `selfTest_tenantIdentity` — PICKER OFFERS FIELDS THE CARD IGNORES: name, demo, status, created, ai, calls, contacts, users, actions — add them to buildCard or remove them from the picker
- `selfTest_rowAnatomy` — the Pages checklist host carries the narrow-consumer class
- `selfTest_hubPolish3` — both panels render (Pages \| Modules)
