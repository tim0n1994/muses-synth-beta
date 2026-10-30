/**
 * 日本語メッセージカタログ。キー集合は en.ts と完全に一致
 * （Record<MessageKey, string> によりコンパイル時に強制）。
 *
 * 用語集：
 *   Muses —— 製品名のため翻訳しない
 *   Observatory —— 観測台
 *   rollback —— ロールバック
 *   publish/release —— 公開／リリース
 *   draft —— 下書き
 *   belief —— 信念
 *   snapshot —— スナップショット
 *   soundscape —— サウンドスケープ
 *   gain —— ゲイン
 *   widget —— コンポーネント
 *   narration —— 解説
 */
import type { MessageKey } from "./en";

export const ja: Record<MessageKey, string> = {
  // -- shared ----------------------------------------------------------------
  "common.yes": "はい",
  "common.no": "いいえ",
  "common.cancel": "キャンセル",
  "common.retry": "再試行",
  "common.dismiss": "閉じる",
  "common.publish": "公開",

  // -- settings workspace chrome ---------------------------------------------
  "settings.workspace.title": "設定",
  "settings.workspace.subtitle":
    "ローカルの Muses ランタイムに対する下書き・プレビュー・公開・履歴・ロールバック。",
  "settings.workspace.unsavedEdits": "未保存のローカル編集があります",
  "settings.workspace.draftSaved": "下書きをサーバーに保存済み",
  "settings.workspace.loading": "設定を読み込み中…",
  "settings.workspace.unavailable": "設定を利用できません",
  "settings.workspace.versionsAria": "設定のバージョン",
  "settings.workspace.draftBadge": "下書き — 未適用",
  "settings.workspace.revisionLabel": "リビジョン {revision}",
  "settings.workspace.publishedBadge": "公開済み — 適用中",
  "settings.workspace.errorTitle": "設定操作に失敗しました",
  "settings.workspace.dismissNoticeAria": "通知を閉じる",
  "settings.workspace.navigationAria": "設定カテゴリ",
  "settings.workspace.draftActionsAria": "下書きの操作",
  "settings.workspace.saving": "保存中…",
  "settings.workspace.saveDraft": "下書きを保存",
  "settings.workspace.generating": "生成中…",
  "settings.workspace.previewDraft": "下書きをプレビュー",
  "settings.workspace.saveBeforePreviewTitle":
    "プレビューの前に下書きを保存してください。",
  "settings.workspace.savePreviewFirstTitle":
    "公開の前に下書きを保存してプレビューしてください。",
  "settings.workspace.preflightNotice":
    "クライアント側の事前検査でブロック問題が見つかりました。サーバーが依然として正であり、呼び出しは行われていません。",
  "settings.workspace.draftSavedNotice":
    "下書きリビジョン {revision} をローカルサーバーに保存しました。",
  "settings.workspace.saveReason": "設定ワークスペースの編集：{section}",
  "settings.workspace.publishedNotice":
    "公開しました。新しいリリースが現在のランタイムです。",
  "settings.workspace.rollbackReason": "r{releaseNumber} へロールバック",
  "settings.workspace.rolledBackNotice":
    "r{releaseNumber} を新しいリリースとしてロールバックしました。履歴は変更されていません。",
  "settings.workspace.reloadedNotice":
    "サーバーの下書きを再読み込みしました。未保存のローカル編集は破棄されました。",
  "settings.workspace.readinessTitle": "公開の準備状況",
  "settings.workspace.readinessDescription":
    "公開には、保存済みの下書きと最新のサーバープレビューが必要です。",
  "settings.workspace.readinessSavedDraft": "下書きの保存",
  "settings.workspace.readinessPreviewCurrent": "プレビューが最新",
  "settings.workspace.readinessChanges": "公開済みとの差分",
  "settings.workspace.readinessUnknown": "不明",
  "settings.workspace.readinessPublishReady": "公開可能",
  "settings.workspace.serverUnreachable":
    "ローカルの設定サーバーに接続できませんでした。",
  "settings.workspace.previewNoChanges":
    "公開済みリリースに対する変更はありません。",
  "settings.workspace.previewChangesSummary":
    "{sections} にわたる {count} 件の変更。",

  // -- settings sections (navigation cards) -----------------------------------
  "settings.section.appearance.label": "外観",
  "settings.section.appearance.description": "テーマ・密度・モーション",
  "settings.section.belief.label": "信念",
  "settings.section.belief.description": "信頼度と鮮度",
  "settings.section.decision.label": "決定",
  "settings.section.decision.description": "クールダウンと静寂時間",
  "settings.section.signals.label": "シグナル",
  "settings.section.signals.description": "ソースと重み",
  "settings.section.audio.label": "オーディオ",
  "settings.section.audio.description": "プロファイルとゲイン上限",
  "settings.section.privacy.label": "プライバシー",
  "settings.section.privacy.description": "保持期間と除外項目",
  "settings.section.llm.label": "AI 解説",
  "settings.section.llm.description": "任意の表示拡張",
  "settings.section.surface.label": "ダッシュボード",
  "settings.section.surface.description": "ウィジェットと順序",

  // -- appearance editor -------------------------------------------------------
  "settings.editor.appearance.title": "外観",
  "settings.editor.appearance.description":
    "ローカルシェルの表示方法。他のセクションと同様にサーバーが正です —— 公開して初めて変更が有効になります。",
  "settings.editor.appearance.productName": "製品名",
  "settings.editor.appearance.productNameHelp":
    "シェルのマストヘッドに表示されます。",
  "settings.editor.appearance.theme": "テーマ",
  "settings.editor.appearance.themeSystem": "システムに従う",
  "settings.editor.appearance.themeLight": "ライト",
  "settings.editor.appearance.themeDark": "ダーク",
  "settings.editor.appearance.accentColor": "アクセントカラー",
  "settings.editor.appearance.accentHelp": "6 桁の 16 進数。例：#6c8cff。",
  "settings.editor.appearance.density": "密度",
  "settings.editor.appearance.densityComfortable": "ゆったり",
  "settings.editor.appearance.densityCompact": "コンパクト",
  "settings.editor.appearance.reducedMotion": "必須でないモーションを減らす",
  "settings.editor.appearance.language": "言語",

  // -- belief editor -----------------------------------------------------------
  "settings.editor.belief.title": "信念",
  "settings.editor.belief.description":
    "決定論的プロジェクターが状態を既知と判定するために越える必要のあるしきい値。UNKNOWN は常に第一級の結果です。",
  "settings.editor.belief.minimumConfidence": "最小信頼度",
  "settings.editor.belief.minimumConfidenceHelp":
    "これを下回ると決定エンジンは NO_ACTION を返します。",
  "settings.editor.belief.minimumMargin": "最小マージン",
  "settings.editor.belief.minimumMarginHelp":
    "首位の状態が次位に必要とする差。",
  "settings.editor.belief.stabilityWindow": "安定ウィンドウ（ミリ秒）",
  "settings.editor.belief.stabilityWindowHelp":
    "このウィンドウより古い信念は失効とみなされます。",
  "settings.editor.belief.note":
    "状態の語彙は {states} に固定で、未知状態は常に UNKNOWN です。どちらも構造上の制約であり編集できません。",

  // -- decision editor ---------------------------------------------------------
  "settings.editor.decision.title": "決定",
  "settings.editor.decision.description":
    "自動化が行動してよい条件。実行できるのは可逆的なオーディオ調整のみで、手動入力が常に優先されます。",
  "settings.editor.decision.cooldown":
    "手動オーバーライドのクールダウン（ミリ秒）",
  "settings.editor.decision.cooldownHelp":
    "手動でのオーディオ変更後、自動化はこの間待機します。",
  "settings.editor.decision.undoWindow": "手動取り消しウィンドウ（ミリ秒）",
  "settings.editor.decision.undoWindowHelp":
    "適用済みの効果が取り消し可能な期間。",
  "settings.editor.decision.quietHours": "静寂時間を有効にする",
  "settings.editor.decision.quietFrom": "静寂開始",
  "settings.editor.decision.quietUntil": "静寂終了",
  "settings.editor.decision.note":
    "静寂時間はローカル時計に基づき、深夜をまたぐことがあります。静寂中、エンジンは理由 QUIET_HOURS 付きの NO_ACTION を返します。未知および低信頼度の信念は常に NO_ACTION に解決され、効果は常に可逆です —— これらは構造上の制約であり編集できません。",

  // -- signals editor ----------------------------------------------------------
  "settings.editor.signals.title": "シグナル",
  "settings.editor.signals.description":
    "信号の有効化、重み、生データ保持の設定は未実装のため、このベータ版では変更できません。",
  "settings.editor.signals.ideActivity": "IDE アクティビティ",
  "settings.editor.signals.gitActivity": "Git アクティビティ",
  "settings.editor.signals.appFocus": "アプリケーションのフォーカス",
  "settings.editor.signals.terminalActivity": "ターミナルアクティビティ",
  "settings.editor.signals.manualFeedback": "手動フィードバック",
  "settings.editor.signals.enabled": "有効",
  "settings.editor.signals.retainRaw": "生ペイロードを保持",
  "settings.editor.signals.weight": "重み",

  // -- audio editor ------------------------------------------------------------
  "settings.editor.audio.title": "オーディオ",
  "settings.editor.audio.description":
    "自動的に行動できる唯一の実行者です。すべての変更はゲインランプ付きで可逆です。",
  "settings.editor.audio.allowAutomatic": "オーディオの自動調整を許可",
  "settings.editor.audio.masterGain": "マスターゲイン上限",
  "settings.editor.audio.masterGainHelp":
    "絶対上限。状態ごとのゲインはこの値に制限されます。",
  "settings.editor.audio.soundscape": "サウンドスケープ",
  "settings.editor.audio.targetGain": "目標ゲイン",
  "settings.editor.audio.ramp": "ランプ（ミリ秒）",
  "settings.editor.audio.unknownNote":
    "UNKNOWN は静音のままにする必要があります：サウンドスケープなし、ゲイン 0。",

  // -- llm editor --------------------------------------------------------------
  "settings.editor.llm.title": "AI 解説",
  "settings.editor.llm.description":
    "任意の表示拡張です。オフにしていても Muses の他の機能はまったく同じように動作します。",
  "settings.editor.llm.enable": "AI 解説を有効にする（任意）",
  "settings.editor.llm.enableHelp":
    "既定ではオフです。なくてもアプリは完全に機能します。",
  "settings.editor.llm.model": "モデルのエイリアス",
  "settings.editor.llm.modelHelp":
    "`auto` はリクエストごとにゲートウェイがモデルを選択します —— 毎回異なる可能性があります。",
  "settings.editor.llm.note":
    "ゲートウェイのアドレスと資格情報はデプロイ環境由来で、設定には決して保存されません。生成テキストは表示専用です。",

  // -- privacy editor ----------------------------------------------------------
  "settings.editor.privacy.title": "プライバシー",
  "settings.editor.privacy.description":
    "保持期間は新しい生イベントに適用されます。セッション履歴の保持、アプリ除外、画面取得の設定は未実装です。",
  "settings.editor.privacy.rawEventRetention": "生イベントの保持（時間）",
  "settings.editor.privacy.rawEventRetentionHelp":
    "公開後の新規イベントにのみ適用。0 は取り込みを停止します。期限切れイベントは順次削除されますが、旧データ、バックアップ、SQLite の空き領域は消去されません。残存する期限切れデータは履歴 API で取得可能であり、保持期間はアクセス制御ではありません。",
  "settings.editor.privacy.sessionHistoryRetention":
    "セッション履歴の保持（日数）",
  "settings.editor.privacy.captureScreenContent": "画面コンテンツの取得",
  "settings.editor.privacy.excludedApplications": "除外するアプリケーション",
  "settings.editor.privacy.excludedApplicationsHelp":
    "1 行に 1 つの bundle id または安定したアプリ識別子。",

  // -- dashboard (surface) editor ----------------------------------------------
  "settings.editor.surface.title": "ダッシュボードコンポーネント",
  "settings.editor.surface.description":
    "受け付けられるのは 8 種類の静的コンポーネントスキーマのみです。HTML、JavaScript、動的インポートは不可です。",
  "settings.editor.surface.componentType": "コンポーネント型",
  "settings.editor.surface.addComponent": "コンポーネントを追加",
  "settings.editor.surface.empty":
    "ダッシュボードコンポーネントがありません。空のサーフェスを公開すると、観測台は表示するものがなくなります。",
  "settings.editor.surface.orderAria": "ダッシュボードコンポーネントの順序",
  "settings.editor.surface.componentAria": "{label} コンポーネント {index}",
  "settings.editor.surface.moveUp": "上へ移動",
  "settings.editor.surface.moveDown": "下へ移動",
  "settings.editor.surface.remove": "削除",
  "settings.editor.surface.removeAria": "{label} を削除",
  "settings.editor.surface.stableId": "安定 id",
  "settings.editor.surface.stableIdHelp":
    "英数字、ドット、コロン、アンダースコア、ハイフン。",
  "settings.editor.surface.showConfidence": "信頼度を表示",
  "settings.editor.surface.showUnknownReason": "未知の理由を表示",
  "settings.editor.surface.maxStates": "最大状態数",
  "settings.editor.surface.showFactorContributions": "因子の寄与を表示",
  "settings.editor.surface.limit": "上限",
  "settings.editor.surface.showSource": "ソースを表示",
  "settings.editor.surface.showPayloadSummary": "ペイロード概要を表示",
  "settings.editor.surface.showNoAction": "NO_ACTION 決定を表示",
  "settings.editor.surface.showUndoAvailability": "取り消し可否を表示",
  "settings.editor.surface.allowManualOverride": "手動オーバーライドを許可",
  "settings.editor.surface.showMasterVolume": "マスター音量を表示",
  "settings.editor.surface.metrics": "メトリクス",
  "settings.editor.surface.showRetention": "保持期間を表示",
  "settings.editor.surface.showExcludedApplications":
    "除外アプリケーションを表示",
  "settings.editor.surface.showModelAttribution": "モデルの帰属を表示",

  // -- widget definitions (surface editor pick list + preview) ------------------
  "settings.widget.stateHero.label": "ステートヒーロー",
  "settings.widget.stateHero.description":
    "現在の信念状態、信頼度、未知の理由。",
  "settings.widget.beliefDistribution.label": "信念分布",
  "settings.widget.beliefDistribution.description":
    "候補状態の確率と因子の重み。",
  "settings.widget.evidenceList.label": "エビデンスリスト",
  "settings.widget.evidenceList.description":
    "現在の信念を動かしたイベント。新しい順。",
  "settings.widget.eventsTimeline.label": "イベントタイムライン",
  "settings.widget.eventsTimeline.description":
    "到着順の取り込み済みコンテキストイベント。",
  "settings.widget.decisionCard.label": "決定カード",
  "settings.widget.decisionCard.description":
    "アクティブなポリシー決定とその選択理由。",
  "settings.widget.audioControl.label": "オーディオ制御",
  "settings.widget.audioControl.description":
    "サウンドスケープの再生、プロファイル、手動オーバーライド。",
  "settings.widget.metricsGrid.label": "メトリクスグリッド",
  "settings.widget.metricsGrid.description":
    "信念と効果の健全性に関するローリングカウンター。",
  "settings.widget.privacyStatus.label": "プライバシー状態",
  "settings.widget.privacyStatus.description":
    "ローカルのみの姿勢、保持期間、除外項目。",
  "settings.widget.llmNarration.label": "AI 解説",
  "settings.widget.llmNarration.description":
    "任意の、ユーザーが起動するプレーンテキスト説明パネル。",

  // -- preview panel -------------------------------------------------------------
  "settings.preview.draftBadge": "下書きプレビュー — 未適用",
  "settings.preview.title": "r{releaseNumber} に対するプレビュー",
  "settings.preview.body":
    "公開済みリリースは r{releaseNumber} のままです。プレビューはローカルサーバーが解決し、効果は一切実行しません。",
  "settings.preview.close": "プレビューを閉じる",
  "settings.preview.validationPassed":
    "このドキュメントはサーバー検証に合格しました。",
  "settings.preview.changedPaths": "変更されたパス（{count}）",
  "settings.preview.identical":
    "このドキュメントは公開済みリリースと同一です。公開しても機能的な変更は生じません。",

  // -- release history -----------------------------------------------------------
  "settings.release.title": "リリース履歴",
  "settings.release.description": "ローカル設定サーバーによる不変の公開記録。",
  "settings.release.empty": "利用可能な公開リリースはありません。",
  "settings.release.published": "公開済み",
  "settings.release.rollbackBadge": "ロールバック",
  "settings.release.publishedBy": "{actor} により公開",
  "settings.release.current": "現在のリリース",
  "settings.release.rollBackToThis": "このリリースへロールバック",

  // -- publish dialog --------------------------------------------------------------
  "settings.dialog.publish.defaultSummary": "レビュー済みの設定下書きを公開",
  "settings.dialog.publish.title": "設定下書きを公開",
  "settings.dialog.publish.description":
    "公開すると、適用中のサーバー権威の設定が置き換えられます。前のリリースはロールバック用に残ります。",
  "settings.dialog.publish.summaryLabel": "リリース概要",
  "settings.dialog.publish.acknowledge":
    "下書きプレビューを確認し、公開によって適用中の設定が変更されることを理解しました。",
  "settings.dialog.publish.publishing": "公開中…",

  // -- rollback dialog --------------------------------------------------------------
  "settings.dialog.rollback.title": "公開済み設定をロールバック",
  "settings.dialog.rollback.body":
    "r{releaseNumber} から新しいリリースを作成します。履歴は削除されません。",
  "settings.dialog.rollback.warning":
    "現在適用中の設定は置き換えられます。続行するには英語で ROLLBACK と入力してください。",
  "settings.dialog.rollback.phraseLabel": "確認フレーズ",
  "settings.dialog.rollback.rollingBack": "ロールバック中…",
  "settings.dialog.rollback.rollBack": "ロールバック",

  // -- conflict dialog ----------------------------------------------------------------
  "settings.dialog.conflict.title": "設定がサーバー上で変更されました",
  "settings.dialog.conflict.body":
    "サーバーは {field} への書き込みを拒否しました：期待値 {expected}、実際は {actual} です。何も上書きされていません。",
  "settings.dialog.conflict.reloadTitle": "サーバーから再読み込み",
  "settings.dialog.conflict.reloadDescription":
    "未保存のローカル編集を破棄し、現在のサーバー権威の下書きとリリースを読み込みます。",
  "settings.dialog.conflict.keepTitle": "編集を続ける",
  "settings.dialog.conflict.keepDescription":
    "ローカル編集をそのまま残します。下書きを再読み込みするまで保存は失敗し続けます。",

  // -- dashboard shell ------------------------------------------------------------------
  "dashboard.skipLink": "観測台コンテンツへスキップ",
  "dashboard.eyebrow": "Muses · ローカル観測台",
  "dashboard.guideLink": "使用ガイド",
  "dashboard.title": "文脈、信念、可逆な行動",
  "dashboard.lede":
    "Muses が何を観測し、信念がなぜ変わり、行動を選んだかを示すサーバー権威のビュー。",
  "dashboard.localBadgeAria": "ローカル専用ランタイム",
  "dashboard.localBadge": "ローカルランタイム",
  "dashboard.primaryRegionAria": "現在の観測台状態",
  "dashboard.noComponents":
    "公開済みダッシュボードにはこの領域用のコンポーネントがありません。設定で追加して公開すると、ここに表示されます。",
  "dashboard.eventStreamEyebrow": "サーバーイベントストリーム",
  "dashboard.recentEvents": "最近のコンテキストイベント",
  "dashboard.loadedCount": "{count} 件読み込み済み",
  "dashboard.loadingOlderEvents": "過去のイベントを読み込み中…",
  "dashboard.loadOlderEvents": "過去のイベントを読み込む",
  "dashboard.allEventsLoaded": "利用可能なイベントをすべて読み込みました",
  "dashboard.noEventsAvailable": "利用可能なイベントはありません",
  "dashboard.railAria": "操作、メトリクス、プライバシー",
  "dashboard.audioPromptAria": "保留中のオーディオ介入",
  "dashboard.audioPromptTitle": "現在の声音提案は開始待ちです",
  "dashboard.audioPromptBody":
    "このページでのみ有効で、いつでも一時停止できます。",
  "dashboard.audioPromptStart": "このセッションの声音を開始",
  "dashboard.audioPromptPause": "すぐに声音を一時停止",
  "dashboard.audioPromptDismiss": "提示を閉じる",

  // -- dashboard toolbar ------------------------------------------------------------------
  "dashboard.toolbar.aria": "ダッシュボードの更新制御",
  "dashboard.toolbar.liveRefresh": "ライブ更新",
  "dashboard.toolbar.interval": "間隔",
  "dashboard.toolbar.refreshingState": "ローカル状態を更新中…",
  "dashboard.toolbar.lastRefresh": "最終更新 {time}",
  "dashboard.toolbar.notYetRefreshed": "未更新",
  "dashboard.toolbar.refreshTimeUnavailable": "更新時刻を利用できません",
  "dashboard.toolbar.refreshing": "更新中…",
  "dashboard.toolbar.refreshNow": "今すぐ更新",

  // -- dashboard states ---------------------------------------------------------------------
  "dashboard.states.skeletonAria": "観測台ダッシュボードを読み込み中",
  "dashboard.states.skeletonSr": "ローカル観測台の状態を読み込み中。",
  "dashboard.states.disconnectedTitle": "ローカルサーバーが切断されました",
  "dashboard.states.errorTitle": "観測台を読み込めませんでした",
  "dashboard.states.disconnectedDetail":
    "ダッシュボードはローカルの Fastify サービスに到達できません。既存のサーバー状態がブラウザのみのデータで置き換えられることはありません。",
  "dashboard.states.unreadableDetail":
    "ローカルサーバーが読み取れない応答を返しました。",
  "dashboard.states.connection": "接続",
  "dashboard.states.serverResponse": "サーバー応答",
  "dashboard.states.retryConnection": "ローカル接続を再試行",
  "dashboard.states.emptyEyebrow": "エビデンス待ち",
  "dashboard.states.emptyTitle": "観測台の状態はまだありません",
  "dashboard.states.emptyBody":
    "ローカルサーバーが空の権威スナップショットを返しました。イベントが到着するまで Muses を実行し続けてください。このページはデモの信念や決定を作成しません。",
  "dashboard.states.staleTitle": "最後のサーバースナップショットを表示中。",
  "dashboard.states.staleDefault":
    "スナップショットがサーバーの鮮度ウィンドウを超えています。",
  "dashboard.states.dismissError": "エラーを閉じる",

  // -- registry slot degraded boundary --------------------------------------------------------
  "dashboard.slot.degradedEyebrow": "コンポーネント利用不可",
  "dashboard.slot.degradedBody":
    "このレジストリコンポーネントを描画できませんでした。ダッシュボードの他の領域は利用可能です。",

  // -- dashboard surface titles -----------------------------------------------------------------
  "dashboard.surface.state.hero": "現在の状態",
  "dashboard.surface.belief.distribution": "信念分布",
  "dashboard.surface.evidence.list": "エビデンス",
  "dashboard.surface.events.timeline": "イベントタイムライン",
  "dashboard.surface.decision.card": "決定の根拠",
  "dashboard.surface.audio.control": "オーディオ効果",
  "dashboard.surface.metrics.grid": "メトリクス",
  "dashboard.surface.privacy.status": "プライバシー状態",
  "dashboard.surface.llm.narration": "AI 解説",

  // -- registry: state hero -----------------------------------------------------------------------
  "registry.stateHero.title": "現在の状態",
  "registry.stateHero.beliefConfidence": "信念の信頼度",
  "registry.stateHero.updated": "更新 {time}",

  // -- registry: belief distribution ----------------------------------------------------------------
  "registry.beliefDistribution.title": "信念分布",
  "registry.beliefDistribution.supports": "支持",
  "registry.beliefDistribution.opposes": "反対",
  "registry.beliefDistribution.neutral": "中立",
  "registry.beliefDistribution.probabilityAria": "{label} の確率",
  "registry.beliefDistribution.evidenceItem": "エビデンス {count} 件",
  "registry.beliefDistribution.evidenceItems": "エビデンス {count} 件",

  // -- registry: evidence list -----------------------------------------------------------------------
  "registry.evidenceList.title": "エビデンス",
  "registry.evidenceList.empty": "検証済みのエビデンスはまだありません。",

  // -- registry: events timeline -----------------------------------------------------------------------
  "registry.eventsTimeline.title": "イベント",
  "registry.eventsTimeline.empty": "記録されたイベントはまだありません。",

  // -- registry: decision card --------------------------------------------------------------------------
  "registry.decisionCard.title": "決定",
  "registry.decisionCard.confidence": "決定の信頼度",
  "registry.decisionCard.expires": "{time} に期限切れ",
  "registry.decisionCard.undo": "決定を取り消す",

  // -- registry: audio control ---------------------------------------------------------------------------
  "registry.audioControl.title": "オーディオ制御",
  "registry.audioControl.noTrack": "トラック未選択",
  "registry.audioControl.playing": "オーディオ再生中",
  "registry.audioControl.paused": "オーディオ一時停止中",
  "registry.audioControl.volume": "音量：{percent}%",
  "registry.audioControl.unmute": "ミュート解除",
  "registry.audioControl.mute": "ミュート",

  // -- registry: metrics grid ---------------------------------------------------------------------------
  "registry.metricsGrid.title": "メトリクス",
  "registry.metricsGrid.increasing": "上昇中",
  "registry.metricsGrid.decreasing": "下降中",
  "registry.metricsGrid.stable": "安定",
  "registry.metricsGrid.unknownTrend": "トレンド不明",

  // -- registry: privacy status ---------------------------------------------------------------------------
  "registry.privacyStatus.title": "プライバシー状態",
  "registry.privacyStatus.localOnly": "ローカルのみ",
  "registry.privacyStatus.notLocal": "ローカルのみではない",
  "registry.privacyStatus.activeSensors": "稼働中のセンサー",
  "registry.privacyStatus.none": "なし",
  "registry.privacyStatus.retention": "保持期間",
  "registry.privacyStatus.pendingDeletion": "削除待ち",
  "registry.privacyStatus.lastExport": "最終エクスポート",

  // -- registry: llm narration ----------------------------------------------------------------------------
  "registry.llmNarration.title": "AI 解説",
  "registry.llmNarration.disclosure":
    "有効時、このパネルは現在の信念サマリーとイベント数を —— ファイルの内容やパスは決して —— 設定済みのローカルネットワークゲートウェイへ送信します。出力は表示専用です。",
  "registry.llmNarration.cooldown": "クールダウン",
  "registry.llmNarration.cooldownDetail":
    "一時的に利用できません —— しばらくしてから再試行してください。",
  "registry.llmNarration.generating": "生成中…",
  "registry.llmNarration.generatedBy": "{model} により生成 · {time}",
  "registry.llmNarration.unknownModel": "不明なモデル",
  "registry.llmNarration.unknownTime": "不明な時刻",
  "registry.llmNarration.explain": "現在の状態を解説",
  "registry.llmNarration.summarize": "直近 1 時間を要約",
  "registry.llmNarration.retry": "再試行",

  // -- registry: safe fallback ------------------------------------------------------------------------------
  "registry.safeFallback.title": "コンポーネント利用不可",
  "registry.safeFallback.requested": "要求：{type}",
  "registry.safeFallback.reason": "理由：{reason}",
  "registry.safeFallback.dashboardInvalid":
    "ダッシュボード設定が無効なため描画されませんでした。",
  "registry.safeFallback.dashboardSchemaVersion":
    "このダッシュボードスキーマバージョンはサポートされていません。",
  "registry.safeFallback.componentUnknownType":
    "このコンポーネント型は登録されていません。",
  "registry.safeFallback.componentInvalidProps":
    "このコンポーネントは無効な設定を受け取りました。",
  "registry.safeFallback.componentSchemaVersion":
    "このコンポーネントのスキーマバージョンはサポートされていません。",
  "registry.safeFallback.componentMissingCapability":
    "必要なローカル能力が欠けているため、このコンポーネントは利用できません。",
  "registry.safeFallback.componentRenderError":
    "このコンポーネントは安全に失敗し、ダッシュボードの他の部分から隔離されました。",

  // -- foundation status page ---------------------------------------------------------------------------------
  "foundation.status.eyebrow": "Muses v0.1 · 基盤シェル",
  "foundation.status.title":
    "ローカルコンテキストランタイム。モジュール統合の準備ができました。",
  "foundation.status.lede":
    "この最小構成の画面は、React シェルと Fastify ローカルサービスを検証します。製品モジュールがすべてのドメイン動作を持ち、型付き合成フックを通じて登録されます。",
  "foundation.status.localAuthority": "ローカルサービス",
  "foundation.status.checking": "ループバックのヘルスを確認中…",
  "foundation.status.authorityUnavailable":
    "ローカルサービスにアクセスできません。",
  "foundation.status.connected":
    "接続済み · バージョン {version} · 稼働 {seconds} 秒",
  "foundation.status.notConnected": "未接続",
  "foundation.status.connectedAria": "接続済み",
  "foundation.status.securityNote":
    "ローカル専用の境界。ループバックバインドとオリジン検証により露出は減りますが、このプロトタイプは認証されたマルチユーザーの本番サービスではありません。",

  // -- root error boundary --------------------------------------------------------------------------------------
  "foundation.errorBoundary.eyebrow": "ローカルインターフェースエラー",
  "foundation.errorBoundary.title":
    "Muses はこのビューを描画できませんでした。",
  "foundation.errorBoundary.body":
    "リモートへの報告は送信されませんでした。ローカルビューを再試行してください。解消しない場合はローカル開発ログを確認してください。",
  "foundation.errorBoundary.retry": "ビューを再試行",

  // -- dashboard hooks: user-facing errors -------------------------------------------------------------------------
  "dashboard.errors.manualNeedsEffect":
    "手動の再生コマンドには現在のスナップショットの効果が必要です。",
  "dashboard.errors.outcomeDeclined":
    "ローカルサーバーは報告された効果の結果を拒否しました。",
  "dashboard.errors.audioCommandFailed":
    "オーディオエンジンはそのコマンドを完了できませんでした。",
  "dashboard.errors.generationFailed": "生成に失敗しました。",

  // -- dashboard API parse errors ------------------------------------------------------------------------------------
  "api.error.expectedString": '"{key}" は文字列である必要があります。',
  "api.error.expectedStringWhenPresent":
    '"{key}" は存在する場合文字列である必要があります。',
  "api.error.expectedFiniteNumber":
    '"{key}" は有限の数値である必要があります。',
  "api.error.expectedBoolean": '"{key}" は真偽値である必要があります。',
  "api.error.expectedObject": '"{key}" はオブジェクトである必要があります。',
  "api.error.expectedArrayWhenPresent":
    '"{key}" は存在する場合配列である必要があります。',
  "api.error.unsupportedValue": '"{key}" の値はサポートされていません：{value}',
  "api.error.expectedUnitInterval":
    '"{key}" は 0 から 1 の間である必要があります。',
  "api.error.expectedIsoDate":
    '"{key}" は ISO 日時文字列である必要があります。',
  "api.error.expectedPrivacyObject":
    "プライバシーペイロードはオブジェクトである必要があります。",
  "api.error.privacyNotLocalOnly":
    "厳密にローカル専用でない、またはクラウド／API キー能力を報告するプライバシーペイロードを観測台は拒否しました。",
  "api.error.expectedCapabilityObject":
    "各プライバシー能力はオブジェクトである必要があります。",
  "api.error.expectedStringArray":
    '"{key}" は文字列の配列である必要があります。',
  "api.error.expectedStringArrayEntries":
    '"{key}" の各要素は文字列である必要があります。',
  "api.error.expectedEvidenceObject":
    "各信念エビデンスはオブジェクトである必要があります。",
  "api.error.expectedFactorObject":
    "各信念因子はオブジェクトである必要があります。",
  "api.error.expectedBeliefObject":
    "信念スナップショットはオブジェクトである必要があります。",
  "api.error.expectedDecisionFactorObject":
    "各決定因子はオブジェクトである必要があります。",
  "api.error.expectedDecisionObject":
    "決定はオブジェクトである必要があります。",
  "api.error.expectedEffectObjectOrNull":
    '"effect" はオブジェクトまたは null である必要があります。',
  "api.error.expectedOutcomeObject":
    "効果の結果はオブジェクトである必要があります。",
  "api.error.unsupportedOutcomeStatus":
    "サポートされていない結果ステータスです：{status}",
  "api.error.expectedLedgerObject":
    "効果台帳のエントリーはオブジェクトである必要があります。",
  "api.error.expectedSettingsObject":
    "設定応答はオブジェクトである必要があります。",
  "api.error.expectedCurrentRelease":
    '"currentRelease" はオブジェクトまたは null である必要があります。',
  "api.error.expectedCurrentReleaseDocument":
    '"currentRelease.document" はオブジェクトである必要があります。',
  "api.error.expectedAudioPrivacyObjects":
    "設定ドキュメントには audio と privacy のオブジェクトが含まれる必要があります。",
  "api.error.expectedContextEventObject":
    "各コンテキストイベントはオブジェクトである必要があります。",
  "api.error.expectedSnapshotObject":
    "観測台スナップショットはオブジェクトである必要があります。",
  "api.error.expectedSnapshotKey":
    '観測台スナップショットには "{key}" が含まれる必要があります。',
  "api.error.expectedPrivacyPayloadLocalOnly":
    "厳密にローカル専用でないプライバシーペイロードを観測台は拒否しました。",
  "api.error.expectedEventPageObject":
    "イベントページはオブジェクトである必要があります。",
  "api.error.expectedNextCursor":
    '"nextCursor" は文字列、null、または省略である必要があります。',
  "api.error.expectedHasMoreBoolean":
    '"hasMore" は存在する場合真偽値である必要があります。',
  "api.error.expectedCursorWhenHasMore":
    '"hasMore" が true の場合 "nextCursor" は null 以外である必要があります。',
  "api.error.expectedEventObject":
    "各イベントはオブジェクトである必要があります。",
  "api.error.expectedMetadataJson":
    'イベントの "metadata" は JSON 互換の値である必要があります。',
  "api.error.expectedEffectResultObject":
    "効果コマンドの結果はオブジェクトである必要があります。",
  "api.error.unknownEffect":
    "ローカルサーバーはこの効果を追跡しなくなりました。",
  "api.error.expectedLlmObject":
    "LLM 生成結果はオブジェクトである必要があります。",
  "api.error.expectedModelLength":
    '"model" は 128 文字以下の空でない文字列である必要があります。',
  "api.error.expectedBootstrapObject":
    "bootstrap 応答はオブジェクトである必要があります。",
  "api.error.invalidJsonDetail": "サーバーが無効な JSON を返しました：{detail}",
  "api.error.invalidJson": "サーバーが無効な JSON を返しました。",
  "api.error.requestAborted": "リクエストは中止されました。",
  "api.error.unreachable": "ローカルの Muses サーバーに到達できません。",
  "api.error.httpStatus":
    "ローカルの Muses サーバーが HTTP {status} を返しました。",
  "api.error.effectIdRequired":
    "効果の結果には現在の観測台スナップショットの effectId が必要です。",
  "api.error.unknownDashboardError": "不明な観測台エラーです。",

  // -- auth（サインイン / 登録 / ユーザー管理）-----------------------------------

  "auth.gate.checking": "セッションを確認しています…",
  "auth.session.signOut": "サインアウト",
  "auth.session.adminLink": "ユーザー管理",
  "auth.session.settingsLink": "設定",
  "auth.error.network": "Muses サーバーに接続できません。",
  "auth.error.sessionExpired":
    "セッションが期限切れです。再度サインインしてください。",

  // -- サインイン -----------------------------------------------------------------
  "auth.login.title": "サインイン",
  "auth.login.subtitle":
    "Muses アカウントのメールアドレスとパスワードを入力してください。",
  "auth.login.emailLabel": "メールアドレス",
  "auth.login.passwordLabel": "パスワード",
  "auth.login.submit": "サインイン",
  "auth.login.submitting": "サインイン中…",
  "auth.login.toRegister": "アカウントをお持ちでない場合は作成",

  // -- 登録 -----------------------------------------------------------------------
  "auth.register.title": "アカウント作成",
  "auth.register.subtitle":
    "メールの確認コードを取得してから、パスワードを設定します。",
  "auth.register.stepsAria": "登録ステップ",
  "auth.register.stepEmail": "メール",
  "auth.register.stepVerify": "確認",
  "auth.register.stepDone": "完了",
  "auth.register.emailLabel": "メールアドレス",
  "auth.register.emailPlaceholder": "you@example.com",
  "auth.register.sendCode": "コードを送信",
  "auth.register.sending": "送信中…",
  "auth.register.invalidEmail": "有効なメールアドレスを入力してください。",
  "auth.register.changeEmail": "メールアドレスを変更",
  "auth.register.codeLabel": "確認コード",
  "auth.register.codePlaceholder": "6 桁のコード",
  "auth.register.codeSent": "コードを送信しました。メールをご確認ください。",
  "auth.register.devCode": "開発用コード: {code}",
  "auth.register.resend": "再送信",
  "auth.register.resendIn": "{seconds} 秒後に再送信できます",
  "auth.register.codeRequired": "メールの確認コードを入力してください。",
  "auth.register.passwordLabel": "パスワード",
  "auth.register.passwordHint": "6 文字以上。",
  "auth.register.passwordTooShort": "パスワードは 6 文字以上にしてください。",
  "auth.register.displayNameLabel": "表示名（任意）",
  "auth.register.displayNamePlaceholder": "空欄ならメールの先頭部分を使用",
  "auth.register.submit": "アカウントを作成",
  "auth.register.submitting": "作成中…",
  "auth.register.doneTitle": "アカウントを作成しました",
  "auth.register.doneBody": "ようこそ、{name}さん。サインイン済みです。",
  "auth.register.continue": "続ける",
  "auth.register.toLogin": "アカウントをお持ちですか？サインイン",

  // -- ユーザー管理 -----------------------------------------------------------------
  "auth.admin.title": "ユーザー管理",
  "auth.admin.subtitle": "ローカルアカウントの有効化・無効化・削除。",
  "auth.admin.loading": "ユーザーを読み込み中…",
  "auth.admin.loadFailed": "ユーザー一覧を読み込めませんでした。",
  "auth.admin.actionFailed": "操作に失敗しました。",
  "auth.admin.empty": "ユーザーはまだいません。",
  "auth.admin.statsTotal": "ユーザー",
  "auth.admin.statsAdmins": "管理者",
  "auth.admin.statsDisabled": "無効",
  "auth.admin.colUser": "ユーザー",
  "auth.admin.colRole": "役割",
  "auth.admin.colStatus": "状態",
  "auth.admin.colCreatedAt": "作成日時",
  "auth.admin.colActions": "操作",
  "auth.admin.roleAdmin": "管理者",
  "auth.admin.roleUser": "ユーザー",
  "auth.admin.active": "有効",
  "auth.admin.disabled": "無効",
  "auth.admin.activate": "有効化",
  "auth.admin.deactivate": "無効化",
  "auth.admin.delete": "削除",
  "auth.admin.confirmDelete": "削除を確定",
  "auth.admin.processing": "処理中…",
  "auth.admin.selfProtected": "自分のアカウントはここで操作できません。",
  "auth.admin.deniedTitle": "管理者のみ",
  "auth.admin.deniedBody":
    "ユーザーを管理するには管理者アカウントでサインインしてください。",
  // -- v0.7 self-track player (batch 1, C path) ---------------------------
  "player.title": "セルフトラック",
  "player.subtitle": "バイブシグナルが奏でる、あなたの状態。",
  "player.state.idle": "待機中",
  "player.state.playing": "再生中",
  "player.state.crossfading": "クロスフェード中",
  "player.state.ended": "終了",
  "player.control.start": "開始",
  "player.control.stop": "停止",
  "player.control.skip": "スキップ",
  "player.nowPlaying.label": "再生中",
  "player.attribution.label": "ライセンス",
  "player.plan.localStubNotice":
    "ローカル計画 — サーバーの再生計画 API は未接続です。",

  // -- v0.7 vibe signature (batch 1, C path) ------------------------------
  "signature.title": "バイブシグネチャ",
  "signature.subtitle":
    "状態を音楽へどう映射するか。v0 はテンプレートと手動調整。",
  "signature.template.minimalElectronic.name": "ミニマル・エレクトロニカ",
  "signature.template.minimalElectronic.description":
    "深い集中のための安定したパルス。約 118–138 BPM、上限付きエネルギー、疎なボーカル。",
  "signature.template.ambient.name": "アンビエント",
  "signature.template.ambient.description":
    "平穏と回復のためのテクスチャー。約 60–80 BPM、低エネルギー、ボーカルなし。",
  "signature.template.lofiJazz.name": "ローファイ・ジャズ",
  "signature.template.lofiJazz.description":
    "ゆったりした作業のためのダスティなコード。約 70–90 BPM、中エネルギー、軽いボーカル。",
  "signature.calibration.bpmMin.label": "BPM 下限",
  "signature.calibration.bpmMax.label": "BPM 上限",
  "signature.calibration.energyCap.label": "エネルギー上限",
  "signature.calibration.vocalDensity.label": "ボーカル密度",
  "signature.calibration.vocalDensity.none": "なし",
  "signature.calibration.vocalDensity.low": "低",
  "signature.calibration.vocalDensity.medium": "中",
  "signature.calibration.vocalDensity.high": "高",
  "signature.calibration.error.bpmRange":
    "BPM は 40 ≤ 下限 < 上限 ≤ 200 を満たす必要があります。",
  "signature.summary.heading": "有効なシグネチャ",
  "signature.summary.bpm": "BPM レンジ",
  "signature.summary.energyCap": "エネルギー上限",
  "signature.summary.vocalDensity": "ボーカル密度",
  "signature.journal.notice":
    "スキップと再聴は記録のみで、学習にはまだ使いません。",

  // -- v0.7 journey replay (batch 2, D path) ------------------------------
  "replay.title": "リプレイ",
  "replay.subtitle": "一日をタイムラインに — ドラッグして各状態を見返せます。",
  "replay.loading": "ジャーニーを読み込み中…",
  "replay.empty": "まだジャーニーが記録されていません。",
  "replay.error": "リプレイは利用できません：",
};
