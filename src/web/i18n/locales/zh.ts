/**
 * 简体中文文案。键集与 en.ts 完全一致（Record<MessageKey, string> 编译期强制）。
 *
 * 术语表：
 *   Muses —— 产品名，不译
 *   Observatory —— 观测台
 *   rollback —— 回滚
 *   publish/release —— 发布/发布版本
 *   draft —— 草稿
 *   belief —— 信念
 *   snapshot —— 快照
 *   soundscape —— 声景
 *   gain —— 增益
 *   widget —— 组件
 *   narration —— 解说
 */
import type { MessageKey } from "./en";

export const zh: Record<MessageKey, string> = {
  // -- shared ----------------------------------------------------------------
  "common.yes": "是",
  "common.no": "否",
  "common.cancel": "取消",
  "common.retry": "重试",
  "common.dismiss": "关闭",
  "common.publish": "发布",

  // -- settings workspace chrome ---------------------------------------------
  "settings.workspace.title": "设置",
  "settings.workspace.subtitle":
    "为本地 Muses 运行时提供草稿、预览、发布、历史与回滚。",
  "settings.workspace.unsavedEdits": "有未保存的本地修改",
  "settings.workspace.draftSaved": "草稿已保存到服务器",
  "settings.workspace.loading": "正在加载设置…",
  "settings.workspace.unavailable": "设置不可用",
  "settings.workspace.versionsAria": "设置版本",
  "settings.workspace.draftBadge": "草稿 — 未生效",
  "settings.workspace.revisionLabel": "修订版本 {revision}",
  "settings.workspace.publishedBadge": "已发布 — 生效中",
  "settings.workspace.errorTitle": "设置操作失败",
  "settings.workspace.dismissNoticeAria": "关闭提示",
  "settings.workspace.navigationAria": "设置分类",
  "settings.workspace.draftActionsAria": "草稿操作",
  "settings.workspace.saving": "正在保存…",
  "settings.workspace.saveDraft": "保存草稿",
  "settings.workspace.generating": "正在生成…",
  "settings.workspace.previewDraft": "预览草稿",
  "settings.workspace.saveBeforePreviewTitle": "请先保存草稿再预览。",
  "settings.workspace.savePreviewFirstTitle": "发布前请先保存草稿并预览。",
  "settings.workspace.preflightNotice":
    "客户端预检发现阻断性问题。服务器仍是权威数据源，未发起调用。",
  "settings.workspace.draftSavedNotice":
    "草稿修订版本 {revision} 已保存到本地服务器。",
  "settings.workspace.saveReason": "设置工作区编辑：{section}",
  "settings.workspace.publishedNotice":
    "已发布。新发布版本即当前生效的运行时。",
  "settings.workspace.rollbackReason": "回滚到 r{releaseNumber}",
  "settings.workspace.rolledBackNotice":
    "已作为新发布版本回滚到 r{releaseNumber}。历史记录保持不变。",
  "settings.workspace.reloadedNotice":
    "已重新加载服务器草稿。未保存的本地修改已被丢弃。",
  "settings.workspace.readinessTitle": "发布就绪状态",
  "settings.workspace.readinessDescription":
    "发布需要已保存的草稿和最新的服务器预览。",
  "settings.workspace.readinessSavedDraft": "草稿已保存",
  "settings.workspace.readinessPreviewCurrent": "预览为最新",
  "settings.workspace.readinessChanges": "相对已发布的改动",
  "settings.workspace.readinessUnknown": "未知",
  "settings.workspace.readinessPublishReady": "可发布",
  "settings.workspace.serverUnreachable": "无法连接本地设置服务器。",
  "settings.workspace.previewNoChanges": "相对已发布版本没有改动。",
  "settings.workspace.previewChangesSummary":
    "共 {count} 处改动，涉及 {sections}。",

  // -- settings sections (navigation cards) -----------------------------------
  "settings.section.appearance.label": "外观",
  "settings.section.appearance.description": "主题、密度、动效",
  "settings.section.belief.label": "信念",
  "settings.section.belief.description": "置信度与新鲜度",
  "settings.section.decision.label": "决策",
  "settings.section.decision.description": "冷却时间与静音时段",
  "settings.section.signals.label": "信号",
  "settings.section.signals.description": "来源与权重",
  "settings.section.audio.label": "音频",
  "settings.section.audio.description": "配置档案与增益上限",
  "settings.section.privacy.label": "隐私",
  "settings.section.privacy.description": "保留期限与排除项",
  "settings.section.llm.label": "AI 解说",
  "settings.section.llm.description": "可选的展示增强",
  "settings.section.surface.label": "观测台",
  "settings.section.surface.description": "组件与排序",

  // -- appearance editor -------------------------------------------------------
  "settings.editor.appearance.title": "外观",
  "settings.editor.appearance.description":
    "本地外壳的呈现方式。与其他分区一样以服务器为权威 —— 发布后改动才会生效。",
  "settings.editor.appearance.productName": "产品名称",
  "settings.editor.appearance.productNameHelp": "显示在外壳页眉。",
  "settings.editor.appearance.theme": "主题",
  "settings.editor.appearance.themeSystem": "跟随系统",
  "settings.editor.appearance.themeLight": "浅色",
  "settings.editor.appearance.themeDark": "深色",
  "settings.editor.appearance.accentColor": "强调色",
  "settings.editor.appearance.accentHelp": "六位十六进制，例如 #6c8cff。",
  "settings.editor.appearance.density": "密度",
  "settings.editor.appearance.densityComfortable": "宽松",
  "settings.editor.appearance.densityCompact": "紧凑",
  "settings.editor.appearance.reducedMotion": "减少非必要动效",
  "settings.editor.appearance.language": "语言",

  // -- belief editor -----------------------------------------------------------
  "settings.editor.belief.title": "信念",
  "settings.editor.belief.description":
    "确定性投影器在判定状态已知前必须越过的阈值。UNKNOWN 始终是一等结果。",
  "settings.editor.belief.minimumConfidence": "最低置信度",
  "settings.editor.belief.minimumConfidenceHelp":
    "低于此值时决策引擎返回 NO_ACTION。",
  "settings.editor.belief.minimumMargin": "最小领先差",
  "settings.editor.belief.minimumMarginHelp": "领先状态需超出次名状态的幅度。",
  "settings.editor.belief.stabilityWindow": "稳定窗口（毫秒）",
  "settings.editor.belief.stabilityWindowHelp": "早于该窗口的信念视为过期。",
  "settings.editor.belief.note":
    "状态词表固定为 {states}，未知状态恒为 UNKNOWN。两者均为结构性约束，不可编辑。",

  // -- decision editor ---------------------------------------------------------
  "settings.editor.decision.title": "决策",
  "settings.editor.decision.description":
    "自动化何时可以行动。只有可逆的音频调整允许执行；手动输入始终优先。",
  "settings.editor.decision.cooldown": "手动覆盖冷却时间（毫秒）",
  "settings.editor.decision.cooldownHelp":
    "手动调整音频后，自动化在这段时间内让位。",
  "settings.editor.decision.undoWindow": "手动撤销窗口（毫秒）",
  "settings.editor.decision.undoWindowHelp": "已生效的动作在此时间内可撤销。",
  "settings.editor.decision.quietHours": "启用静音时段",
  "settings.editor.decision.quietFrom": "静音开始",
  "settings.editor.decision.quietUntil": "静音结束",
  "settings.editor.decision.note":
    "静音时段按本地时钟计算，可跨午夜。静音期间引擎返回 NO_ACTION 并附原因 QUIET_HOURS。未知与低置信度信念始终解析为 NO_ACTION，且效果始终可逆 —— 这些均为结构性约束，不可编辑。",

  // -- signals editor ----------------------------------------------------------
  "settings.editor.signals.title": "信号",
  "settings.editor.signals.description":
    "信号启用、权重和原始载荷开关尚未接入执行链，此 beta 暂不允许修改。",
  "settings.editor.signals.ideActivity": "IDE 活动",
  "settings.editor.signals.gitActivity": "Git 活动",
  "settings.editor.signals.appFocus": "应用焦点",
  "settings.editor.signals.terminalActivity": "终端活动",
  "settings.editor.signals.manualFeedback": "手动反馈",
  "settings.editor.signals.enabled": "启用",
  "settings.editor.signals.retainRaw": "保留原始载荷",
  "settings.editor.signals.weight": "权重",

  // -- audio editor ------------------------------------------------------------
  "settings.editor.audio.title": "音频",
  "settings.editor.audio.description":
    "唯一允许自动行动的执行器。每次改动都做增益渐变且可逆。",
  "settings.editor.audio.allowAutomatic": "允许自动调整音频",
  "settings.editor.audio.masterGain": "主增益上限",
  "settings.editor.audio.masterGainHelp":
    "硬性上限；各状态增益会被限制到该值。",
  "settings.editor.audio.soundscape": "声景",
  "settings.editor.audio.targetGain": "目标增益",
  "settings.editor.audio.ramp": "渐变（毫秒）",
  "settings.editor.audio.unknownNote": "UNKNOWN 必须保持静音：无声景、零增益。",

  // -- llm editor --------------------------------------------------------------
  "settings.editor.llm.title": "AI 解说",
  "settings.editor.llm.description":
    "可选的展示增强。关闭它，Muses 的其他一切功能完全不变。",
  "settings.editor.llm.enable": "启用 AI 解说（可选）",
  "settings.editor.llm.enableHelp": "默认关闭。没有它应用也完全可用。",
  "settings.editor.llm.model": "模型别名",
  "settings.editor.llm.modelHelp":
    "`auto` 表示由网关按请求选择模型 —— 每次可能不同。",
  "settings.editor.llm.note":
    "网关地址与凭据来自部署环境，绝不存入设置。生成文本仅用于展示。",

  // -- privacy editor ----------------------------------------------------------
  "settings.editor.privacy.title": "隐私",
  "settings.editor.privacy.description":
    "保留期仅适用于新原始事件。会话历史保留、应用排除及屏幕采集控制在此 beta 中尚未实现。",
  "settings.editor.privacy.rawEventRetention": "原始事件保留（小时）",
  "settings.editor.privacy.rawEventRetentionHelp":
    "发布后只影响新事件；设为零将停止采集入库。过期的新事件分批清理；旧数据、备份和 SQLite 空闲空间不会被擦除。数据库中尚存的过期记录仍可通过历史 API 查询，保留期不是访问控制。",
  "settings.editor.privacy.sessionHistoryRetention": "会话历史保留（天）",
  "settings.editor.privacy.captureScreenContent": "捕获屏幕内容",
  "settings.editor.privacy.excludedApplications": "排除的应用",
  "settings.editor.privacy.excludedApplicationsHelp":
    "每行一个 bundle id 或稳定的应用标识符。",

  // -- dashboard (surface) editor ----------------------------------------------
  "settings.editor.surface.title": "观测台组件",
  "settings.editor.surface.description":
    "仅接受八种静态组件 schema。不支持 HTML、JavaScript 或动态导入。",
  "settings.editor.surface.componentType": "组件类型",
  "settings.editor.surface.addComponent": "添加组件",
  "settings.editor.surface.empty":
    "暂无观测台组件。发布空 surface 会让观测台无内容可渲染。",
  "settings.editor.surface.orderAria": "观测台组件顺序",
  "settings.editor.surface.componentAria": "{label} 组件 {index}",
  "settings.editor.surface.moveUp": "上移",
  "settings.editor.surface.moveDown": "下移",
  "settings.editor.surface.remove": "移除",
  "settings.editor.surface.removeAria": "移除 {label}",
  "settings.editor.surface.stableId": "稳定 id",
  "settings.editor.surface.stableIdHelp":
    "字母、数字、点、冒号、下划线或连字符。",
  "settings.editor.surface.showConfidence": "显示置信度",
  "settings.editor.surface.showUnknownReason": "显示未知原因",
  "settings.editor.surface.maxStates": "最大状态数",
  "settings.editor.surface.showFactorContributions": "显示因子贡献",
  "settings.editor.surface.limit": "数量上限",
  "settings.editor.surface.showSource": "显示来源",
  "settings.editor.surface.showPayloadSummary": "显示载荷摘要",
  "settings.editor.surface.showNoAction": "显示 NO_ACTION 决策",
  "settings.editor.surface.showUndoAvailability": "显示可撤销状态",
  "settings.editor.surface.allowManualOverride": "允许手动覆盖",
  "settings.editor.surface.showMasterVolume": "显示主音量",
  "settings.editor.surface.metrics": "指标",
  "settings.editor.surface.showRetention": "显示保留期限",
  "settings.editor.surface.showExcludedApplications": "显示排除的应用",
  "settings.editor.surface.showModelAttribution": "显示模型署名",

  // -- widget definitions (surface editor pick list + preview) ------------------
  "settings.widget.stateHero.label": "状态主卡",
  "settings.widget.stateHero.description": "当前信念状态、置信度与未知原因。",
  "settings.widget.beliefDistribution.label": "信念分布",
  "settings.widget.beliefDistribution.description":
    "候选状态的概率分布及因子权重。",
  "settings.widget.evidenceList.label": "证据列表",
  "settings.widget.evidenceList.description":
    "推动当前信念变化的事件，最新在前。",
  "settings.widget.eventsTimeline.label": "事件时间线",
  "settings.widget.eventsTimeline.description":
    "按到达顺序排列的原始上下文事件。",
  "settings.widget.decisionCard.label": "决策卡片",
  "settings.widget.decisionCard.description":
    "当前生效的策略决策及其选择理由。",
  "settings.widget.audioControl.label": "音频控制",
  "settings.widget.audioControl.description": "声景播放、配置档案与手动覆盖。",
  "settings.widget.metricsGrid.label": "指标网格",
  "settings.widget.metricsGrid.description": "信念与效果健康度的滚动计数。",
  "settings.widget.privacyStatus.label": "隐私状态",
  "settings.widget.privacyStatus.description": "仅本地姿态、保留期限与排除项。",
  "settings.widget.llmNarration.label": "AI 解说",
  "settings.widget.llmNarration.description":
    "可选的、由用户触发的纯文本说明面板。",

  // -- preview panel -------------------------------------------------------------
  "settings.preview.draftBadge": "草稿预览 — 未生效",
  "settings.preview.title": "针对 r{releaseNumber} 预览",
  "settings.preview.body":
    "已发布版本仍为 r{releaseNumber}。预览由本地服务器解析，不会执行任何效果。",
  "settings.preview.close": "关闭预览",
  "settings.preview.validationPassed": "该文档已通过服务器校验。",
  "settings.preview.changedPaths": "改动路径（{count}）",
  "settings.preview.identical":
    "该文档与已发布版本完全相同。此时发布不会带来任何功能变化。",

  // -- release history -----------------------------------------------------------
  "settings.release.title": "发布历史",
  "settings.release.description": "本地设置服务器的不可变发布记录。",
  "settings.release.empty": "暂无可用的发布版本。",
  "settings.release.published": "已发布",
  "settings.release.rollbackBadge": "回滚",
  "settings.release.publishedBy": "由 {actor} 发布",
  "settings.release.current": "当前版本",
  "settings.release.rollBackToThis": "回滚到此版本",

  // -- publish dialog --------------------------------------------------------------
  "settings.dialog.publish.defaultSummary": "发布已审阅的设置草稿",
  "settings.dialog.publish.title": "发布设置草稿",
  "settings.dialog.publish.description":
    "发布将替换当前生效的服务器权威设置。上一发布版本仍可回滚。",
  "settings.dialog.publish.summaryLabel": "发布摘要",
  "settings.dialog.publish.acknowledge":
    "我已审阅草稿预览，并理解发布会更改当前生效的设置。",
  "settings.dialog.publish.publishing": "正在发布…",

  // -- rollback dialog --------------------------------------------------------------
  "settings.dialog.rollback.title": "回滚已发布的设置",
  "settings.dialog.rollback.body":
    "这会基于 r{releaseNumber} 创建新的发布版本，不会删除历史。",
  "settings.dialog.rollback.warning":
    "当前生效的设置将被替换。请输入英文 ROLLBACK 以继续。",
  "settings.dialog.rollback.phraseLabel": "确认短语",
  "settings.dialog.rollback.rollingBack": "正在回滚…",
  "settings.dialog.rollback.rollBack": "回滚",

  // -- conflict dialog ----------------------------------------------------------------
  "settings.dialog.conflict.title": "设置已在服务器上变更",
  "settings.dialog.conflict.body":
    "服务器拒绝了这次写入（{field}）：期望 {expected}，实际为 {actual}。未覆盖任何内容。",
  "settings.dialog.conflict.reloadTitle": "从服务器重新加载",
  "settings.dialog.conflict.reloadDescription":
    "丢弃未保存的本地修改，加载当前服务器权威的草稿与发布版本。",
  "settings.dialog.conflict.keepTitle": "继续编辑",
  "settings.dialog.conflict.keepDescription":
    "保留本地修改。重新加载草稿前，保存会一直失败。",

  // -- dashboard shell ------------------------------------------------------------------
  "dashboard.skipLink": "跳到观测台内容",
  "dashboard.eyebrow": "Muses · 本地观测台",
  "dashboard.guideLink": "使用指南",
  "dashboard.title": "上下文、信念与可逆行动",
  "dashboard.lede":
    "以服务器为权威的视图：Muses 观察到了什么、信念为何变化、是否选择了行动。",
  "dashboard.localBadgeAria": "仅本地运行时",
  "dashboard.localBadge": "本地运行时",
  "dashboard.primaryRegionAria": "当前观测台状态",
  "dashboard.noComponents":
    "已发布的观测台在该区域没有组件。请在设置中添加并发布后在此查看。",
  "dashboard.eventStreamEyebrow": "服务器事件流",
  "dashboard.recentEvents": "近期上下文事件",
  "dashboard.loadedCount": "已加载 {count} 条",
  "dashboard.loadingOlderEvents": "正在加载更早的事件…",
  "dashboard.loadOlderEvents": "加载更早的事件",
  "dashboard.allEventsLoaded": "已加载全部事件",
  "dashboard.noEventsAvailable": "暂无事件",
  "dashboard.railAria": "控制、指标与隐私",
  "dashboard.audioPromptAria": "待处理的音频干预",
  "dashboard.audioPromptTitle": "当前声音建议待开启",
  "dashboard.audioPromptBody": "仅在本页启用，可随时暂停。",
  "dashboard.audioPromptStart": "开启本次会话声音",
  "dashboard.audioPromptPause": "立即暂停声音",
  "dashboard.audioPromptDismiss": "关闭提示",

  // -- dashboard toolbar ------------------------------------------------------------------
  "dashboard.toolbar.aria": "观测台刷新控制",
  "dashboard.toolbar.liveRefresh": "实时刷新",
  "dashboard.toolbar.interval": "间隔",
  "dashboard.toolbar.refreshingState": "正在刷新本地状态…",
  "dashboard.toolbar.lastRefresh": "上次刷新 {time}",
  "dashboard.toolbar.notYetRefreshed": "尚未刷新",
  "dashboard.toolbar.refreshTimeUnavailable": "刷新时间不可用",
  "dashboard.toolbar.refreshing": "正在刷新…",
  "dashboard.toolbar.refreshNow": "立即刷新",

  // -- dashboard states ---------------------------------------------------------------------
  "dashboard.states.skeletonAria": "正在加载观测台",
  "dashboard.states.skeletonSr": "正在加载本地观测台状态。",
  "dashboard.states.disconnectedTitle": "本地服务器已断开",
  "dashboard.states.errorTitle": "观测台无法加载",
  "dashboard.states.disconnectedDetail":
    "观测台无法连接本地 Fastify 服务。现有服务器状态未被浏览器数据取代。",
  "dashboard.states.unreadableDetail": "本地服务器返回了无法解析的响应。",
  "dashboard.states.connection": "连接",
  "dashboard.states.serverResponse": "服务器响应",
  "dashboard.states.retryConnection": "重试本地连接",
  "dashboard.states.emptyEyebrow": "等待证据",
  "dashboard.states.emptyTitle": "观测台暂无状态",
  "dashboard.states.emptyBody":
    "本地服务器返回了空的权威快照。请让 Muses 保持运行以接收事件；本页面不会创建演示信念或决策。",
  "dashboard.states.staleTitle": "正在显示上一份服务器快照。",
  "dashboard.states.staleDefault": "该快照已超出服务器新鲜度窗口。",
  "dashboard.states.dismissError": "关闭错误",

  // -- registry slot degraded boundary --------------------------------------------------------
  "dashboard.slot.degradedEyebrow": "组件不可用",
  "dashboard.slot.degradedBody": "该注册组件无法渲染。观测台其他区域仍可用。",

  // -- dashboard surface titles -----------------------------------------------------------------
  "dashboard.surface.state.hero": "当前状态",
  "dashboard.surface.belief.distribution": "信念分布",
  "dashboard.surface.evidence.list": "证据",
  "dashboard.surface.events.timeline": "事件时间线",
  "dashboard.surface.decision.card": "决策理由",
  "dashboard.surface.audio.control": "音频效果",
  "dashboard.surface.metrics.grid": "指标",
  "dashboard.surface.privacy.status": "隐私状态",
  "dashboard.surface.llm.narration": "AI 解说",

  // -- registry: state hero -----------------------------------------------------------------------
  "registry.stateHero.title": "当前状态",
  "registry.stateHero.beliefConfidence": "信念置信度",
  "registry.stateHero.updated": "更新于 {time}",

  // -- registry: belief distribution ----------------------------------------------------------------
  "registry.beliefDistribution.title": "信念分布",
  "registry.beliefDistribution.supports": "支持",
  "registry.beliefDistribution.opposes": "反对",
  "registry.beliefDistribution.neutral": "中立",
  "registry.beliefDistribution.probabilityAria": "{label} 的概率",
  "registry.beliefDistribution.evidenceItem": "{count} 条证据",
  "registry.beliefDistribution.evidenceItems": "{count} 条证据",

  // -- registry: evidence list -----------------------------------------------------------------------
  "registry.evidenceList.title": "证据",
  "registry.evidenceList.empty": "暂无已验证的证据。",

  // -- registry: events timeline -----------------------------------------------------------------------
  "registry.eventsTimeline.title": "事件",
  "registry.eventsTimeline.empty": "尚未记录任何事件。",

  // -- registry: decision card --------------------------------------------------------------------------
  "registry.decisionCard.title": "决策",
  "registry.decisionCard.confidence": "决策置信度",
  "registry.decisionCard.expires": "{time} 过期",
  "registry.decisionCard.undo": "撤销决策",

  // -- registry: audio control ---------------------------------------------------------------------------
  "registry.audioControl.title": "音频控制",
  "registry.audioControl.noTrack": "未选择曲目",
  "registry.audioControl.playing": "音频播放中",
  "registry.audioControl.paused": "音频已暂停",
  "registry.audioControl.volume": "音量：{percent}%",
  "registry.audioControl.unmute": "取消静音",
  "registry.audioControl.mute": "静音",

  // -- registry: metrics grid ---------------------------------------------------------------------------
  "registry.metricsGrid.title": "指标",
  "registry.metricsGrid.increasing": "上升",
  "registry.metricsGrid.decreasing": "下降",
  "registry.metricsGrid.stable": "稳定",
  "registry.metricsGrid.unknownTrend": "趋势未知",

  // -- registry: privacy status ---------------------------------------------------------------------------
  "registry.privacyStatus.title": "隐私状态",
  "registry.privacyStatus.localOnly": "仅本地",
  "registry.privacyStatus.notLocal": "非仅本地",
  "registry.privacyStatus.activeSensors": "活跃传感器",
  "registry.privacyStatus.none": "无",
  "registry.privacyStatus.retention": "保留期限",
  "registry.privacyStatus.pendingDeletion": "待删除",
  "registry.privacyStatus.lastExport": "上次导出",

  // -- registry: llm narration ----------------------------------------------------------------------------
  "registry.llmNarration.title": "AI 解说",
  "registry.llmNarration.disclosure":
    "启用后，本面板会向所配置的本地网络网关发送当前信念摘要与事件计数 —— 绝不发送文件内容或路径。输出仅用于展示。",
  "registry.llmNarration.cooldown": "冷却中",
  "registry.llmNarration.cooldownDetail": "暂时不可用 —— 请稍后重试。",
  "registry.llmNarration.generating": "正在生成…",
  "registry.llmNarration.generatedBy": "由 {model} 生成 · {time}",
  "registry.llmNarration.unknownModel": "未知模型",
  "registry.llmNarration.unknownTime": "未知时间",
  "registry.llmNarration.explain": "解说当前状态",
  "registry.llmNarration.summarize": "总结最近一小时",
  "registry.llmNarration.retry": "重试",

  // -- registry: safe fallback ------------------------------------------------------------------------------
  "registry.safeFallback.title": "组件不可用",
  "registry.safeFallback.requested": "请求：{type}",
  "registry.safeFallback.reason": "原因：{reason}",
  "registry.safeFallback.dashboardInvalid": "观测台配置无效，未渲染。",
  "registry.safeFallback.dashboardSchemaVersion":
    "不支持该观测台 schema 版本。",
  "registry.safeFallback.componentUnknownType": "该组件类型未注册。",
  "registry.safeFallback.componentInvalidProps": "该组件收到了无效配置。",
  "registry.safeFallback.componentSchemaVersion": "不支持该组件 schema 版本。",
  "registry.safeFallback.componentMissingCapability":
    "缺少所需的本地能力，该组件不可用。",
  "registry.safeFallback.componentRenderError":
    "该组件已安全失败，并与观测台其余部分隔离。",

  // -- foundation status page ---------------------------------------------------------------------------------
  "foundation.status.eyebrow": "Muses v0.1 · 基础外壳",
  "foundation.status.title": "本地上下文运行时，已就绪待模块接入。",
  "foundation.status.lede":
    "此最小界面用于验证 React 外壳与 Fastify 本地服务。产品模块拥有全部领域行为，并将通过类型化组合钩子注册。",
  "foundation.status.localAuthority": "本地服务",
  "foundation.status.checking": "正在检查回环健康状态…",
  "foundation.status.authorityUnavailable": "本地服务不可用。",
  "foundation.status.connected": "已连接 · 版本 {version} · 运行 {seconds} 秒",
  "foundation.status.notConnected": "未连接",
  "foundation.status.connectedAria": "已连接",
  "foundation.status.securityNote":
    "仅本地边界。回环绑定与来源校验降低了暴露面，但本原型并非经过认证的多用户生产服务。",

  // -- root error boundary --------------------------------------------------------------------------------------
  "foundation.errorBoundary.eyebrow": "本地界面错误",
  "foundation.errorBoundary.title": "Muses 无法渲染此视图。",
  "foundation.errorBoundary.body":
    "未发送任何远程报告。请重试本地视图；持续失败请检查本地开发日志。",
  "foundation.errorBoundary.retry": "重试视图",

  // -- dashboard hooks: user-facing errors -------------------------------------------------------------------------
  "dashboard.errors.manualNeedsEffect":
    "手动播放控制命令需要当前快照中的效果。",
  "dashboard.errors.outcomeDeclined": "本地服务器拒绝了上报的效果结果。",
  "dashboard.errors.audioCommandFailed": "音频引擎无法完成该命令。",
  "dashboard.errors.generationFailed": "生成失败。",

  // -- dashboard API parse errors ------------------------------------------------------------------------------------
  "api.error.expectedString": '"{key}" 应为字符串。',
  "api.error.expectedStringWhenPresent": '"{key}" 存在时应为字符串。',
  "api.error.expectedFiniteNumber": '"{key}" 应为有限数字。',
  "api.error.expectedBoolean": '"{key}" 应为布尔值。',
  "api.error.expectedObject": '"{key}" 应为对象。',
  "api.error.expectedArrayWhenPresent": '"{key}" 存在时应为数组。',
  "api.error.unsupportedValue": '"{key}" 的值不受支持：{value}',
  "api.error.expectedUnitInterval": '"{key}" 应介于 0 和 1 之间。',
  "api.error.expectedIsoDate": '"{key}" 应为 ISO 日期时间字符串。',
  "api.error.expectedPrivacyObject": "隐私载荷应为对象。",
  "api.error.privacyNotLocalOnly":
    "观测台拒绝了非严格仅本地或报告云/API key 能力的隐私载荷。",
  "api.error.expectedCapabilityObject": "每个隐私能力应为对象。",
  "api.error.expectedStringArray": '"{key}" 应为字符串数组。',
  "api.error.expectedStringArrayEntries": '"{key}" 的条目应为字符串。',
  "api.error.expectedEvidenceObject": "每条信念证据应为对象。",
  "api.error.expectedFactorObject": "每个信念因子应为对象。",
  "api.error.expectedBeliefObject": "信念快照应为对象。",
  "api.error.expectedDecisionFactorObject": "每个决策因子应为对象。",
  "api.error.expectedDecisionObject": "决策应为对象。",
  "api.error.expectedEffectObjectOrNull": '"effect" 应为对象或 null。',
  "api.error.expectedOutcomeObject": "效果结果应为对象。",
  "api.error.unsupportedOutcomeStatus": "不支持的结果状态：{status}",
  "api.error.expectedLedgerObject": "效果台账条目应为对象。",
  "api.error.expectedSettingsObject": "设置响应应为对象。",
  "api.error.expectedCurrentRelease": '"currentRelease" 应为对象或 null。',
  "api.error.expectedCurrentReleaseDocument":
    '"currentRelease.document" 应为对象。',
  "api.error.expectedAudioPrivacyObjects":
    "设置文档应包含 audio 和 privacy 对象。",
  "api.error.expectedContextEventObject": "每条上下文事件应为对象。",
  "api.error.expectedSnapshotObject": "观测台快照应为对象。",
  "api.error.expectedSnapshotKey": '观测台快照应包含 "{key}"。',
  "api.error.expectedPrivacyPayloadLocalOnly":
    "观测台拒绝了非严格仅本地的隐私载荷。",
  "api.error.expectedEventPageObject": "事件页应为对象。",
  "api.error.expectedNextCursor": '"nextCursor" 应为字符串、null 或省略。',
  "api.error.expectedHasMoreBoolean": '"hasMore" 存在时应为布尔值。',
  "api.error.expectedCursorWhenHasMore":
    '"hasMore" 为 true 时 "nextCursor" 应非 null。',
  "api.error.expectedEventObject": "每个事件应为对象。",
  "api.error.expectedMetadataJson": '事件 "metadata" 应为 JSON 兼容的值。',
  "api.error.expectedEffectResultObject": "效果命令结果应为对象。",
  "api.error.unknownEffect": "本地服务器不再跟踪该效果。",
  "api.error.expectedLlmObject": "LLM 生成结果应为对象。",
  "api.error.expectedModelLength":
    '"model" 应为不超过 128 个字符的非空字符串。',
  "api.error.expectedBootstrapObject": "bootstrap 响应应为对象。",
  "api.error.invalidJsonDetail": "服务器返回了无效 JSON：{detail}",
  "api.error.invalidJson": "服务器返回了无效 JSON。",
  "api.error.requestAborted": "请求已中止。",
  "api.error.unreachable": "无法连接本地 Muses 服务器。",
  "api.error.httpStatus": "本地 Muses 服务器返回 HTTP {status}。",
  "api.error.effectIdRequired": "效果结果需要来自当前观测台快照的 effectId。",
  "api.error.unknownDashboardError": "未知的观测台错误。",

  // -- auth（登录 / 注册 / 用户管理）---------------------------------------------

  "auth.gate.checking": "正在检查登录状态…",
  "auth.session.signOut": "退出登录",
  "auth.session.adminLink": "用户管理",
  "auth.session.settingsLink": "设置",
  "auth.error.network": "无法连接 Muses 服务器。",
  "auth.error.sessionExpired": "登录已过期，请重新登录。",

  // -- 登录 -----------------------------------------------------------------------
  "auth.login.title": "登录",
  "auth.login.subtitle": "使用你的 Muses 账号邮箱和密码。",
  "auth.login.emailLabel": "邮箱",
  "auth.login.passwordLabel": "密码",
  "auth.login.submit": "登录",
  "auth.login.submitting": "正在登录…",
  "auth.login.toRegister": "还没有账号？去注册",

  // -- 注册 -----------------------------------------------------------------------
  "auth.register.title": "创建账号",
  "auth.register.subtitle": "先查收邮箱验证码，再设置密码。",
  "auth.register.stepsAria": "注册步骤",
  "auth.register.stepEmail": "邮箱",
  "auth.register.stepVerify": "验证",
  "auth.register.stepDone": "完成",
  "auth.register.emailLabel": "邮箱",
  "auth.register.emailPlaceholder": "you@example.com",
  "auth.register.sendCode": "发送验证码",
  "auth.register.sending": "发送中…",
  "auth.register.invalidEmail": "请输入有效的邮箱地址。",
  "auth.register.changeEmail": "更换邮箱",
  "auth.register.codeLabel": "验证码",
  "auth.register.codePlaceholder": "6 位验证码",
  "auth.register.codeSent": "验证码已发送，请查收邮箱。",
  "auth.register.devCode": "开发验证码：{code}",
  "auth.register.resend": "重新发送",
  "auth.register.resendIn": "{seconds} 秒后可重发",
  "auth.register.codeRequired": "请输入邮件中的验证码。",
  "auth.register.passwordLabel": "密码",
  "auth.register.passwordHint": "至少 6 位。",
  "auth.register.passwordTooShort": "密码至少需要 6 位。",
  "auth.register.displayNameLabel": "昵称（可选）",
  "auth.register.displayNamePlaceholder": "留空则使用邮箱前缀",
  "auth.register.submit": "完成注册",
  "auth.register.submitting": "注册中…",
  "auth.register.doneTitle": "注册成功",
  "auth.register.doneBody": "欢迎，{name}，你已登录。",
  "auth.register.continue": "继续",
  "auth.register.toLogin": "已有账号？去登录",

  // -- 用户管理 ---------------------------------------------------------------------
  "auth.admin.title": "用户管理",
  "auth.admin.subtitle": "本地账号的启用、停用与删除。",
  "auth.admin.loading": "正在加载用户…",
  "auth.admin.loadFailed": "用户列表加载失败。",
  "auth.admin.actionFailed": "操作失败。",
  "auth.admin.empty": "还没有用户。",
  "auth.admin.statsTotal": "用户",
  "auth.admin.statsAdmins": "管理员",
  "auth.admin.statsDisabled": "已停用",
  "auth.admin.colUser": "用户",
  "auth.admin.colRole": "角色",
  "auth.admin.colStatus": "状态",
  "auth.admin.colCreatedAt": "创建时间",
  "auth.admin.colActions": "操作",
  "auth.admin.roleAdmin": "管理员",
  "auth.admin.roleUser": "用户",
  "auth.admin.active": "启用",
  "auth.admin.disabled": "已停用",
  "auth.admin.activate": "启用",
  "auth.admin.deactivate": "停用",
  "auth.admin.delete": "删除",
  "auth.admin.confirmDelete": "确认删除",
  "auth.admin.processing": "处理中…",
  "auth.admin.selfProtected": "不能在这里操作自己的账号。",
  "auth.admin.deniedTitle": "仅管理员可用",
  "auth.admin.deniedBody": "请使用管理员账号登录后再管理用户。",
  // -- v0.7 self-track player (batch 1, C path) ---------------------------
  "player.title": "自我轨",
  "player.subtitle": "你的状态，由脉搏信号驱动。",
  "player.state.idle": "待机",
  "player.state.playing": "播放中",
  "player.state.crossfading": "交叉过渡",
  "player.state.ended": "已结束",
  "player.control.start": "开始",
  "player.control.stop": "停止",
  "player.control.skip": "跳过",
  "player.nowPlaying.label": "正在播放",
  "player.attribution.label": "许可证",
  "player.plan.localStubNotice": "本地计划——服务端播放计划 API 尚未接入。",

  // -- v0.7 vibe signature (batch 1, C path) ------------------------------
  "signature.title": "Vibe 签名",
  "signature.subtitle": "你的状态如何映射到音乐。v0 采用模板加手动微调。",
  "signature.template.minimalElectronic.name": "极简电子",
  "signature.template.minimalElectronic.description":
    "为深度专注准备的稳定脉冲。约 118–138 BPM，能量有上限，人声稀疏。",
  "signature.template.ambient.name": "环境氛围",
  "signature.template.ambient.description":
    "为平静与恢复准备的织体铺底。约 60–80 BPM，低能量，无人声。",
  "signature.template.lofiJazz.name": "Lo-fi 爵士",
  "signature.template.lofiJazz.description":
    "为从容工作准备的慵懒和弦。约 70–90 BPM，中等能量，少量人声。",
  "signature.calibration.bpmMin.label": "BPM 下界",
  "signature.calibration.bpmMax.label": "BPM 上界",
  "signature.calibration.energyCap.label": "能量上限",
  "signature.calibration.vocalDensity.label": "人声密度",
  "signature.calibration.vocalDensity.none": "无",
  "signature.calibration.vocalDensity.low": "低",
  "signature.calibration.vocalDensity.medium": "中",
  "signature.calibration.vocalDensity.high": "高",
  "signature.calibration.error.bpmRange":
    "BPM 区间需满足 40 ≤ 下界 < 上界 ≤ 200。",
  "signature.summary.heading": "生效签名",
  "signature.summary.bpm": "BPM 区间",
  "signature.summary.energyCap": "能量上限",
  "signature.summary.vocalDensity": "人声密度",
  "signature.journal.notice": "跳过与重听只做记录，暂不用于学习。",

  // -- v0.7 journey replay (batch 2, D path) ------------------------------
  "replay.title": "回放",
  "replay.subtitle": "把你的一天铺成时间轴——拖动即可回看每个状态。",
  "replay.loading": "正在加载旅程…",
  "replay.empty": "还没有记录到旅程。",
  "replay.error": "回放不可用：",
};
