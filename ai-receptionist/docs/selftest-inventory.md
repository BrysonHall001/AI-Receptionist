# Self-test inventory

Run started **2026-07-30 20:31 UTC** — mode `gate`.

One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.

## Summary

| result | count | what it means |
| --- | --- | --- |
| Passed | 53 | every assertion in the suite held |
| Failed | 3 | the suite ran and at least one assertion did not hold |
| Timed out | 0 | no result within 120s — not the same thing as failing |
| Not run | 0 | never started; the reason is on the row |
| **Total recorded** | **56** | of 56 suites |

Measured time across the recorded suites: **501.2s**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.

## Every suite

| suite | lane | result | took | first failing assertion |
| --- | --- | --- | --- | --- |
| `selfTest_devToolsTabs` | server | **FAILED** | 16.5s | Tools renders a strip of exactly one tab labelled "Demo Data" () |
| `selfTest_suggestions1` | server | **FAILED** | 27.4s | threw: TypeError: Cannot read properties of null (reading 'click') |
| `selfTest_tenantIdentity` | server | **FAILED** | 36.3s | threw: TypeError: Cannot read properties of null (reading 'querySelector') |
| `selfTest_adaptationCounters` | server | passed | 13.9s |  |
| `selfTest_aiIntake` | database | passed | 4.0s |  |
| `selfTest_aiReceptionistTemplate` | database | passed | 2.3s |  |
| `selfTest_aiSchedulingTarget` | database | passed | 4.4s |  |
| `selfTest_allThemeContrast` | scanner | passed | 446ms |  |
| `selfTest_appShell` | scanner | passed | 1.4s |  |
| `selfTest_auditViewer` | database | passed | 516ms |  |
| `selfTest_bellOrganic` | server | passed | 13.6s |  |
| `selfTest_createUi2` | server | passed | 7.3s |  |
| `selfTest_customerComms` | database | passed | 6.8s |  |
| `selfTest_demoSeeder` | server | passed | 25.5s |  |
| `selfTest_demoTenantSafety` | server | passed | 58.3s |  |
| `selfTest_demoTooling` | server | passed | 17.9s |  |
| `selfTest_designRatchet` | scanner | passed | 343ms |  |
| `selfTest_devToolsShell` | database | passed | 348ms |  |
| `selfTest_domSmoke` | server | passed | 13.9s |  |
| `selfTest_estimates` | database | passed | 3.5s |  |
| `selfTest_fileStorage` | database | passed | 28.5s |  |
| `selfTest_fsPunchlist1` | database | passed | 3.4s |  |
| `selfTest_globalSearchA` | server | passed | 9.9s |  |
| `selfTest_globalSearchB` | server | passed | 8.2s |  |
| `selfTest_hubPolish` | server | passed | 10.8s |  |
| `selfTest_hubPolish3` | server | passed | 8.3s |  |
| `selfTest_hubUiConsistency` | server | passed | 11.4s |  |
| `selfTest_lcFieldServices` | server | passed | 9.3s |  |
| `selfTest_lcRecruitment` | server | passed | 11.8s |  |
| `selfTest_learningCenter3` | database | passed | 611ms |  |
| `selfTest_linkConventions` | database | passed | 2.4s |  |
| `selfTest_listpageIntegrity` | database | passed | 3.4s |  |
| `selfTest_mfa` | server | passed | 12.2s |  |
| `selfTest_multiVisitCardFix` | server | passed | 9.8s |  |
| `selfTest_notifications1` | server | passed | 8.3s |  |
| `selfTest_notifUiFit` | server | passed | 7.1s |  |
| `selfTest_permissionsRegroup` | scanner | passed | 383ms |  |
| `selfTest_presence` | database | passed | 3.4s |  |
| `selfTest_priceBook` | database | passed | 3.2s |  |
| `selfTest_recurringWork` | database | passed | 3.0s |  |
| `selfTest_rmContentPack` | server | passed | 8.5s |  |
| `selfTest_rmTemplate1` | server | passed | 8.9s |  |
| `selfTest_routeAwareness` | server | passed | 5.2s |  |
| `selfTest_rowAnatomy` | server | passed | 7.6s |  |
| `selfTest_runnerHarness` | database | passed | 5.1s |  |
| `selfTest_schedulingCalendar` | database | passed | 3.9s |  |
| `selfTest_servicePlans` | server | passed | 6.8s |  |
| `selfTest_settingsSweep` | server | passed | 10.9s |  |
| `selfTest_ssoSignIn` | database | passed | 1.1s |  |
| `selfTest_tablePersistence` | server | passed | 6.0s |  |
| `selfTest_tenantsTableUi` | scanner | passed | 317ms |  |
| `selfTest_tenantTemplates1` | server | passed | 6.1s |  |
| `selfTest_tenantTemplates2` | server | passed | 8.0s |  |
| `selfTest_transcriptInsights` | server | passed | 6.9s |  |
| `selfTest_widgetChrome` | scanner | passed | 2.5s |  |
| `selfTest_workOrders1` | database | passed | 3.4s |  |

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
- `selfTest_tenantIdentity` — threw: TypeError: Cannot read properties of null (reading 'querySelector')
- `selfTest_suggestions1` — threw: TypeError: Cannot read properties of null (reading 'click')
