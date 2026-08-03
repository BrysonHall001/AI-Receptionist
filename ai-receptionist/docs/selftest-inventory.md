# Self-test inventory

Run started **2026-08-03 22:38 UTC** — mode `gate`.

> **THIS RUN WAS INCOMPLETE — 48 of 68 suites never started.** Reason recorded: _could not reach the database_. Those suites have no verdict here — not a pass, not a failure, simply not run — and every one of them says so on its own row. Running this again on a machine with the dependencies installed and the database up **replaces this file wholesale**; nothing is appended.

One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.

## Summary

| result | count | what it means |
| --- | --- | --- |
| Passed | 13 | every assertion in the suite held |
| Failed | 7 | the suite ran and at least one assertion did not hold |
| Timed out | 0 | no result within 120s — not the same thing as failing |
| Not run | 48 | never started; the reason is on the row |
| **Total recorded** | **68** | of 68 suites |

Measured time across the recorded suites: **195.2s**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.

## Every suite

| suite | lane | result | took | first failing assertion |
| --- | --- | --- | --- | --- |
| `selfTest_customerComms` | database | **FAILED** | 4.1s | PrismaClientInitializationError: |
| `selfTest_estimates` | database | **FAILED** | 2.8s | PrismaClientInitializationError: |
| `selfTest_fileStorage` | database | **FAILED** | 2.2s | PrismaClientInitializationError: |
| `selfTest_recurringWork` | database | **FAILED** | 2.4s | PrismaClientInitializationError: |
| `selfTest_runnerHarness` | database | **FAILED** | 6.1s | it names 68 suites (47 inherited from the hand-maintained block, plus the runner harness, selfTest_devToolsTabs and selfTest_widgetChrome) |
| `selfTest_schedulingCalendar` | database | **FAILED** | 3.9s | PrismaClientInitializationError: |
| `selfTest_workOrders1` | database | **FAILED** | 3.1s | PrismaClientInitializationError: |
| `selfTest_adaptationCounters` | server | not run | 4.1s | could not reach the database |
| `selfTest_aiIntake` | database | not run | 2.8s | could not reach the database |
| `selfTest_aiReceptionistTemplate` | database | not run | 1.5s | could not reach the database |
| `selfTest_aiSchedulingTarget` | database | not run | 2.8s | could not reach the database |
| `selfTest_bellOrganic` | server | not run | 4.0s | could not reach the database |
| `selfTest_builderDashboards` | database | not run | 1.5s | could not reach the database |
| `selfTest_builderModulesFields` | database | not run | 1.6s | could not reach the database |
| `selfTest_builderRework` | database | not run | 422ms | could not reach the database |
| `selfTest_builderViewsPipelines` | database | not run | 1.7s | could not reach the database |
| `selfTest_createUi2` | server | not run | 3.8s | could not reach the database |
| `selfTest_demoSeeder` | server | not run | 3.5s | could not reach the database |
| `selfTest_demoTenantSafety` | server | not run | 4.3s | could not reach the database |
| `selfTest_demoTooling` | server | not run | 4.1s | could not reach the database |
| `selfTest_devToolsTabs` | server | not run | 3.7s | could not reach the database |
| `selfTest_domSmoke` | server | not run | 4.1s | could not reach the database |
| `selfTest_foodServiceTemplate` | database | not run | 1.7s | could not reach the database |
| `selfTest_fsPunchlist1` | database | not run | 2.8s | could not reach the database |
| `selfTest_fullscreenPresence` | database | not run | 1.4s | could not reach the database |
| `selfTest_globalSearchA` | server | not run | 4.1s | could not reach the database |
| `selfTest_globalSearchB` | server | not run | 4.2s | could not reach the database |
| `selfTest_hubPolish` | server | not run | 4.1s | could not reach the database |
| `selfTest_hubPolish3` | server | not run | 4.2s | could not reach the database |
| `selfTest_hubUiConsistency` | server | not run | 4.0s | could not reach the database |
| `selfTest_iconLibrary` | database | not run | 1.8s | could not reach the database |
| `selfTest_lcFieldServices` | server | not run | 4.0s | could not reach the database |
| `selfTest_lcRecruitment` | server | not run | 4.3s | could not reach the database |
| `selfTest_linkConventions` | database | not run | 2.2s | could not reach the database |
| `selfTest_listpageIntegrity` | database | not run | 2.3s | could not reach the database |
| `selfTest_mfa` | server | not run | 3.3s | could not reach the database |
| `selfTest_multiVisitCardFix` | server | not run | 4.1s | could not reach the database |
| `selfTest_notifications1` | server | not run | 3.8s | could not reach the database |
| `selfTest_notifUiFit` | server | not run | 4.1s | could not reach the database |
| `selfTest_perModulePerms` | server | not run | 3.0s | could not reach the database |
| `selfTest_presence` | database | not run | 3.3s | could not reach the database |
| `selfTest_priceBook` | database | not run | 2.5s | could not reach the database |
| `selfTest_rmContentPack` | server | not run | 3.8s | could not reach the database |
| `selfTest_rmTemplate1` | server | not run | 4.0s | could not reach the database |
| `selfTest_routeAwareness` | server | not run | 3.9s | could not reach the database |
| `selfTest_rowAnatomy` | server | not run | 4.2s | could not reach the database |
| `selfTest_servicePlans` | server | not run | 3.9s | could not reach the database |
| `selfTest_settingsSweep` | server | not run | 4.1s | could not reach the database |
| `selfTest_ssoSignIn` | database | not run | 453ms | could not reach the database |
| `selfTest_suggestions1` | server | not run | 4.1s | could not reach the database |
| `selfTest_tablePersistence` | server | not run | 3.8s | could not reach the database |
| `selfTest_tenantIdentity` | server | not run | 4.2s | could not reach the database |
| `selfTest_tenantTemplates1` | server | not run | 4.1s | could not reach the database |
| `selfTest_tenantTemplates2` | server | not run | 4.0s | could not reach the database |
| `selfTest_transcriptInsights` | server | not run | 4.2s | could not reach the database |
| `selfTest_allThemeContrast` | scanner | passed | 625ms |  |
| `selfTest_appShell` | scanner | passed | 1.4s |  |
| `selfTest_auditViewer` | database | passed | 515ms |  |
| `selfTest_designRatchet` | scanner | passed | 561ms |  |
| `selfTest_devToolsShell` | database | passed | 409ms |  |
| `selfTest_helpTips` | scanner | passed | 1.7s |  |
| `selfTest_holidayMark` | scanner | passed | 1.7s |  |
| `selfTest_learningCenter3` | database | passed | 822ms |  |
| `selfTest_motionPolish` | scanner | passed | 1.5s |  |
| `selfTest_permissionsRegroup` | scanner | passed | 406ms |  |
| `selfTest_suiteWaits` | scanner | passed | 388ms |  |
| `selfTest_tenantsTableUi` | scanner | passed | 271ms |  |
| `selfTest_widgetChrome` | scanner | passed | 2.5s |  |

## Triage — the ones that did not pass, grouped by likely cause

These groupings are a **judgement about cause, not a diagnosis**, and nothing here has been repaired. A suite that fails because an approved change moved a string it was pinned to needs a completely different decision from one that fails because the product is actually broken, which is exactly why they are separated before anyone touches either.

### Pins a string that a later batch deliberately changed — 0

_None._

### Asserts behaviour that appears genuinely broken — 0

_None._

### Could not run at all — 48

- `selfTest_fullscreenPresence` — could not reach the database
- `selfTest_builderRework` — could not reach the database
- `selfTest_builderDashboards` — could not reach the database
- `selfTest_iconLibrary` — could not reach the database
- `selfTest_builderViewsPipelines` — could not reach the database
- `selfTest_builderModulesFields` — could not reach the database
- `selfTest_foodServiceTemplate` — could not reach the database
- `selfTest_perModulePerms` — could not reach the database
- `selfTest_mfa` — could not reach the database
- `selfTest_ssoSignIn` — could not reach the database
- `selfTest_presence` — could not reach the database
- `selfTest_aiReceptionistTemplate` — could not reach the database
- `selfTest_devToolsTabs` — could not reach the database
- `selfTest_tenantIdentity` — could not reach the database
- `selfTest_rowAnatomy` — could not reach the database
- `selfTest_hubPolish3` — could not reach the database
- `selfTest_settingsSweep` — could not reach the database
- `selfTest_routeAwareness` — could not reach the database
- `selfTest_servicePlans` — could not reach the database
- `selfTest_adaptationCounters` — could not reach the database
- `selfTest_transcriptInsights` — could not reach the database
- `selfTest_suggestions1` — could not reach the database
- `selfTest_notifications1` — could not reach the database
- `selfTest_globalSearchB` — could not reach the database
- `selfTest_globalSearchA` — could not reach the database
- `selfTest_demoTooling` — could not reach the database
- `selfTest_tablePersistence` — could not reach the database
- `selfTest_hubPolish` — could not reach the database
- `selfTest_demoTenantSafety` — could not reach the database
- `selfTest_notifUiFit` — could not reach the database
- `selfTest_bellOrganic` — could not reach the database
- `selfTest_demoSeeder` — could not reach the database
- `selfTest_hubUiConsistency` — could not reach the database
- `selfTest_lcRecruitment` — could not reach the database
- `selfTest_rmContentPack` — could not reach the database
- `selfTest_multiVisitCardFix` — could not reach the database
- `selfTest_rmTemplate1` — could not reach the database
- `selfTest_lcFieldServices` — could not reach the database
- `selfTest_createUi2` — could not reach the database
- `selfTest_tenantTemplates2` — could not reach the database
- `selfTest_tenantTemplates1` — could not reach the database
- `selfTest_aiSchedulingTarget` — could not reach the database
- `selfTest_aiIntake` — could not reach the database
- `selfTest_linkConventions` — could not reach the database
- `selfTest_priceBook` — could not reach the database
- `selfTest_domSmoke` — could not reach the database
- `selfTest_listpageIntegrity` — could not reach the database
- `selfTest_fsPunchlist1` — could not reach the database

### Red, cause not yet determined — 7

- `selfTest_recurringWork` — PrismaClientInitializationError:
- `selfTest_estimates` — PrismaClientInitializationError:
- `selfTest_fileStorage` — PrismaClientInitializationError:
- `selfTest_customerComms` — PrismaClientInitializationError:
- `selfTest_workOrders1` — PrismaClientInitializationError:
- `selfTest_schedulingCalendar` — PrismaClientInitializationError:
- `selfTest_runnerHarness` — it names 68 suites (47 inherited from the hand-maintained block, plus the runner harness, selfTest_devToolsTabs and selfTest_widgetChrome)
