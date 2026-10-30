/**
 * Canonical English message catalog.
 *
 * The key set defined here is the single source of truth: every other locale
 * is typed `Record<MessageKey, string>`, so TypeScript rejects a translation
 * file with a missing or extra key. Values must stay byte-identical to the
 * strings that used to live inline in the components — existing tests assert
 * them verbatim (em dash —, ellipsis …, and interpunct · included), so copy
 * from source, never retype.
 *
 * Naming: camelCase keys grouped by domain prefix
 * (`settings.section.appearance.label`, `registry.audioControl.mute`, …).
 */
export const en = {
  // -- shared ----------------------------------------------------------------
  "common.yes": "Yes",
  "common.no": "No",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.dismiss": "Dismiss",
  "common.publish": "Publish",

  // -- settings workspace chrome ---------------------------------------------
  "settings.workspace.title": "Settings",
  "settings.workspace.subtitle":
    "Draft, preview, publish, history, and rollback for the local Muses runtime.",
  "settings.workspace.unsavedEdits": "Unsaved local edits",
  "settings.workspace.draftSaved": "Draft saved on server",
  "settings.workspace.loading": "Loading settings…",
  "settings.workspace.unavailable": "Settings unavailable",
  "settings.workspace.versionsAria": "Settings versions",
  "settings.workspace.draftBadge": "Draft — not active",
  "settings.workspace.revisionLabel": "revision {revision}",
  "settings.workspace.publishedBadge": "Published — active",
  "settings.workspace.errorTitle": "Settings operation failed",
  "settings.workspace.dismissNoticeAria": "Dismiss notice",
  "settings.workspace.navigationAria": "Settings categories",
  "settings.workspace.draftActionsAria": "Draft actions",
  "settings.workspace.saving": "Saving…",
  "settings.workspace.saveDraft": "Save draft",
  "settings.workspace.generating": "Generating…",
  "settings.workspace.previewDraft": "Preview draft",
  "settings.workspace.saveBeforePreviewTitle": "Save the draft before preview.",
  "settings.workspace.savePreviewFirstTitle":
    "Save the draft and preview it before publishing.",
  "settings.workspace.preflightNotice":
    "Client preflight found blocking issues. The server remains authoritative and was not called.",
  "settings.workspace.draftSavedNotice":
    "Draft revision {revision} saved on the local server.",
  "settings.workspace.saveReason": "Settings workspace edit to {section}",
  "settings.workspace.publishedNotice":
    "Published. The new release is now the active runtime.",
  "settings.workspace.rollbackReason": "Roll back to r{releaseNumber}",
  "settings.workspace.rolledBackNotice":
    "Rolled back to r{releaseNumber} as a new release. History is unchanged.",
  "settings.workspace.reloadedNotice":
    "Reloaded the server draft. Local unsaved changes were discarded.",
  "settings.workspace.readinessTitle": "Release readiness",
  "settings.workspace.readinessDescription":
    "Publishing requires a saved draft with a current server preview.",
  "settings.workspace.readinessSavedDraft": "Saved draft",
  "settings.workspace.readinessPreviewCurrent": "Preview current",
  "settings.workspace.readinessChanges": "Changes vs published",
  "settings.workspace.readinessUnknown": "Unknown",
  "settings.workspace.readinessPublishReady": "Publish ready",
  "settings.workspace.serverUnreachable":
    "The local settings server could not be reached.",
  "settings.workspace.previewNoChanges":
    "No changes against the published release.",
  "settings.workspace.previewChangesSummary":
    "{count} change(s) across {sections}.",

  // -- settings sections (navigation cards) -----------------------------------
  "settings.section.appearance.label": "Appearance",
  "settings.section.appearance.description": "Theme, density, motion",
  "settings.section.belief.label": "Belief",
  "settings.section.belief.description": "Confidence and staleness",
  "settings.section.decision.label": "Decision",
  "settings.section.decision.description": "Cooldown and quiet hours",
  "settings.section.signals.label": "Signals",
  "settings.section.signals.description": "Sources and weights",
  "settings.section.audio.label": "Audio",
  "settings.section.audio.description": "Profiles and gain limits",
  "settings.section.privacy.label": "Privacy",
  "settings.section.privacy.description": "Retention and exclusions",
  "settings.section.llm.label": "AI narration",
  "settings.section.llm.description": "Optional display enhancement",
  "settings.section.surface.label": "Dashboard",
  "settings.section.surface.description": "Widgets and order",

  // -- appearance editor -------------------------------------------------------
  "settings.editor.appearance.title": "Appearance",
  "settings.editor.appearance.description":
    "Presentation of the local shell. Server-authoritative like every other section — publishing is what makes a change active.",
  "settings.editor.appearance.productName": "Product name",
  "settings.editor.appearance.productNameHelp": "Shown in the shell masthead.",
  "settings.editor.appearance.theme": "Theme",
  "settings.editor.appearance.themeSystem": "Follow system",
  "settings.editor.appearance.themeLight": "Light",
  "settings.editor.appearance.themeDark": "Dark",
  "settings.editor.appearance.accentColor": "Accent colour",
  "settings.editor.appearance.accentHelp":
    "Six-digit hex, for example #6c8cff.",
  "settings.editor.appearance.density": "Density",
  "settings.editor.appearance.densityComfortable": "Comfortable",
  "settings.editor.appearance.densityCompact": "Compact",
  "settings.editor.appearance.reducedMotion": "Reduce non-essential motion",
  "settings.editor.appearance.language": "Language",

  // -- belief editor -----------------------------------------------------------
  "settings.editor.belief.title": "Belief",
  "settings.editor.belief.description":
    "Thresholds the deterministic projector must clear before a state is considered known. UNKNOWN stays a first-class outcome.",
  "settings.editor.belief.minimumConfidence": "Minimum confidence",
  "settings.editor.belief.minimumConfidenceHelp":
    "Below this the decision engine returns NO_ACTION.",
  "settings.editor.belief.minimumMargin": "Minimum margin",
  "settings.editor.belief.minimumMarginHelp":
    "Separation the leading state needs over its challenger.",
  "settings.editor.belief.stabilityWindow": "Stability window (ms)",
  "settings.editor.belief.stabilityWindowHelp":
    "A belief older than this window is treated as stale.",
  "settings.editor.belief.note":
    "The state vocabulary is fixed at {states} and the unknown state is always UNKNOWN. Both are structural and cannot be edited.",

  // -- decision editor ---------------------------------------------------------
  "settings.editor.decision.title": "Decision",
  "settings.editor.decision.description":
    "When automation may act. Only reversible audio adjustments can execute; manual input always wins.",
  "settings.editor.decision.cooldown": "Manual override cooldown (ms)",
  "settings.editor.decision.cooldownHelp":
    "After a manual audio change, automation stands down for this long.",
  "settings.editor.decision.undoWindow": "Manual undo window (ms)",
  "settings.editor.decision.undoWindowHelp":
    "How long an applied effect stays revertible.",
  "settings.editor.decision.quietHours": "Enable quiet hours",
  "settings.editor.decision.quietFrom": "Quiet from",
  "settings.editor.decision.quietUntil": "Quiet until",
  "settings.editor.decision.note":
    "Quiet hours use the local clock and may wrap past midnight. While quiet, the engine returns NO_ACTION with reason QUIET_HOURS. Unknown and low-confidence beliefs always resolve to NO_ACTION, and effects are always reversible — these are structural and cannot be edited.",

  // -- signals editor ----------------------------------------------------------
  "settings.editor.signals.title": "Signals",
  "settings.editor.signals.description":
    "Signal enablement, weights and raw-payload switches are not enforced yet and cannot be changed in this beta.",
  "settings.editor.signals.ideActivity": "IDE activity",
  "settings.editor.signals.gitActivity": "Git activity",
  "settings.editor.signals.appFocus": "Application focus",
  "settings.editor.signals.terminalActivity": "Terminal activity",
  "settings.editor.signals.manualFeedback": "Manual feedback",
  "settings.editor.signals.enabled": "Enabled",
  "settings.editor.signals.retainRaw": "Retain raw payload",
  "settings.editor.signals.weight": "Weight",

  // -- audio editor ------------------------------------------------------------
  "settings.editor.audio.title": "Audio",
  "settings.editor.audio.description":
    "The only executor allowed to act automatically. Every change is gain-ramped and reversible.",
  "settings.editor.audio.allowAutomatic": "Allow automatic audio adjustment",
  "settings.editor.audio.masterGain": "Master gain ceiling",
  "settings.editor.audio.masterGainHelp":
    "Hard upper bound; per-state gains are clamped to it.",
  "settings.editor.audio.soundscape": "Soundscape",
  "settings.editor.audio.targetGain": "Target gain",
  "settings.editor.audio.ramp": "Ramp (ms)",
  "settings.editor.audio.unknownNote":
    "UNKNOWN must stay silent: empty soundscape and zero gain.",

  // -- llm editor --------------------------------------------------------------
  "settings.editor.llm.title": "AI narration",
  "settings.editor.llm.description":
    "An optional display enhancement. Everything else in Muses works exactly the same with it off.",
  "settings.editor.llm.enable": "Enable AI narration (optional)",
  "settings.editor.llm.enableHelp":
    "Off by default. The app is fully functional without it.",
  "settings.editor.llm.model": "Model alias",
  "settings.editor.llm.modelHelp":
    "`auto` lets the gateway pick the model per request — it may differ each time.",
  "settings.editor.llm.note":
    "Gateway address and credentials come from the deployment environment and are never stored in settings. Generated text is display-only.",

  // -- privacy editor ----------------------------------------------------------
  "settings.editor.privacy.title": "Privacy",
  "settings.editor.privacy.description":
    "Retention applies to new raw events. Session-history retention, application exclusions and screen capture controls are not implemented in this beta.",
  "settings.editor.privacy.rawEventRetention": "Raw event retention (hours)",
  "settings.editor.privacy.rawEventRetentionHelp":
    "Published changes affect new events only. Zero disables ingestion. Expired managed events are removed in batches; legacy data, backups and SQLite free space are not erased. Expired rows still in the database can be read through historical API queries; retention is not access control.",
  "settings.editor.privacy.sessionHistoryRetention":
    "Session history retention (days)",
  "settings.editor.privacy.captureScreenContent": "Capture screen content",
  "settings.editor.privacy.excludedApplications": "Excluded applications",
  "settings.editor.privacy.excludedApplicationsHelp":
    "One bundle id or stable application identifier per line.",

  // -- dashboard (surface) editor ----------------------------------------------
  "settings.editor.surface.title": "Dashboard components",
  "settings.editor.surface.description":
    "Only the eight static component schemas are accepted. No HTML, JavaScript, or dynamic imports.",
  "settings.editor.surface.componentType": "Component type",
  "settings.editor.surface.addComponent": "Add component",
  "settings.editor.surface.empty":
    "No dashboard components. Publishing an empty surface leaves the Observatory with nothing to render.",
  "settings.editor.surface.orderAria": "Dashboard component order",
  "settings.editor.surface.componentAria": "{label} component {index}",
  "settings.editor.surface.moveUp": "Move up",
  "settings.editor.surface.moveDown": "Move down",
  "settings.editor.surface.remove": "Remove",
  "settings.editor.surface.removeAria": "Remove {label}",
  "settings.editor.surface.stableId": "Stable id",
  "settings.editor.surface.stableIdHelp":
    "Letters, digits, dot, colon, underscore, or hyphen.",
  "settings.editor.surface.showConfidence": "Show confidence",
  "settings.editor.surface.showUnknownReason": "Show unknown reason",
  "settings.editor.surface.maxStates": "Max states",
  "settings.editor.surface.showFactorContributions":
    "Show factor contributions",
  "settings.editor.surface.limit": "Limit",
  "settings.editor.surface.showSource": "Show source",
  "settings.editor.surface.showPayloadSummary": "Show payload summary",
  "settings.editor.surface.showNoAction": "Show NO_ACTION decisions",
  "settings.editor.surface.showUndoAvailability": "Show undo availability",
  "settings.editor.surface.allowManualOverride": "Allow manual override",
  "settings.editor.surface.showMasterVolume": "Show master volume",
  "settings.editor.surface.metrics": "Metrics",
  "settings.editor.surface.showRetention": "Show retention",
  "settings.editor.surface.showExcludedApplications":
    "Show excluded applications",
  "settings.editor.surface.showModelAttribution": "Show model attribution",

  // -- widget definitions (surface editor pick list + preview) ------------------
  "settings.widget.stateHero.label": "State hero",
  "settings.widget.stateHero.description":
    "Current belief state, confidence, and unknown reason.",
  "settings.widget.beliefDistribution.label": "Belief distribution",
  "settings.widget.beliefDistribution.description":
    "Probability across candidate states with factor weights.",
  "settings.widget.evidenceList.label": "Evidence list",
  "settings.widget.evidenceList.description":
    "Events that moved the current belief, newest first.",
  "settings.widget.eventsTimeline.label": "Events timeline",
  "settings.widget.eventsTimeline.description":
    "Raw ingested context events in arrival order.",
  "settings.widget.decisionCard.label": "Decision card",
  "settings.widget.decisionCard.description":
    "The active policy decision and why it was chosen.",
  "settings.widget.audioControl.label": "Audio control",
  "settings.widget.audioControl.description":
    "Soundscape transport, profile, and manual override.",
  "settings.widget.metricsGrid.label": "Metrics grid",
  "settings.widget.metricsGrid.description":
    "Rolling counters for belief and effect health.",
  "settings.widget.privacyStatus.label": "Privacy status",
  "settings.widget.privacyStatus.description":
    "Local-only posture, retention, and exclusions.",
  "settings.widget.llmNarration.label": "AI narration",
  "settings.widget.llmNarration.description":
    "Optional, user-triggered plain-text explanation panel.",

  // -- preview panel -------------------------------------------------------------
  "settings.preview.draftBadge": "Draft preview — not active",
  "settings.preview.title": "Preview against r{releaseNumber}",
  "settings.preview.body":
    "The published release remains r{releaseNumber}. Preview is resolved by the local server and executes no effects.",
  "settings.preview.close": "Close preview",
  "settings.preview.validationPassed":
    "Server validation passed for this document.",
  "settings.preview.changedPaths": "Changed paths ({count})",
  "settings.preview.identical":
    "This document is identical to the published release. Publishing would create a release with no functional change.",

  // -- release history -----------------------------------------------------------
  "settings.release.title": "Release history",
  "settings.release.description":
    "Immutable publication records from the local settings server.",
  "settings.release.empty": "No published releases are available.",
  "settings.release.published": "Published",
  "settings.release.rollbackBadge": "Rollback",
  "settings.release.publishedBy": "Published by {actor}",
  "settings.release.current": "Current release",
  "settings.release.rollBackToThis": "Roll back to this release",

  // -- publish dialog --------------------------------------------------------------
  "settings.dialog.publish.defaultSummary": "Publish reviewed settings draft",
  "settings.dialog.publish.title": "Publish settings draft",
  "settings.dialog.publish.description":
    "Publishing replaces the active server-authoritative settings. The previous release remains available for rollback.",
  "settings.dialog.publish.summaryLabel": "Release summary",
  "settings.dialog.publish.acknowledge":
    "I reviewed the draft preview and understand that publishing changes the active settings.",
  "settings.dialog.publish.publishing": "Publishing…",

  // -- rollback dialog --------------------------------------------------------------
  "settings.dialog.rollback.title": "Roll back published settings",
  "settings.dialog.rollback.body":
    "This creates a new release from r{releaseNumber}. It does not delete history.",
  "settings.dialog.rollback.warning":
    "The currently active settings will be replaced. Type ROLLBACK to continue.",
  "settings.dialog.rollback.phraseLabel": "Confirmation phrase",
  "settings.dialog.rollback.rollingBack": "Rolling back…",
  "settings.dialog.rollback.rollBack": "Roll back",

  // -- conflict dialog ----------------------------------------------------------------
  "settings.dialog.conflict.title": "Settings changed on the server",
  "settings.dialog.conflict.body":
    "The server rejected the write on {field}: it expected {expected} but holds {actual}. Nothing was overwritten.",
  "settings.dialog.conflict.reloadTitle": "Reload from server",
  "settings.dialog.conflict.reloadDescription":
    "Discard local unsaved changes and load the current server-authoritative draft and release.",
  "settings.dialog.conflict.keepTitle": "Keep editing",
  "settings.dialog.conflict.keepDescription":
    "Leave local edits in place. Saving will fail again until the draft is reloaded.",

  // -- dashboard shell ------------------------------------------------------------------
  "dashboard.skipLink": "Skip to Observatory content",
  "dashboard.eyebrow": "Muses · local Observatory",
  "dashboard.guideLink": "User guide",
  "dashboard.title": "Context, belief, and reversible action",
  "dashboard.lede":
    "A server-authoritative view of what Muses observed, why its belief changed, and whether it chose to act.",
  "dashboard.localBadgeAria": "Local-only runtime",
  "dashboard.localBadge": "Local runtime",
  "dashboard.primaryRegionAria": "Current Observatory state",
  "dashboard.noComponents":
    "The published dashboard has no components for this region. Add one in Settings and publish to see it here.",
  "dashboard.eventStreamEyebrow": "Server event stream",
  "dashboard.recentEvents": "Recent context events",
  "dashboard.loadedCount": "{count} loaded",
  "dashboard.loadingOlderEvents": "Loading older events…",
  "dashboard.loadOlderEvents": "Load older events",
  "dashboard.allEventsLoaded": "All available events loaded",
  "dashboard.noEventsAvailable": "No events available",
  "dashboard.railAria": "Controls, metrics, and privacy",
  "dashboard.audioPromptAria": "Pending audio intervention",
  "dashboard.audioPromptTitle": "当前声音建议待开启",
  "dashboard.audioPromptBody": "仅在本页启用，可随时暂停。",
  "dashboard.audioPromptStart": "开启本次会话声音",
  "dashboard.audioPromptPause": "立即暂停声音",
  "dashboard.audioPromptDismiss": "关闭提示",

  // -- dashboard toolbar ------------------------------------------------------------------
  "dashboard.toolbar.aria": "Dashboard refresh controls",
  "dashboard.toolbar.liveRefresh": "Live refresh",
  "dashboard.toolbar.interval": "Interval",
  "dashboard.toolbar.refreshingState": "Refreshing local state…",
  "dashboard.toolbar.lastRefresh": "Last refresh {time}",
  "dashboard.toolbar.notYetRefreshed": "Not yet refreshed",
  "dashboard.toolbar.refreshTimeUnavailable": "Refresh time unavailable",
  "dashboard.toolbar.refreshing": "Refreshing…",
  "dashboard.toolbar.refreshNow": "Refresh now",

  // -- dashboard states ---------------------------------------------------------------------
  "dashboard.states.skeletonAria": "Loading Observatory dashboard",
  "dashboard.states.skeletonSr": "Loading local Observatory state.",
  "dashboard.states.disconnectedTitle": "Local server disconnected",
  "dashboard.states.errorTitle": "Observatory could not load",
  "dashboard.states.disconnectedDetail":
    "The dashboard cannot reach the local Fastify service. Existing server state has not been replaced with browser-only data.",
  "dashboard.states.unreadableDetail":
    "The local server returned an unreadable response.",
  "dashboard.states.connection": "Connection",
  "dashboard.states.serverResponse": "Server response",
  "dashboard.states.retryConnection": "Retry local connection",
  "dashboard.states.emptyEyebrow": "Waiting for evidence",
  "dashboard.states.emptyTitle": "No Observatory state yet",
  "dashboard.states.emptyBody":
    "The local server returned an empty authoritative snapshot. Keep Muses running while events arrive; this page does not create a demo belief or decision.",
  "dashboard.states.staleTitle": "Showing the last server snapshot.",
  "dashboard.states.staleDefault":
    "The snapshot is older than the server freshness window.",
  "dashboard.states.dismissError": "Dismiss error",

  // -- registry slot degraded boundary --------------------------------------------------------
  "dashboard.slot.degradedEyebrow": "Component unavailable",
  "dashboard.slot.degradedBody":
    "This registry component could not render. Other dashboard regions remain available.",

  // -- dashboard surface titles -----------------------------------------------------------------
  "dashboard.surface.state.hero": "Current state",
  "dashboard.surface.belief.distribution": "Belief distribution",
  "dashboard.surface.evidence.list": "Evidence",
  "dashboard.surface.events.timeline": "Event timeline",
  "dashboard.surface.decision.card": "Decision rationale",
  "dashboard.surface.audio.control": "Audio effect",
  "dashboard.surface.metrics.grid": "Metrics",
  "dashboard.surface.privacy.status": "Privacy status",
  "dashboard.surface.llm.narration": "AI narration",

  // -- registry: state hero -----------------------------------------------------------------------
  "registry.stateHero.title": "Current state",
  "registry.stateHero.beliefConfidence": "Belief confidence",
  "registry.stateHero.updated": "Updated {time}",

  // -- registry: belief distribution ----------------------------------------------------------------
  "registry.beliefDistribution.title": "Belief distribution",
  "registry.beliefDistribution.supports": "supports",
  "registry.beliefDistribution.opposes": "opposes",
  "registry.beliefDistribution.neutral": "neutral",
  "registry.beliefDistribution.probabilityAria": "{label} probability",
  "registry.beliefDistribution.evidenceItem": "{count} evidence item",
  "registry.beliefDistribution.evidenceItems": "{count} evidence items",

  // -- registry: evidence list -----------------------------------------------------------------------
  "registry.evidenceList.title": "Evidence",
  "registry.evidenceList.empty": "No verified evidence is available.",

  // -- registry: events timeline -----------------------------------------------------------------------
  "registry.eventsTimeline.title": "Events",
  "registry.eventsTimeline.empty": "No events have been recorded.",

  // -- registry: decision card --------------------------------------------------------------------------
  "registry.decisionCard.title": "Decision",
  "registry.decisionCard.confidence": "Decision confidence",
  "registry.decisionCard.expires": "Expires {time}",
  "registry.decisionCard.undo": "Undo decision",

  // -- registry: audio control ---------------------------------------------------------------------------
  "registry.audioControl.title": "Audio control",
  "registry.audioControl.noTrack": "No track selected",
  "registry.audioControl.playing": "Audio playing",
  "registry.audioControl.paused": "Audio paused",
  "registry.audioControl.volume": "Volume: {percent}%",
  "registry.audioControl.unmute": "Unmute",
  "registry.audioControl.mute": "Mute",

  // -- registry: metrics grid ---------------------------------------------------------------------------
  "registry.metricsGrid.title": "Metrics",
  "registry.metricsGrid.increasing": "Increasing",
  "registry.metricsGrid.decreasing": "Decreasing",
  "registry.metricsGrid.stable": "Stable",
  "registry.metricsGrid.unknownTrend": "Unknown trend",

  // -- registry: privacy status ---------------------------------------------------------------------------
  "registry.privacyStatus.title": "Privacy status",
  "registry.privacyStatus.localOnly": "LOCAL ONLY",
  "registry.privacyStatus.notLocal": "NOT LOCAL",
  "registry.privacyStatus.activeSensors": "Active sensors",
  "registry.privacyStatus.none": "None",
  "registry.privacyStatus.retention": "Retention",
  "registry.privacyStatus.pendingDeletion": "Pending deletion",
  "registry.privacyStatus.lastExport": "Last export",

  // -- registry: llm narration ----------------------------------------------------------------------------
  "registry.llmNarration.title": "AI narration",
  "registry.llmNarration.disclosure":
    "When enabled, this panel sends the current belief summary and event counts — never file contents or paths — to the configured local-network gateway. Output is display-only.",
  "registry.llmNarration.cooldown": "Cooldown",
  "registry.llmNarration.cooldownDetail":
    "Temporarily unavailable — retry shortly.",
  "registry.llmNarration.generating": "Generating…",
  "registry.llmNarration.generatedBy": "Generated by {model} · {time}",
  "registry.llmNarration.unknownModel": "unknown model",
  "registry.llmNarration.unknownTime": "unknown time",
  "registry.llmNarration.explain": "Explain current state",
  "registry.llmNarration.summarize": "Summarize last hour",
  "registry.llmNarration.retry": "Retry",

  // -- registry: safe fallback ------------------------------------------------------------------------------
  "registry.safeFallback.title": "Unavailable component",
  "registry.safeFallback.requested": "Requested: {type}",
  "registry.safeFallback.reason": "Reason: {reason}",
  "registry.safeFallback.dashboardInvalid":
    "The dashboard configuration is invalid and was not rendered.",
  "registry.safeFallback.dashboardSchemaVersion":
    "The dashboard schema version is not supported.",
  "registry.safeFallback.componentUnknownType":
    "This component type is not registered.",
  "registry.safeFallback.componentInvalidProps":
    "This component received invalid configuration.",
  "registry.safeFallback.componentSchemaVersion":
    "This component schema version is not supported.",
  "registry.safeFallback.componentMissingCapability":
    "This component is unavailable because a required local capability is missing.",
  "registry.safeFallback.componentRenderError":
    "This component failed safely and was isolated from the rest of the dashboard.",

  // -- foundation status page ---------------------------------------------------------------------------------
  "foundation.status.eyebrow": "Muses v0.1 · foundation shell",
  "foundation.status.title":
    "Local context runtime, ready for module integration.",
  "foundation.status.lede":
    "This minimal surface verifies the React shell and Fastify local authority. Product modules own all domain behavior and will register through the typed composition hooks.",
  "foundation.status.localAuthority": "Local authority",
  "foundation.status.checking": "Checking loopback health…",
  "foundation.status.authorityUnavailable":
    "The local authority is unavailable.",
  "foundation.status.connected":
    "Connected · version {version} · uptime {seconds}s",
  "foundation.status.notConnected": "Not connected",
  "foundation.status.connectedAria": "Connected",
  "foundation.status.securityNote":
    "Local-only boundary. Loopback binding and origin checks reduce exposure, but this prototype is not an authenticated multi-user production service.",

  // -- root error boundary --------------------------------------------------------------------------------------
  "foundation.errorBoundary.eyebrow": "Local interface error",
  "foundation.errorBoundary.title": "Muses could not render this view.",
  "foundation.errorBoundary.body":
    "No remote report was sent. Retry the local view; persistent failures should be inspected in the local development logs.",
  "foundation.errorBoundary.retry": "Retry view",

  // -- dashboard hooks: user-facing errors -------------------------------------------------------------------------
  "dashboard.errors.manualNeedsEffect":
    "A manual transport command needs an effect from the current snapshot.",
  "dashboard.errors.outcomeDeclined":
    "The local server declined the reported effect outcome.",
  "dashboard.errors.audioCommandFailed":
    "The audio engine could not complete that command.",
  "dashboard.errors.generationFailed": "Generation failed.",

  // -- dashboard API parse errors ------------------------------------------------------------------------------------
  "api.error.expectedString": 'Expected "{key}" to be a string.',
  "api.error.expectedStringWhenPresent":
    'Expected "{key}" to be a string when present.',
  "api.error.expectedFiniteNumber": 'Expected "{key}" to be a finite number.',
  "api.error.expectedBoolean": 'Expected "{key}" to be a boolean.',
  "api.error.expectedObject": 'Expected "{key}" to be an object.',
  "api.error.expectedArrayWhenPresent":
    'Expected "{key}" to be an array when present.',
  "api.error.unsupportedValue": 'Unsupported value for "{key}": {value}',
  "api.error.expectedUnitInterval": 'Expected "{key}" to be between 0 and 1.',
  "api.error.expectedIsoDate":
    'Expected "{key}" to be an ISO date-time string.',
  "api.error.expectedPrivacyObject":
    "Expected privacy payload to be an object.",
  "api.error.privacyNotLocalOnly":
    "Dashboard rejected a privacy payload that is not strictly local-only or reports cloud/API-key capability.",
  "api.error.expectedCapabilityObject":
    "Expected each privacy capability to be an object.",
  "api.error.expectedStringArray":
    'Expected "{key}" to be an array of strings.',
  "api.error.expectedStringArrayEntries":
    'Expected "{key}" entries to be strings.',
  "api.error.expectedEvidenceObject":
    "Expected each belief evidence entry to be an object.",
  "api.error.expectedFactorObject":
    "Expected each belief factor to be an object.",
  "api.error.expectedBeliefObject": "Expected belief snapshot to be an object.",
  "api.error.expectedDecisionFactorObject":
    "Expected each decision factor to be an object.",
  "api.error.expectedDecisionObject": "Expected decision to be an object.",
  "api.error.expectedEffectObjectOrNull":
    'Expected "effect" to be an object or null.',
  "api.error.expectedOutcomeObject": "Expected effect outcome to be an object.",
  "api.error.unsupportedOutcomeStatus": "Unsupported outcome status: {status}",
  "api.error.expectedLedgerObject":
    "Expected effect ledger entry to be an object.",
  "api.error.expectedSettingsObject":
    "Expected settings response to be an object.",
  "api.error.expectedCurrentRelease":
    'Expected "currentRelease" to be an object or null.',
  "api.error.expectedCurrentReleaseDocument":
    'Expected "currentRelease.document" to be an object.',
  "api.error.expectedAudioPrivacyObjects":
    "Expected settings document to contain audio and privacy objects.",
  "api.error.expectedContextEventObject":
    "Expected each context event to be an object.",
  "api.error.expectedSnapshotObject":
    "Expected dashboard snapshot to be an object.",
  "api.error.expectedSnapshotKey":
    'Expected dashboard snapshot to include "{key}".',
  "api.error.expectedPrivacyPayloadLocalOnly":
    "Dashboard rejected a privacy payload that is not strictly local-only.",
  "api.error.expectedEventPageObject": "Expected event page to be an object.",
  "api.error.expectedNextCursor":
    'Expected "nextCursor" to be a string, null, or omitted.',
  "api.error.expectedHasMoreBoolean":
    'Expected "hasMore" to be a boolean when present.',
  "api.error.expectedCursorWhenHasMore":
    'Expected a non-null "nextCursor" when "hasMore" is true.',
  "api.error.expectedEventObject": "Expected each event to be an object.",
  "api.error.expectedMetadataJson":
    'Expected event "metadata" to contain JSON-compatible values.',
  "api.error.expectedEffectResultObject":
    "Expected effect command result to be an object.",
  "api.error.unknownEffect": "The local server no longer tracks this effect.",
  "api.error.expectedLlmObject":
    "Expected LLM generation result to be an object.",
  "api.error.expectedModelLength":
    'Expected "model" to be a non-empty string of at most 128 characters.',
  "api.error.expectedBootstrapObject":
    "Expected bootstrap response to be an object.",
  "api.error.invalidJsonDetail": "Server returned invalid JSON: {detail}",
  "api.error.invalidJson": "Server returned invalid JSON.",
  "api.error.requestAborted": "Request was aborted.",
  "api.error.unreachable": "Unable to reach the local Muses server.",
  "api.error.httpStatus": "Local Muses server returned HTTP {status}.",
  "api.error.effectIdRequired":
    "An effect outcome requires an effectId from the current dashboard snapshot.",
  "api.error.unknownDashboardError": "Unknown dashboard error.",

  // -- auth (sign-in / registration / user admin) -----------------------------

  "auth.gate.checking": "Checking your session…",
  "auth.session.signOut": "Sign out",
  "auth.session.adminLink": "User admin",
  "auth.session.settingsLink": "Settings",
  "auth.error.network": "The Muses server could not be reached.",
  "auth.error.sessionExpired": "Your session has expired — sign in again.",

  // -- login --------------------------------------------------------------------
  "auth.login.title": "Sign in",
  "auth.login.subtitle": "Use your Muses account email and password.",
  "auth.login.emailLabel": "Email",
  "auth.login.passwordLabel": "Password",
  "auth.login.submit": "Sign in",
  "auth.login.submitting": "Signing in…",
  "auth.login.toRegister": "No account yet? Create one",

  // -- registration ---------------------------------------------------------------
  "auth.register.title": "Create your account",
  "auth.register.subtitle":
    "We email you a verification code, then you set a password.",
  "auth.register.stepsAria": "Registration steps",
  "auth.register.stepEmail": "Email",
  "auth.register.stepVerify": "Verify",
  "auth.register.stepDone": "Done",
  "auth.register.emailLabel": "Email",
  "auth.register.emailPlaceholder": "you@example.com",
  "auth.register.sendCode": "Send code",
  "auth.register.sending": "Sending…",
  "auth.register.invalidEmail": "Enter a valid email address.",
  "auth.register.changeEmail": "Change email",
  "auth.register.codeLabel": "Verification code",
  "auth.register.codePlaceholder": "6-digit code",
  "auth.register.codeSent": "Code sent — check your inbox.",
  "auth.register.devCode": "Development code: {code}",
  "auth.register.resend": "Resend code",
  "auth.register.resendIn": "Resend in {seconds}s",
  "auth.register.codeRequired": "Enter the verification code from your email.",
  "auth.register.passwordLabel": "Password",
  "auth.register.passwordHint": "At least 6 characters.",
  "auth.register.passwordTooShort": "Passwords need at least 6 characters.",
  "auth.register.displayNameLabel": "Display name (optional)",
  "auth.register.displayNamePlaceholder": "Defaults to your email prefix",
  "auth.register.submit": "Create account",
  "auth.register.submitting": "Creating…",
  "auth.register.doneTitle": "Account created",
  "auth.register.doneBody": "Welcome, {name} — you are signed in.",
  "auth.register.continue": "Continue",
  "auth.register.toLogin": "Already have an account? Sign in",

  // -- user administration ----------------------------------------------------------
  "auth.admin.title": "User administration",
  "auth.admin.subtitle": "Local accounts: activate, deactivate, and remove.",
  "auth.admin.loading": "Loading users…",
  "auth.admin.loadFailed": "Failed to load users.",
  "auth.admin.actionFailed": "The user action failed.",
  "auth.admin.empty": "No users yet.",
  "auth.admin.statsTotal": "Users",
  "auth.admin.statsAdmins": "Admins",
  "auth.admin.statsDisabled": "Disabled",
  "auth.admin.colUser": "User",
  "auth.admin.colRole": "Role",
  "auth.admin.colStatus": "Status",
  "auth.admin.colCreatedAt": "Created",
  "auth.admin.colActions": "Actions",
  "auth.admin.roleAdmin": "Admin",
  "auth.admin.roleUser": "User",
  "auth.admin.active": "Active",
  "auth.admin.disabled": "Disabled",
  "auth.admin.activate": "Activate",
  "auth.admin.deactivate": "Deactivate",
  "auth.admin.delete": "Delete",
  "auth.admin.confirmDelete": "Confirm delete",
  "auth.admin.processing": "Working…",
  "auth.admin.selfProtected": "You cannot modify your own account here.",
  "auth.admin.deniedTitle": "Admins only",
  "auth.admin.deniedBody":
    "Sign in with an administrator account to manage users.",

  // -- v0.7 self-track player (batch 1, C path) ---------------------------
  "player.title": "Self-track",
  "player.subtitle": "Your state, scored by the Vibe Signal.",
  "player.state.idle": "Idle",
  "player.state.playing": "Playing",
  "player.state.crossfading": "Crossfading",
  "player.state.ended": "Ended",
  "player.control.start": "Start",
  "player.control.stop": "Stop",
  "player.control.skip": "Skip",
  "player.nowPlaying.label": "Now playing",
  "player.attribution.label": "License",
  "player.plan.localStubNotice":
    "Local plan — the server playback plan API is not wired yet.",

  // -- v0.7 vibe signature (batch 1, C path) ------------------------------
  "signature.title": "Vibe Signature",
  "signature.subtitle":
    "How your states map onto music. v0 uses templates and manual tuning.",
  "signature.template.minimalElectronic.name": "Minimal electronic",
  "signature.template.minimalElectronic.description":
    "Steady pulses for deep focus. ~118–138 BPM, capped energy, sparse vocals.",
  "signature.template.ambient.name": "Ambient",
  "signature.template.ambient.description":
    "Textural pads for calm and recovery. ~60–80 BPM, low energy, no vocals.",
  "signature.template.lofiJazz.name": "Lo-fi jazz",
  "signature.template.lofiJazz.description":
    "Dusty chords for unhurried work. ~70–90 BPM, medium energy, light vocals.",
  "signature.calibration.bpmMin.label": "BPM lower bound",
  "signature.calibration.bpmMax.label": "BPM upper bound",
  "signature.calibration.energyCap.label": "Energy cap",
  "signature.calibration.vocalDensity.label": "Vocal density",
  "signature.calibration.vocalDensity.none": "None",
  "signature.calibration.vocalDensity.low": "Low",
  "signature.calibration.vocalDensity.medium": "Medium",
  "signature.calibration.vocalDensity.high": "High",
  "signature.calibration.error.bpmRange":
    "BPM bounds must satisfy 40 ≤ lower < upper ≤ 200.",
  "signature.summary.heading": "Effective signature",
  "signature.summary.bpm": "BPM window",
  "signature.summary.energyCap": "Energy cap",
  "signature.summary.vocalDensity": "Vocal density",
  "signature.journal.notice":
    "Skips and replays are recorded but not used for learning yet.",

  // -- v0.7 journey replay (batch 2, D path) ------------------------------
  "replay.title": "Replay",
  "replay.subtitle": "Your day as a timeline — scrub to relive each state.",
  "replay.loading": "Loading journeys…",
  "replay.empty": "No journeys recorded yet.",
  "replay.error": "Replay unavailable:",
} as const;

export type MessageKey = keyof typeof en;
