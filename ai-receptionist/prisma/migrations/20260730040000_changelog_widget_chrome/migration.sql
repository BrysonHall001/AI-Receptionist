-- Changelog: widget chrome + theme-driven chart colours
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_widget_chrome_20260730',
  '2026-07-30',
  'Improvement',
  'Two fixes to the charts on Analytics, and the same two on the hub''s Billing and Usage screens, which share the same chart engine. First, widget titles were being cut off - reading as "Requ..." or "Jobs b..." - and the reason was not obvious: the small controls for resizing, duplicating, editing and deleting a widget sat on the same line as the title but were invisible until you hovered over the card. They were taking up the room the title needed while being impossible to see. Those controls have moved to a permanent strip along the bottom edge of each card, on a slightly different shade so it reads as trim rather than content, and the title now has the full width of the card. Titles that fit are shown in full; only genuinely long ones trail off, and they now do so at the card edge. The cards grew by exactly the height of that strip, so the chart inside is the same size it was - the smallest card did not lose any of its chart. Anyone viewing a dashboard without permission to change it sees no strip at all and no wasted space where one would be. Second, charts were always purple regardless of which theme you had chosen, because the ten colours they cycle through were fixed in the code. Each theme now brings its own set of ten chart colours, built from that theme''s own accent colour. Every one of those colours has been checked to be clearly visible against that theme''s panel background and clearly different from the other nine, and that check runs automatically from now on, so a new theme added later cannot quietly ship with unreadable or indistinguishable charts. Chart axis labels and gridlines now follow the theme too; on the darker themes they were previously almost invisible. Nothing about what the charts show or how the controls behave has changed - only where the controls sit and where the colours come from.',
  'batch-widget-chrome-20260730',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
