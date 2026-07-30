# Self-test inventory

Run started **2026-07-30 12:38 UTC** — mode `all`.

One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.

## Summary

| result | count | what it means |
| --- | --- | --- |
| Passed | 254 | every assertion in the suite held |
| Failed | 47 | the suite ran and at least one assertion did not hold |
| Timed out | 0 | no result within 120s — not the same thing as failing |
| Not run | 0 | never started; the reason is on the row |
| **Total recorded** | **301** | of 301 suites |

Measured time across the recorded suites: **1050.8s**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.

## Every suite

| suite | lane | result | took | first failing assertion |
| --- | --- | --- | --- | --- |
| `selfTest_adminAuditEvents` | database | **FAILED** | 5.8s | invite accepted (user created) |
| `selfTest_aiResourceBooking` | database | **FAILED** | 2.6s | a second Alice@2pm booking threw (hard-block) |
| `selfTest_appearanceRevisions1` | scanner | **FAILED** | 2.7s | (the use-before-declaration ordering that caused the crash is documented in place) |
| `selfTest_audienceEmails` | database | **FAILED** | 565ms | survey-send reuses the shared picker (pick-mode) |
| `selfTest_auditFixesHealth` | database | **FAILED** | 2.6s | the full sweep completes with 17 shaped checks — Stripe joined in health-v2, Errors in devtools-data (this run: 14 ok / 3 warn / 3 fail) |
| `selfTest_billingHardening` | database | **FAILED** | 657ms |  |
| `selfTest_billingUsageUi` | scanner | **FAILED** | 2.2s | tenant detail has a usage drill-in using the per-tenant endpoint |
| `selfTest_composerR2` | scanner | **FAILED** | 2.5s | checked rows present → only checked from the table source (else all matching) |
| `selfTest_createFlowCleanup` | scanner | **FAILED** | 2.3s | create POST body is { name, notifyEmail, lockedPages } |
| `selfTest_designPhase2` | scanner | **FAILED** | 2.1s | every font-size is var(--text-*) or a named exception (offenders: ["calc(var(--text-xs) - 2px)","22px"]) |
| `selfTest_designPhase9aFlagship` | scanner | **FAILED** | 2.8s | Phase 8's --transition is still the ONLY duration in transition rules |
| `selfTest_designPhase9cAppearance` | scanner | **FAILED** | 2.4s | the carousel's pick() fires the SAME path (centering IS selecting, no apply button) |
| `selfTest_designPolish` | scanner | **FAILED** | 2.8s | every transition rule uses var(--transition) as its only duration (39 rules, offenders: 4) |
| `selfTest_emailDeliverability` | database | **FAILED** | 879ms | app.js ADMIN_NAV includes the Email item |
| `selfTest_featureLcMotion` | database | **FAILED** | 347ms | TypeError: App.visibleRecordTypes is not a function |
| `selfTest_galleryView` | database | **FAILED** | 598ms | renderRecordList registers a gallery view mode (renderRecordGallery) |
| `selfTest_geocodeSweepCalendarTile` | database | **FAILED** | 4.3s | a startup periodic heartbeat (every 2 min) runs processDueJobs |
| `selfTest_googleOAuthLogic` | database | **FAILED** | 2.2s | no write scope in the consent URL |
| `selfTest_impersonationEnforcement` | database | **FAILED** | 526ms | UNEXPECTED ERROR: PrismaClientValidationError: |
| `selfTest_inviteCustomEmail` | scanner | **FAILED** | 2.1s | role dropdown shortened |
| `selfTest_learningCenter2` | scanner | **FAILED** | 2.8s | only shared component classes + the scene/stepper scaffold — UNEXPECTED: cal-res-travel, cal-travel--warn |
| `selfTest_mapView` | database | **FAILED** | 2.4s | renderRecordList registers a map view mode (renderRecordMap) |
| `selfTest_mergeTagsWiring` | scanner | **FAILED** | 2.4s | picker is built from REAL contact field definitions |
| `selfTest_mfFixes` | scanner | **FAILED** | 2.3s | the Board tile's availability is driven by hasPipeline |
| `selfTest_mfLayoutTermsMove` | scanner | **FAILED** | 2.3s | all four availability rules are byte-for-byte intact |
| `selfTest_modulesFieldsReorg` | scanner | **FAILED** | 2.2s | "Fields" tab is now "Modules & Fields" (key still "fields") |
| `selfTest_moduleViews` | scanner | **FAILED** | 1.8s | Bookings expose their typed appointmentAt as a calendar date field |
| `selfTest_moduleViewsDefaults` | database | **FAILED** | 2.3s | generic calendar has no resources/hours (bookings-only chrome) |
| `selfTest_pageLockWiring` | database | **FAILED** | 286ms | tenant detail panel never enters the portal |
| `selfTest_pickModeAudience` | scanner | **FAILED** | 1.9s | tabs hidden in create mode, shown when a survey is open |
| `selfTest_portalTitleLayout` | scanner | **FAILED** | 1.6s | tagline is appended to the sidebar ABOVE the user box (sidebar-tagline) |
| `selfTest_prebuiltModulesUi` | scanner | **FAILED** | 2.3s | Estimates seeds a line_items table + a currency total (auto-computed) |
| `selfTest_recordTypeRegistry` | database | **FAILED** | 596ms | fresh tenant has exactly 11 system record types |
| `selfTest_relabel` | database | **FAILED** | 2.7s | registry has exactly the expected 24 keys |
| `selfTest_relatedTabs` | scanner | **FAILED** | 2.0s | each tab renders a generic module pane |
| `selfTest_relayNoAudioFallback` | server | **FAILED** | 45.8s | greeting text frame sent on setup (no prompt yet) |
| `selfTest_reportBuilderEdit` | database | **FAILED** | 2.5s | TypeError: Cannot set property sendRichEmail of #<Object> which has only a getter |
| `selfTest_scheduledReports` | database | **FAILED** | 545ms | UNEXPECTED ERROR: PrismaClientValidationError: |
| `selfTest_sectionPicker` | database | **FAILED** | 648ms | togglable options derived from the registry include the pre-built modules |
| `selfTest_settingsReorg` | scanner | **FAILED** | 1.9s | single 'Scheduling & Resources' settings tab |
| `selfTest_smsGate` | database | **FAILED** | 2.1s | /api/auth/me payload includes features.smsEnabled |
| `selfTest_surveyNoOverwrite` | database | **FAILED** | 659ms | after a create the builder resets (clears the bound id) |
| `selfTest_surveyResults` | database | **FAILED** | 2.1s | UNEXPECTED ERROR: PrismaClientKnownRequestError: |
| `selfTest_tenantsTable` | scanner | **FAILED** | 2.4s | admin.js has "toast(\"Tenant updated\")" |
| `selfTest_termsClarity` | database | **FAILED** | 502ms | the grid is two columns (Terms moved off Modules & Fields — layout restructure) |
| `selfTest_usageInstrumentation` | database | **FAILED** | 2.3s | Billing & Usage nav hidden from non-OWNER/SUPER_ADMIN |
| `selfTest_wizardTable` | scanner | **FAILED** | 1.0s | Step 3 theme applied on Finish |
| `selfTest_adaptationCounters` | server | passed | 13.4s |  |
| `selfTest_addModule` | database | passed | 2.3s |  |
| `selfTest_aiDegraded` | database | passed | 1.9s |  |
| `selfTest_aiInstructionsSections` | scanner | passed | 1.7s |  |
| `selfTest_aiIntake` | database | passed | 3.8s |  |
| `selfTest_aiSchedulingTarget` | database | passed | 3.7s |  |
| `selfTest_aiToolPlumbing` | database | passed | 2.6s |  |
| `selfTest_allThemeContrast` | scanner | passed | 2.5s |  |
| `selfTest_analyticsRelabel` | scanner | passed | 2.9s |  |
| `selfTest_appointmentToken` | database | passed | 2.6s |  |
| `selfTest_audienceConditionPure` | scanner | passed | 2.3s |  |
| `selfTest_audiences` | database | passed | 2.8s |  |
| `selfTest_audiencesConsume` | database | passed | 2.5s |  |
| `selfTest_audiencesInAutomations` | database | passed | 2.9s |  |
| `selfTest_auditFoundation` | database | passed | 552ms |  |
| `selfTest_auditViewer` | database | passed | 405ms |  |
| `selfTest_autonumberColorProgress` | database | passed | 2.3s |  |
| `selfTest_availabilityResourceScope` | database | passed | 2.1s |  |
| `selfTest_availabilityUnion` | database | passed | 2.6s |  |
| `selfTest_bellOrganic` | server | passed | 13.5s |  |
| `selfTest_billingAutomation` | database | passed | 1.2s |  |
| `selfTest_billingBugfixes` | database | passed | 488ms |  |
| `selfTest_billingCustomWidgets` | database | passed | 506ms |  |
| `selfTest_billingLedgerFoundation` | database | passed | 748ms |  |
| `selfTest_billingPermission` | database | passed | 523ms |  |
| `selfTest_billingPolish` | database | passed | 743ms |  |
| `selfTest_billingSources` | database | passed | 483ms |  |
| `selfTest_bookingConditions` | database | passed | 443ms |  |
| `selfTest_bookingEventHoles` | database | passed | 2.2s |  |
| `selfTest_bookingHarness` | database | passed | 3.1s |  |
| `selfTest_bookingImportApptResource` | database | passed | 2.1s |  |
| `selfTest_bookingLossGuards` | database | passed | 2.4s |  |
| `selfTest_bookingReportDims` | database | passed | 2.2s |  |
| `selfTest_bookingsTimezone` | database | passed | 3.1s |  |
| `selfTest_businessProfile` | scanner | passed | 2.4s |  |
| `selfTest_calendarSyncStatus` | database | passed | 1.9s |  |
| `selfTest_callerId` | database | passed | 699ms |  |
| `selfTest_callerKnowledge` | database | passed | 2.8s |  |
| `selfTest_callExport` | database | passed | 464ms |  |
| `selfTest_callLifecycle` | database | passed | 2.5s |  |
| `selfTest_captureBugfixes` | database | passed | 2.7s |  |
| `selfTest_centralChargesTab` | database | passed | 1.4s |  |
| `selfTest_changelogAnalyticsReports` | scanner | passed | 3.4s |  |
| `selfTest_changelogExplicitDate` | database | passed | 504ms |  |
| `selfTest_changelogLoader` | database | passed | 520ms |  |
| `selfTest_changelogTodayFilter` | scanner | passed | 2.2s |  |
| `selfTest_chargeAuditTrail` | database | passed | 758ms |  |
| `selfTest_chargeExports` | database | passed | 963ms |  |
| `selfTest_chargesGranularity` | database | passed | 683ms |  |
| `selfTest_checkAvailability` | database | passed | 2.7s |  |
| `selfTest_clientBillingPortal` | database | passed | 925ms |  |
| `selfTest_commSettingsFixes` | scanner | passed | 2.2s |  |
| `selfTest_communication` | database | passed | 678ms |  |
| `selfTest_communicationBatch2` | database | passed | 622ms |  |
| `selfTest_communicationTemplates` | database | passed | 536ms |  |
| `selfTest_composer` | scanner | passed | 2.4s |  |
| `selfTest_composeScopeAndCaption` | scanner | passed | 1.8s |  |
| `selfTest_contactsAddressMapboxTile` | database | passed | 2.7s |  |
| `selfTest_contactsAllViews` | database | passed | 2.5s |  |
| `selfTest_contactsMap` | database | passed | 3.3s |  |
| `selfTest_contrastSystemAndPolish` | scanner | passed | 1.7s |  |
| `selfTest_createFlowServer` | database | passed | 658ms |  |
| `selfTest_createTenantChecklist` | database | passed | 695ms |  |
| `selfTest_createUi2` | server | passed | 6.7s |  |
| `selfTest_currencyFileDnd` | scanner | passed | 2.1s |  |
| `selfTest_customerComms` | database | passed | 6.3s |  |
| `selfTest_customRoleImpersonation` | database | passed | 3.2s |  |
| `selfTest_dataAdminFixes` | database | passed | 602ms |  |
| `selfTest_dataAdminHistory` | database | passed | 485ms |  |
| `selfTest_dataBackup` | database | passed | 597ms |  |
| `selfTest_deletedByCapture` | database | passed | 2.4s |  |
| `selfTest_deletedContactsExposeWho` | database | passed | 573ms |  |
| `selfTest_demoPanelScrubbers` | server | passed | 54.4s |  |
| `selfTest_demoSeeder` | server | passed | 26.6s |  |
| `selfTest_demoTenantSafety` | server | passed | 60.0s |  |
| `selfTest_demoTooling` | server | passed | 19.3s |  |
| `selfTest_designMopupDone` | scanner | passed | 2.3s |  |
| `selfTest_designPhase3Settings` | scanner | passed | 2.5s |  |
| `selfTest_designPhase4Records` | scanner | passed | 2.3s |  |
| `selfTest_designPhase5bPortalDone` | scanner | passed | 2.0s |  |
| `selfTest_designPhase5Portal` | scanner | passed | 2.4s |  |
| `selfTest_designPhase6bCommsDone` | scanner | passed | 2.4s |  |
| `selfTest_designPhase6Comms` | scanner | passed | 2.5s |  |
| `selfTest_designPhase7Admin` | scanner | passed | 2.2s |  |
| `selfTest_designPhase7bAutomationsDone` | scanner | passed | 2.2s |  |
| `selfTest_designPhase9b2Sliders` | scanner | passed | 2.8s |  |
| `selfTest_designPhase9bPersonalities` | scanner | passed | 3.0s |  |
| `selfTest_designRatchet` | scanner | passed | 2.6s |  |
| `selfTest_devToolsData` | server | passed | 3.6s |  |
| `selfTest_devToolsShell` | database | passed | 388ms |  |
| `selfTest_domSmoke` | server | passed | 13.6s |  |
| `selfTest_dripBranchCompile` | scanner | passed | 1.9s |  |
| `selfTest_dripCompilerPure` | scanner | passed | 2.2s |  |
| `selfTest_dripEnginePrep` | database | passed | 2.8s |  |
| `selfTest_dripsCompile` | database | passed | 2.9s |  |
| `selfTest_dripsCrud` | database | passed | 583ms |  |
| `selfTest_effectiveDuration` | scanner | passed | 3.1s |  |
| `selfTest_emailSendRecords` | database | passed | 577ms |  |
| `selfTest_equipment` | database | passed | 2.2s |  |
| `selfTest_equipmentReportPresets` | database | passed | 534ms |  |
| `selfTest_estimates` | database | passed | 3.3s |  |
| `selfTest_eventLogFilterExport` | database | passed | 483ms |  |
| `selfTest_exportAttachmentRows` | database | passed | 536ms |  |
| `selfTest_exportRoleGate` | scanner | passed | 3.2s |  |
| `selfTest_externalOwnershipGuard` | database | passed | 2.6s |  |
| `selfTest_externalSyncModel` | database | passed | 2.1s |  |
| `selfTest_feedbackAttachments` | database | passed | 534ms |  |
| `selfTest_feedbackDelete` | database | passed | 627ms |  |
| `selfTest_feedbackExportRows` | database | passed | 512ms |  |
| `selfTest_fieldTypesDnd` | database | passed | 2.4s |  |
| `selfTest_fileStorage` | database | passed | 2.6s |  |
| `selfTest_fillerSequencing` | database | passed | 2.4s |  |
| `selfTest_flowPreview` | scanner | passed | 1.9s |  |
| `selfTest_fsPunchlist1` | database | passed | 3.0s |  |
| `selfTest_funLevelClamp` | scanner | passed | 2.0s |  |
| `selfTest_galleryLeftTabs` | scanner | passed | 1.8s |  |
| `selfTest_geocodeFoundation` | database | passed | 2.5s |  |
| `selfTest_globalSearchA` | server | passed | 9.1s |  |
| `selfTest_globalSearchB` | server | passed | 8.0s |  |
| `selfTest_googleAutoEnable` | database | passed | 2.0s |  |
| `selfTest_googleConnectionStorage` | database | passed | 1.9s |  |
| `selfTest_googleEdgeCases` | database | passed | 2.4s |  |
| `selfTest_googleFreeBusyLogic` | database | passed | 1.9s |  |
| `selfTest_googleMapping` | database | passed | 2.0s |  |
| `selfTest_googlePushDetails` | database | passed | 2.3s |  |
| `selfTest_googlePushOut` | database | passed | 3.1s |  |
| `selfTest_googleScopeDetect` | scanner | passed | 16.7s |  |
| `selfTest_googleStatusDto` | database | passed | 1.9s |  |
| `selfTest_googleSyncConvert` | scanner | passed | 16.5s |  |
| `selfTest_googleSyncEvents` | database | passed | 2.4s |  |
| `selfTest_googleSyncReadIn` | database | passed | 2.4s |  |
| `selfTest_greetingDecoupled` | database | passed | 2.2s |  |
| `selfTest_healthPanelsV3` | database | passed | 957ms |  |
| `selfTest_healthV2` | database | passed | 592ms |  |
| `selfTest_homeDashboardWidget` | database | passed | 545ms |  |
| `selfTest_hoursContext` | database | passed | 2.0s |  |
| `selfTest_hubHistoryPanels` | server | passed | 7.0s |  |
| `selfTest_hubPolish` | server | passed | 16.3s |  |
| `selfTest_hubPolish3` | server | passed | 6.4s |  |
| `selfTest_hubUiConsistency` | server | passed | 10.2s |  |
| `selfTest_impersonationScoping` | database | passed | 3.2s |  |
| `selfTest_importExportHistory` | database | passed | 2.2s |  |
| `selfTest_instructionsDocParse` | scanner | passed | 18.7s |  |
| `selfTest_integrationsPermissions` | database | passed | 3.1s |  |
| `selfTest_integrationsTiles` | scanner | passed | 2.2s |  |
| `selfTest_interruptTranscript` | database | passed | 2.4s |  |
| `selfTest_inviteTokenIntegrity` | database | passed | 747ms |  |
| `selfTest_invoices` | database | passed | 2.4s |  |
| `selfTest_invoicesUi` | database | passed | 260ms |  |
| `selfTest_labelsEditor` | database | passed | 609ms |  |
| `selfTest_layoutHardening` | scanner | passed | 2.7s |  |
| `selfTest_lcFieldServices` | server | passed | 8.5s |  |
| `selfTest_lcRecruitment` | server | passed | 10.8s |  |
| `selfTest_learningCenter1` | scanner | passed | 2.6s |  |
| `selfTest_learningCenter3` | database | passed | 507ms |  |
| `selfTest_lifecycleEvents` | database | passed | 2.3s |  |
| `selfTest_lineItems` | database | passed | 2.5s |  |
| `selfTest_lineItemsUi` | scanner | passed | 2.5s |  |
| `selfTest_linkConventions` | database | passed | 2.6s |  |
| `selfTest_listpageIntegrity` | database | passed | 2.9s |  |
| `selfTest_loopGuard` | database | passed | 2.8s |  |
| `selfTest_masterExports` | database | passed | 624ms |  |
| `selfTest_mergeResolve` | database | passed | 430ms |  |
| `selfTest_mfSpaceLayout` | scanner | passed | 2.5s |  |
| `selfTest_moduleAutomationPresets` | database | passed | 2.3s |  |
| `selfTest_moduleCoverage` | database | passed | 2.5s |  |
| `selfTest_moduleFieldsRefine` | scanner | passed | 2.2s |  |
| `selfTest_moduleListCleanup` | scanner | passed | 3.0s |  |
| `selfTest_moduleReportPresets` | database | passed | 564ms |  |
| `selfTest_modulesPermissionLabel` | scanner | passed | 3.0s |  |
| `selfTest_moduleUiAndCalls` | scanner | passed | 2.4s |  |
| `selfTest_motionBranding` | scanner | passed | 3.2s |  |
| `selfTest_multiVisitCardFix` | server | passed | 9.4s |  |
| `selfTest_navCallsAndLayout` | scanner | passed | 2.5s |  |
| `selfTest_navReconciliation` | database | passed | 473ms |  |
| `selfTest_navRegistry` | scanner | passed | 2.4s |  |
| `selfTest_newFieldTypes` | database | passed | 2.2s |  |
| `selfTest_notifications1` | server | passed | 7.9s |  |
| `selfTest_notifPolish` | server | passed | 20.3s |  |
| `selfTest_notifUiFit` | server | passed | 6.8s |  |
| `selfTest_pageLock` | database | passed | 476ms |  |
| `selfTest_passwordPolicy` | scanner | passed | 2.2s |  |
| `selfTest_permissionsCeiling` | database | passed | 704ms |  |
| `selfTest_permissionsEnforcement` | database | passed | 497ms |  |
| `selfTest_permissionsFoundation` | database | passed | 596ms |  |
| `selfTest_permissionsHonesty` | scanner | passed | 2.3s |  |
| `selfTest_permissionsPortalRoles` | database | passed | 411ms |  |
| `selfTest_permissionsUi` | database | passed | 455ms |  |
| `selfTest_pipelineDefaults` | database | passed | 493ms |  |
| `selfTest_pipelineToggle` | database | passed | 578ms |  |
| `selfTest_portalChromeMenus` | scanner | passed | 2.1s |  |
| `selfTest_portalLayoutSplit` | scanner | passed | 2.0s |  |
| `selfTest_prebuiltModules` | database | passed | 2.3s |  |
| `selfTest_presence` | database | passed | 2.9s |  |
| `selfTest_priceBook` | database | passed | 2.8s |  |
| `selfTest_recordActions` | database | passed | 2.6s |  |
| `selfTest_recordConditions` | database | passed | 2.7s |  |
| `selfTest_recordDateTrigger` | database | passed | 2.2s |  |
| `selfTest_recordImportCoercion` | database | passed | 2.2s |  |
| `selfTest_recordImportStatusSubtype` | database | passed | 2.0s |  |
| `selfTest_recordsRecycleBin` | database | passed | 2.1s |  |
| `selfTest_recurringWork` | database | passed | 3.2s |  |
| `selfTest_relatedTabsLinks` | database | passed | 2.2s |  |
| `selfTest_reportExecutor` | database | passed | 2.6s |  |
| `selfTest_reportHistoryLabel` | scanner | passed | 2.2s |  |
| `selfTest_reportPresetApply` | database | passed | 449ms |  |
| `selfTest_reportPresets` | scanner | passed | 1.5s |  |
| `selfTest_reportPresetsRelabel` | scanner | passed | 2.2s |  |
| `selfTest_reportSchedule` | database | passed | 2.8s |  |
| `selfTest_retiredThemes` | scanner | passed | 2.3s |  |
| `selfTest_rmContentPack` | server | passed | 7.5s |  |
| `selfTest_rmTemplate1` | server | passed | 8.2s |  |
| `selfTest_roleAssignment` | database | passed | 678ms |  |
| `selfTest_roleConsistency` | database | passed | 631ms |  |
| `selfTest_routeAwareness` | server | passed | 5.0s |  |
| `selfTest_rowAnatomy` | server | passed | 6.0s |  |
| `selfTest_runnerHarness` | database | passed | 5.1s |  |
| `selfTest_schedulingCalendar` | database | passed | 3.2s |  |
| `selfTest_servicePlans` | server | passed | 6.1s |  |
| `selfTest_sessionStampsLastLogin` | database | passed | 468ms |  |
| `selfTest_settingsSweep` | server | passed | 10.3s |  |
| `selfTest_settingsTiles` | scanner | passed | 2.0s |  |
| `selfTest_stage3c` | database | passed | 2.3s |  |
| `selfTest_stageAction` | database | passed | 2.9s |  |
| `selfTest_stripeFailuresGolive` | database | passed | 1.2s |  |
| `selfTest_stripeInvoicing` | database | passed | 685ms |  |
| `selfTest_stripePlumbing` | database | passed | 689ms |  |
| `selfTest_stripeWebhooks` | database | passed | 614ms |  |
| `selfTest_suggestions1` | server | passed | 9.7s |  |
| `selfTest_surveyBlast` | database | passed | 2.4s |  |
| `selfTest_surveyMapping` | database | passed | 2.1s |  |
| `selfTest_surveyMappingFix` | database | passed | 2.3s |  |
| `selfTest_surveyResponses` | database | passed | 2.4s |  |
| `selfTest_surveys` | database | passed | 633ms |  |
| `selfTest_symmetricLinks` | database | passed | 2.3s |  |
| `selfTest_tablePersistence` | server | passed | 4.9s |  |
| `selfTest_templateTags` | database | passed | 474ms |  |
| `selfTest_tenantIdentity` | server | passed | 6.7s |  |
| `selfTest_tenantsTableUi` | scanner | passed | 1.9s |  |
| `selfTest_tenantTemplates1` | server | passed | 5.7s |  |
| `selfTest_tenantTemplates2` | server | passed | 7.3s |  |
| `selfTest_tenantTimezone` | database | passed | 2.0s |  |
| `selfTest_termsIconsPolish` | scanner | passed | 2.4s |  |
| `selfTest_themeContrast` | scanner | passed | 2.4s |  |
| `selfTest_themeSceneLegibility` | scanner | passed | 1.9s |  |
| `selfTest_themeTokenRefs` | scanner | passed | 1.9s |  |
| `selfTest_timeDatetimeFields` | database | passed | 2.0s |  |
| `selfTest_timezoneConvert` | scanner | passed | 2.2s |  |
| `selfTest_transcriptInsights` | server | passed | 6.6s |  |
| `selfTest_usageCaptureFix` | database | passed | 2.4s |  |
| `selfTest_usageRollups` | database | passed | 32.7s |  |
| `selfTest_vendoredLibs` | scanner | passed | 1.8s |  |
| `selfTest_visualFixes2` | scanner | passed | 1.7s |  |
| `selfTest_workOrders1` | database | passed | 3.4s |  |

## Triage — the ones that did not pass, grouped by likely cause

These groupings are a **judgement about cause, not a diagnosis**, and nothing here has been repaired. A suite that fails because an approved change moved a string it was pinned to needs a completely different decision from one that fails because the product is actually broken, which is exactly why they are separated before anyone touches either.

### Pins a string that a later batch deliberately changed — 2

- `selfTest_tenantsTable` — admin.js has "toast(\"Tenant updated\")"
- `selfTest_pageLockWiring` — tenant detail panel never enters the portal

### Asserts behaviour that appears genuinely broken — 1

- `selfTest_featureLcMotion` — TypeError: App.visibleRecordTypes is not a function

### Could not run at all — 0

_None._

### Red, cause not yet determined — 44

- `selfTest_billingUsageUi` — tenant detail has a usage drill-in using the per-tenant endpoint
- `selfTest_appearanceRevisions1` — (the use-before-declaration ordering that caused the crash is documented in place)
- `selfTest_composerR2` — checked rows present → only checked from the table source (else all matching)
- `selfTest_createFlowCleanup` — create POST body is { name, notifyEmail, lockedPages }
- `selfTest_designPhase2` — every font-size is var(--text-*) or a named exception (offenders: ["calc(var(--text-xs) - 2px)","22px"])
- `selfTest_designPhase9aFlagship` — Phase 8's --transition is still the ONLY duration in transition rules
- `selfTest_designPhase9cAppearance` — the carousel's pick() fires the SAME path (centering IS selecting, no apply button)
- `selfTest_designPolish` — every transition rule uses var(--transition) as its only duration (39 rules, offenders: 4)
- `selfTest_inviteCustomEmail` — role dropdown shortened
- `selfTest_learningCenter2` — only shared component classes + the scene/stepper scaffold — UNEXPECTED: cal-res-travel, cal-travel--warn
- `selfTest_mergeTagsWiring` — picker is built from REAL contact field definitions
- `selfTest_mfFixes` — the Board tile's availability is driven by hasPipeline
- `selfTest_mfLayoutTermsMove` — all four availability rules are byte-for-byte intact
- `selfTest_moduleViews` — Bookings expose their typed appointmentAt as a calendar date field
- `selfTest_modulesFieldsReorg` — "Fields" tab is now "Modules & Fields" (key still "fields")
- `selfTest_pickModeAudience` — tabs hidden in create mode, shown when a survey is open
- `selfTest_portalTitleLayout` — tagline is appended to the sidebar ABOVE the user box (sidebar-tagline)
- `selfTest_relatedTabs` — each tab renders a generic module pane
- `selfTest_prebuiltModulesUi` — Estimates seeds a line_items table + a currency total (auto-computed)
- `selfTest_settingsReorg` — single 'Scheduling & Resources' settings tab
- `selfTest_wizardTable` — Step 3 theme applied on Finish
- `selfTest_adminAuditEvents` — invite accepted (user created)
- `selfTest_aiResourceBooking` — a second Alice@2pm booking threw (hard-block)
- `selfTest_audienceEmails` — survey-send reuses the shared picker (pick-mode)
- `selfTest_auditFixesHealth` — the full sweep completes with 17 shaped checks — Stripe joined in health-v2, Errors in devtools-data (this run: 14 ok / 3 warn / 3 fail)
- `selfTest_billingHardening` — no detail captured
- `selfTest_emailDeliverability` — app.js ADMIN_NAV includes the Email item
- `selfTest_galleryView` — renderRecordList registers a gallery view mode (renderRecordGallery)
- `selfTest_geocodeSweepCalendarTile` — a startup periodic heartbeat (every 2 min) runs processDueJobs
- `selfTest_googleOAuthLogic` — no write scope in the consent URL
- `selfTest_impersonationEnforcement` — UNEXPECTED ERROR: PrismaClientValidationError:
- `selfTest_mapView` — renderRecordList registers a map view mode (renderRecordMap)
- `selfTest_moduleViewsDefaults` — generic calendar has no resources/hours (bookings-only chrome)
- `selfTest_recordTypeRegistry` — fresh tenant has exactly 11 system record types
- `selfTest_relabel` — registry has exactly the expected 24 keys
- `selfTest_relayNoAudioFallback` — greeting text frame sent on setup (no prompt yet)
- `selfTest_reportBuilderEdit` — TypeError: Cannot set property sendRichEmail of #<Object> which has only a getter
- `selfTest_scheduledReports` — UNEXPECTED ERROR: PrismaClientValidationError:
- `selfTest_sectionPicker` — togglable options derived from the registry include the pre-built modules
- `selfTest_smsGate` — /api/auth/me payload includes features.smsEnabled
- `selfTest_surveyNoOverwrite` — after a create the builder resets (clears the bound id)
- `selfTest_surveyResults` — UNEXPECTED ERROR: PrismaClientKnownRequestError:
- `selfTest_termsClarity` — the grid is two columns (Terms moved off Modules & Fields — layout restructure)
- `selfTest_usageInstrumentation` — Billing & Usage nav hidden from non-OWNER/SUPER_ADMIN
