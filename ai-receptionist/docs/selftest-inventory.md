# Self-test inventory

Run started **2026-07-30 17:58 UTC** — mode `gate`.

One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.

## Summary

| result | count | what it means |
| --- | --- | --- |
| Passed | 51 | every assertion in the suite held |
| Failed | 3 | the suite ran and at least one assertion did not hold |
| Timed out | 0 | no result within 120s — not the same thing as failing |
| Not run | 0 | never started; the reason is on the row |
| **Total recorded** | **54** | of 54 suites |

Measured time across the recorded suites: **516.2s**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.

## Every suite

| suite | lane | result | took | first failing assertion |
| --- | --- | --- | --- | --- |
| `selfTest_devToolsTabs` | server | **FAILED** | 17.4s | Tools renders a strip of exactly one tab labelled "Demo Data" () |
| `selfTest_domSmoke` | server | **FAILED** | 29.1s | field modal: the estimate's Line items field opens with the Catalog source block visible |
| `selfTest_tenantIdentity` | server | **FAILED** | 56.2s | PICKER OFFERS FIELDS THE CARD IGNORES: name, demo, status, created, ai, calls, contacts, users, actions — add them to buildCard or remove them from the picker |
| `selfTest_adaptationCounters` | server | passed | 13.3s |  |
| `selfTest_aiIntake` | database | passed | 3.9s |  |
| `selfTest_aiReceptionistTemplate` | database | passed | 4.3s |  |
| `selfTest_aiSchedulingTarget` | database | passed | 3.9s |  |
| `selfTest_allThemeContrast` | scanner | passed | 530ms |  |
| `selfTest_appShell` | scanner | passed | 3.3s |  |
| `selfTest_auditViewer` | database | passed | 597ms |  |
| `selfTest_bellOrganic` | server | passed | 13.1s |  |
| `selfTest_createUi2` | server | passed | 7.0s |  |
| `selfTest_customerComms` | database | passed | 6.5s |  |
| `selfTest_demoSeeder` | server | passed | 25.3s |  |
| `selfTest_demoTenantSafety` | server | passed | 57.7s |  |
| `selfTest_demoTooling` | server | passed | 18.5s |  |
| `selfTest_designRatchet` | scanner | passed | 364ms |  |
| `selfTest_devToolsShell` | database | passed | 398ms |  |
| `selfTest_estimates` | database | passed | 3.2s |  |
| `selfTest_fileStorage` | database | passed | 31.6s |  |
| `selfTest_fsPunchlist1` | database | passed | 3.0s |  |
| `selfTest_globalSearchA` | server | passed | 9.6s |  |
| `selfTest_globalSearchB` | server | passed | 7.9s |  |
| `selfTest_hubPolish` | server | passed | 10.4s |  |
| `selfTest_hubPolish3` | server | passed | 7.6s |  |
| `selfTest_hubUiConsistency` | server | passed | 11.1s |  |
| `selfTest_lcFieldServices` | server | passed | 9.0s |  |
| `selfTest_lcRecruitment` | server | passed | 11.1s |  |
| `selfTest_learningCenter3` | database | passed | 634ms |  |
| `selfTest_linkConventions` | database | passed | 2.5s |  |
| `selfTest_listpageIntegrity` | database | passed | 3.2s |  |
| `selfTest_multiVisitCardFix` | server | passed | 9.7s |  |
| `selfTest_notifications1` | server | passed | 8.5s |  |
| `selfTest_notifUiFit` | server | passed | 6.9s |  |
| `selfTest_permissionsRegroup` | scanner | passed | 617ms |  |
| `selfTest_presence` | database | passed | 10.6s |  |
| `selfTest_priceBook` | database | passed | 2.9s |  |
| `selfTest_recurringWork` | database | passed | 3.5s |  |
| `selfTest_rmContentPack` | server | passed | 8.2s |  |
| `selfTest_rmTemplate1` | server | passed | 8.8s |  |
| `selfTest_routeAwareness` | server | passed | 5.3s |  |
| `selfTest_rowAnatomy` | server | passed | 7.2s |  |
| `selfTest_runnerHarness` | database | passed | 5.2s |  |
| `selfTest_schedulingCalendar` | database | passed | 3.3s |  |
| `selfTest_servicePlans` | server | passed | 6.9s |  |
| `selfTest_settingsSweep` | server | passed | 11.5s |  |
| `selfTest_suggestions1` | server | passed | 12.5s |  |
| `selfTest_tablePersistence` | server | passed | 6.0s |  |
| `selfTest_tenantsTableUi` | scanner | passed | 276ms |  |
| `selfTest_tenantTemplates1` | server | passed | 5.9s |  |
| `selfTest_tenantTemplates2` | server | passed | 7.6s |  |
| `selfTest_transcriptInsights` | server | passed | 6.8s |  |
| `selfTest_widgetChrome` | scanner | passed | 2.4s |  |
| `selfTest_workOrders1` | database | passed | 3.3s |  |

## Triage — the ones that did not pass, grouped by likely cause

These groupings are a **judgement about cause, not a diagnosis**, and nothing here has been repaired. A suite that fails because an approved change moved a string it was pinned to needs a completely different decision from one that fails because the product is actually broken, which is exactly why they are separated before anyone touches either.

### Pins a string that a later batch deliberately changed — 0

_None._

### Asserts behaviour that appears genuinely broken — 0

_None._

### Could not run at all — 0

_None._

### Red, cause not yet determined — 3

- `selfTest_devToolsTabs` — Tools renders a strip of exactly one tab labelled "Demo Data" ()
- `selfTest_tenantIdentity` — PICKER OFFERS FIELDS THE CARD IGNORES: name, demo, status, created, ai, calls, contacts, users, actions — add them to buildCard or remove them from the picker
- `selfTest_domSmoke` — field modal: the estimate's Line items field opens with the Catalog source block visible
