/**
 * Catalogue de messages en français. L'ensemble des clés est identique à
 * en.ts (forcé à la compilation par Record<MessageKey, string>).
 *
 * Glossaire :
 *   Muses —— nom de produit, non traduit
 *   Observatory —— l'Observatoire
 *   rollback —— retour arrière
 *   publish/release —— publier / version
 *   draft —— brouillon
 *   belief —— croyance
 *   snapshot —— instantané
 *   soundscape —— paysage sonore
 *   gain —— gain
 *   widget —— composant
 *   narration —— narration
 */
import type { MessageKey } from "./en";

export const fr: Record<MessageKey, string> = {
  // -- shared ----------------------------------------------------------------
  "common.yes": "Oui",
  "common.no": "Non",
  "common.cancel": "Annuler",
  "common.retry": "Réessayer",
  "common.dismiss": "Fermer",
  "common.publish": "Publier",

  // -- settings workspace chrome ---------------------------------------------
  "settings.workspace.title": "Paramètres",
  "settings.workspace.subtitle":
    "Brouillon, aperçu, publication, historique et retour arrière pour le runtime Muses local.",
  "settings.workspace.unsavedEdits": "Modifications locales non enregistrées",
  "settings.workspace.draftSaved": "Brouillon enregistré sur le serveur",
  "settings.workspace.loading": "Chargement des paramètres…",
  "settings.workspace.unavailable": "Paramètres indisponibles",
  "settings.workspace.versionsAria": "Versions des paramètres",
  "settings.workspace.draftBadge": "Brouillon — inactif",
  "settings.workspace.revisionLabel": "révision {revision}",
  "settings.workspace.publishedBadge": "Publié — actif",
  "settings.workspace.errorTitle": "Échec de l'opération de paramètres",
  "settings.workspace.dismissNoticeAria": "Fermer la notification",
  "settings.workspace.navigationAria": "Catégories de paramètres",
  "settings.workspace.draftActionsAria": "Actions du brouillon",
  "settings.workspace.saving": "Enregistrement…",
  "settings.workspace.saveDraft": "Enregistrer le brouillon",
  "settings.workspace.generating": "Génération…",
  "settings.workspace.previewDraft": "Apercevoir le brouillon",
  "settings.workspace.saveBeforePreviewTitle":
    "Enregistrez le brouillon avant l'aperçu.",
  "settings.workspace.savePreviewFirstTitle":
    "Enregistrez et apercevez le brouillon avant de publier.",
  "settings.workspace.preflightNotice":
    "La vérification locale a trouvé des problèmes bloquants. Le serveur reste l'autorité et n'a pas été contacté.",
  "settings.workspace.draftSavedNotice":
    "Brouillon révision {revision} enregistré sur le serveur local.",
  "settings.workspace.saveReason":
    "Modification de l'espace de paramètres : {section}",
  "settings.workspace.publishedNotice":
    "Publié. La nouvelle version est désormais le runtime actif.",
  "settings.workspace.rollbackReason": "Retour arrière vers r{releaseNumber}",
  "settings.workspace.rolledBackNotice":
    "Retour arrière vers r{releaseNumber} effectué comme nouvelle version. L'historique est inchangé.",
  "settings.workspace.reloadedNotice":
    "Brouillon du serveur rechargé. Les modifications locales non enregistrées ont été abandonnées.",
  "settings.workspace.readinessTitle": "Prêt à publier",
  "settings.workspace.readinessDescription":
    "La publication exige un brouillon enregistré avec un aperçu serveur à jour.",
  "settings.workspace.readinessSavedDraft": "Brouillon enregistré",
  "settings.workspace.readinessPreviewCurrent": "Aperçu à jour",
  "settings.workspace.readinessChanges": "Différences vs publié",
  "settings.workspace.readinessUnknown": "Inconnu",
  "settings.workspace.readinessPublishReady": "Prêt à publier",
  "settings.workspace.serverUnreachable":
    "Le serveur de paramètres local est injoignable.",
  "settings.workspace.previewNoChanges":
    "Aucune modification par rapport à la version publiée.",
  "settings.workspace.previewChangesSummary":
    "{count} modification(s) sur {sections}.",

  // -- settings sections (navigation cards) -----------------------------------
  "settings.section.appearance.label": "Apparence",
  "settings.section.appearance.description": "Thème, densité, animations",
  "settings.section.belief.label": "Croyance",
  "settings.section.belief.description": "Confiance et fraîcheur",
  "settings.section.decision.label": "Décision",
  "settings.section.decision.description": "Repos et heures calmes",
  "settings.section.signals.label": "Signaux",
  "settings.section.signals.description": "Sources et pondérations",
  "settings.section.audio.label": "Audio",
  "settings.section.audio.description": "Profils et limites de gain",
  "settings.section.privacy.label": "Confidentialité",
  "settings.section.privacy.description": "Rétention et exclusions",
  "settings.section.llm.label": "Narration IA",
  "settings.section.llm.description": "Amélioration d'affichage optionnelle",
  "settings.section.surface.label": "Observatoire",
  "settings.section.surface.description": "Composants et ordre",

  // -- appearance editor -------------------------------------------------------
  "settings.editor.appearance.title": "Apparence",
  "settings.editor.appearance.description":
    "Présentation de l'enveloppe locale. Autoritaire côté serveur comme chaque section — c'est la publication qui active une modification.",
  "settings.editor.appearance.productName": "Nom du produit",
  "settings.editor.appearance.productNameHelp":
    "Affiché dans l'en-tête de l'enveloppe.",
  "settings.editor.appearance.theme": "Thème",
  "settings.editor.appearance.themeSystem": "Suivre le système",
  "settings.editor.appearance.themeLight": "Clair",
  "settings.editor.appearance.themeDark": "Sombre",
  "settings.editor.appearance.accentColor": "Couleur d'accent",
  "settings.editor.appearance.accentHelp":
    "Hexadécimal à six chiffres, par exemple #6c8cff.",
  "settings.editor.appearance.density": "Densité",
  "settings.editor.appearance.densityComfortable": "Confortable",
  "settings.editor.appearance.densityCompact": "Compacte",
  "settings.editor.appearance.reducedMotion":
    "Réduire les animations non essentielles",
  "settings.editor.appearance.language": "Langue",

  // -- belief editor -----------------------------------------------------------
  "settings.editor.belief.title": "Croyance",
  "settings.editor.belief.description":
    "Seuils que le projecteur déterministe doit franchir avant qu'un état soit considéré comme connu. UNKNOWN reste un résultat de premier ordre.",
  "settings.editor.belief.minimumConfidence": "Confiance minimale",
  "settings.editor.belief.minimumConfidenceHelp":
    "En dessous, le moteur de décision renvoie NO_ACTION.",
  "settings.editor.belief.minimumMargin": "Marge minimale",
  "settings.editor.belief.minimumMarginHelp":
    "Écart requis de l'état de tête sur son challenger.",
  "settings.editor.belief.stabilityWindow": "Fenêtre de stabilité (ms)",
  "settings.editor.belief.stabilityWindowHelp":
    "Une croyance plus ancienne que cette fenêtre est considérée comme périmée.",
  "settings.editor.belief.note":
    "Le vocabulaire d'états est fixé à {states} et l'état inconnu est toujours UNKNOWN. Les deux sont structurels et ne peuvent pas être modifiés.",

  // -- decision editor ---------------------------------------------------------
  "settings.editor.decision.title": "Décision",
  "settings.editor.decision.description":
    "Quand l'automatisation peut agir. Seuls les ajustements audio réversibles peuvent s'exécuter ; l'entrée manuelle prime toujours.",
  "settings.editor.decision.cooldown": "Repos après commande manuelle (ms)",
  "settings.editor.decision.cooldownHelp":
    "Après un changement audio manuel, l'automatisation s'efface pendant cette durée.",
  "settings.editor.decision.undoWindow": "Fenêtre d'annulation manuelle (ms)",
  "settings.editor.decision.undoWindowHelp":
    "Durée pendant laquelle un effet appliqué reste réversible.",
  "settings.editor.decision.quietHours": "Activer les heures calmes",
  "settings.editor.decision.quietFrom": "Calme à partir de",
  "settings.editor.decision.quietUntil": "Calme jusqu'à",
  "settings.editor.decision.note":
    "Les heures calmes suivent l'horloge locale et peuvent franchir minuit. Pendant une heure calme, le moteur renvoie NO_ACTION avec la raison QUIET_HOURS. Les croyances inconnues ou de faible confiance aboutissent toujours à NO_ACTION, et les effets sont toujours réversibles — c'est structurel et non modifiable.",

  // -- signals editor ----------------------------------------------------------
  "settings.editor.signals.title": "Signaux",
  "settings.editor.signals.description":
    "L'activation des signaux, leur poids et la conservation brute ne sont pas encore appliqués et ne peuvent pas être modifiés dans cette bêta.",
  "settings.editor.signals.ideActivity": "Activité IDE",
  "settings.editor.signals.gitActivity": "Activité Git",
  "settings.editor.signals.appFocus": "Focus applicatif",
  "settings.editor.signals.terminalActivity": "Activité du terminal",
  "settings.editor.signals.manualFeedback": "Retour manuel",
  "settings.editor.signals.enabled": "Activé",
  "settings.editor.signals.retainRaw": "Conserver la charge brute",
  "settings.editor.signals.weight": "Poids",

  // -- audio editor ------------------------------------------------------------
  "settings.editor.audio.title": "Audio",
  "settings.editor.audio.description":
    "Le seul exécuteur autorisé à agir automatiquement. Chaque changement est rampe de gain et réversible.",
  "settings.editor.audio.allowAutomatic":
    "Autoriser l'ajustement audio automatique",
  "settings.editor.audio.masterGain": "Plafond de gain principal",
  "settings.editor.audio.masterGainHelp":
    "Borne supérieure stricte ; les gains par état y sont bornés.",
  "settings.editor.audio.soundscape": "Paysage sonore",
  "settings.editor.audio.targetGain": "Gain cible",
  "settings.editor.audio.ramp": "Rampe (ms)",
  "settings.editor.audio.unknownNote":
    "UNKNOWN doit rester silencieux : aucun paysage sonore et gain nul.",

  // -- llm editor --------------------------------------------------------------
  "settings.editor.llm.title": "Narration IA",
  "settings.editor.llm.description":
    "Une amélioration d'affichage optionnelle. Tout le reste de Muses fonctionne exactement pareil sans elle.",
  "settings.editor.llm.enable": "Activer la narration IA (optionnel)",
  "settings.editor.llm.enableHelp":
    "Désactivée par défaut. L'application est pleinement fonctionnelle sans elle.",
  "settings.editor.llm.model": "Alias du modèle",
  "settings.editor.llm.modelHelp":
    "`auto` laisse la passerelle choisir le modèle à chaque requête — il peut différer à chaque fois.",
  "settings.editor.llm.note":
    "L'adresse et les identifiants de la passerelle viennent de l'environnement de déploiement et ne sont jamais stockés dans les paramètres. Le texte généré est purement affichage.",

  // -- privacy editor ----------------------------------------------------------
  "settings.editor.privacy.title": "Confidentialité",
  "settings.editor.privacy.description":
    "La rétention concerne les nouveaux événements bruts. Les contrôles de l'historique, des exclusions et de capture d'écran ne sont pas encore implémentés.",
  "settings.editor.privacy.rawEventRetention":
    "Rétention des événements bruts (heures)",
  "settings.editor.privacy.rawEventRetentionHelp":
    "Après publication, seuls les nouveaux événements sont concernés. Zéro désactive leur collecte. Les événements expirés sont supprimés par lots, sans effacer les données anciennes, les sauvegardes ni l'espace libre SQLite. Les lignes expirées encore présentes restent accessibles par l'API historique ; la rétention n'est pas un contrôle d'accès.",
  "settings.editor.privacy.sessionHistoryRetention":
    "Rétention de l'historique de session (jours)",
  "settings.editor.privacy.captureScreenContent":
    "Capturer le contenu de l'écran",
  "settings.editor.privacy.excludedApplications": "Applications exclues",
  "settings.editor.privacy.excludedApplicationsHelp":
    "Un bundle id ou identifiant d'application stable par ligne.",

  // -- dashboard (surface) editor ----------------------------------------------
  "settings.editor.surface.title": "Composants de l'Observatoire",
  "settings.editor.surface.description":
    "Seuls les huit schémas de composants statiques sont acceptés. Pas de HTML, JavaScript ni imports dynamiques.",
  "settings.editor.surface.componentType": "Type de composant",
  "settings.editor.surface.addComponent": "Ajouter un composant",
  "settings.editor.surface.empty":
    "Aucun composant d'Observatoire. Publier une surface vide laisse l'Observatoire sans rien à afficher.",
  "settings.editor.surface.orderAria": "Ordre des composants de l'Observatoire",
  "settings.editor.surface.componentAria": "Composant {label} {index}",
  "settings.editor.surface.moveUp": "Monter",
  "settings.editor.surface.moveDown": "Descendre",
  "settings.editor.surface.remove": "Retirer",
  "settings.editor.surface.removeAria": "Retirer {label}",
  "settings.editor.surface.stableId": "Id stable",
  "settings.editor.surface.stableIdHelp":
    "Lettres, chiffres, point, deux-points, tiret bas ou trait d'union.",
  "settings.editor.surface.showConfidence": "Afficher la confiance",
  "settings.editor.surface.showUnknownReason":
    "Afficher la raison de l'inconnu",
  "settings.editor.surface.maxStates": "États max",
  "settings.editor.surface.showFactorContributions":
    "Afficher les contributions des facteurs",
  "settings.editor.surface.limit": "Limite",
  "settings.editor.surface.showSource": "Afficher la source",
  "settings.editor.surface.showPayloadSummary": "Afficher le résumé de charge",
  "settings.editor.surface.showNoAction": "Afficher les décisions NO_ACTION",
  "settings.editor.surface.showUndoAvailability":
    "Afficher la disponibilité d'annulation",
  "settings.editor.surface.allowManualOverride": "Autoriser le contrôle manuel",
  "settings.editor.surface.showMasterVolume": "Afficher le volume principal",
  "settings.editor.surface.metrics": "Métriques",
  "settings.editor.surface.showRetention": "Afficher la rétention",
  "settings.editor.surface.showExcludedApplications":
    "Afficher les applications exclues",
  "settings.editor.surface.showModelAttribution":
    "Afficher l'attribution du modèle",

  // -- widget definitions (surface editor pick list + preview) ------------------
  "settings.widget.stateHero.label": "Carte d'état",
  "settings.widget.stateHero.description":
    "État de croyance courant, confiance et raison de l'inconnu.",
  "settings.widget.beliefDistribution.label": "Distribution de croyance",
  "settings.widget.beliefDistribution.description":
    "Probabilités sur les états candidats avec poids des facteurs.",
  "settings.widget.evidenceList.label": "Liste de preuves",
  "settings.widget.evidenceList.description":
    "Événements qui ont déplacé la croyance courante, plus récents d'abord.",
  "settings.widget.eventsTimeline.label": "Chronologie des événements",
  "settings.widget.eventsTimeline.description":
    "Événements de contexte bruts dans l'ordre d'arrivée.",
  "settings.widget.decisionCard.label": "Carte de décision",
  "settings.widget.decisionCard.description":
    "La décision de politique active et pourquoi elle a été choisie.",
  "settings.widget.audioControl.label": "Contrôle audio",
  "settings.widget.audioControl.description":
    "Transport du paysage sonore, profil et contrôle manuel.",
  "settings.widget.metricsGrid.label": "Grille de métriques",
  "settings.widget.metricsGrid.description":
    "Compteurs glissants pour la santé de la croyance et des effets.",
  "settings.widget.privacyStatus.label": "Statut de confidentialité",
  "settings.widget.privacyStatus.description":
    "Posture local uniquement, rétention et exclusions.",
  "settings.widget.llmNarration.label": "Narration IA",
  "settings.widget.llmNarration.description":
    "Panneau d'explication en texte simple, optionnel et déclenché par l'utilisateur.",

  // -- preview panel -------------------------------------------------------------
  "settings.preview.draftBadge": "Aperçu du brouillon — inactif",
  "settings.preview.title": "Aperçu contre r{releaseNumber}",
  "settings.preview.body":
    "La version publiée reste r{releaseNumber}. L'aperçu est résolu par le serveur local et n'exécute aucun effet.",
  "settings.preview.close": "Fermer l'aperçu",
  "settings.preview.validationPassed":
    "Validation serveur réussie pour ce document.",
  "settings.preview.changedPaths": "Chemins modifiés ({count})",
  "settings.preview.identical":
    "Ce document est identique à la version publiée. Le publier créerait une version sans changement fonctionnel.",

  // -- release history -----------------------------------------------------------
  "settings.release.title": "Historique des versions",
  "settings.release.description":
    "Enregistrements de publication immuables du serveur de paramètres local.",
  "settings.release.empty": "Aucune version publiée n'est disponible.",
  "settings.release.published": "Publiée",
  "settings.release.rollbackBadge": "Retour arrière",
  "settings.release.publishedBy": "Publiée par {actor}",
  "settings.release.current": "Version actuelle",
  "settings.release.rollBackToThis": "Revenir à cette version",

  // -- publish dialog --------------------------------------------------------------
  "settings.dialog.publish.defaultSummary":
    "Publier le brouillon de paramètres revu",
  "settings.dialog.publish.title": "Publier le brouillon de paramètres",
  "settings.dialog.publish.description":
    "La publication remplace les paramètres actifs autoritaires côté serveur. La version précédente reste disponible pour un retour arrière.",
  "settings.dialog.publish.summaryLabel": "Résumé de version",
  "settings.dialog.publish.acknowledge":
    "J'ai revu l'aperçu du brouillon et je comprends que la publication change les paramètres actifs.",
  "settings.dialog.publish.publishing": "Publication…",

  // -- rollback dialog --------------------------------------------------------------
  "settings.dialog.rollback.title": "Retour arrière des paramètres publiés",
  "settings.dialog.rollback.body":
    "Cela crée une nouvelle version à partir de r{releaseNumber}. L'historique n'est pas supprimé.",
  "settings.dialog.rollback.warning":
    "Les paramètres actuellement actifs seront remplacés. Saisissez ROLLBACK en anglais pour continuer.",
  "settings.dialog.rollback.phraseLabel": "Phrase de confirmation",
  "settings.dialog.rollback.rollingBack": "Retour arrière…",
  "settings.dialog.rollback.rollBack": "Revenir en arrière",

  // -- conflict dialog ----------------------------------------------------------------
  "settings.dialog.conflict.title": "Paramètres modifiés sur le serveur",
  "settings.dialog.conflict.body":
    "Le serveur a refusé l'écriture sur {field} : il attendait {expected} mais détient {actual}. Rien n'a été écrasé.",
  "settings.dialog.conflict.reloadTitle": "Recharger depuis le serveur",
  "settings.dialog.conflict.reloadDescription":
    "Abandonner les modifications locales non enregistrées et charger le brouillon et la version autoritaires du serveur.",
  "settings.dialog.conflict.keepTitle": "Continuer l'édition",
  "settings.dialog.conflict.keepDescription":
    "Conserver les modifications locales. L'enregistrement échouera tant que le brouillon n'est pas rechargé.",

  // -- dashboard shell ------------------------------------------------------------------
  "dashboard.skipLink": "Aller au contenu de l'Observatoire",
  "dashboard.eyebrow": "Muses · Observatoire local",
  "dashboard.guideLink": "Guide d'utilisation",
  "dashboard.title": "Contexte, croyance et action réversible",
  "dashboard.lede":
    "Une vue autoritaire côté serveur de ce que Muses a observé, pourquoi sa croyance a changé, et s'il a choisi d'agir.",
  "dashboard.localBadgeAria": "Runtime local uniquement",
  "dashboard.localBadge": "Runtime local",
  "dashboard.primaryRegionAria": "État actuel de l'Observatoire",
  "dashboard.noComponents":
    "L'Observatoire publié n'a aucun composant pour cette zone. Ajoutez-en un dans les paramètres et publiez pour le voir ici.",
  "dashboard.eventStreamEyebrow": "Flux d'événements du serveur",
  "dashboard.recentEvents": "Événements de contexte récents",
  "dashboard.loadedCount": "{count} chargés",
  "dashboard.loadingOlderEvents": "Chargement des événements plus anciens…",
  "dashboard.loadOlderEvents": "Charger des événements plus anciens",
  "dashboard.allEventsLoaded": "Tous les événements disponibles sont chargés",
  "dashboard.noEventsAvailable": "Aucun événement disponible",
  "dashboard.railAria": "Contrôles, métriques et confidentialité",
  "dashboard.audioPromptAria": "Intervention audio en attente",
  "dashboard.audioPromptTitle": "Suggestion sonore en attente d'activation",
  "dashboard.audioPromptBody":
    "Active uniquement sur cette page, interrompable à tout moment.",
  "dashboard.audioPromptStart": "Activer le son de cette session",
  "dashboard.audioPromptPause": "Couper le son immédiatement",
  "dashboard.audioPromptDismiss": "Fermer l'invite",

  // -- dashboard toolbar ------------------------------------------------------------------
  "dashboard.toolbar.aria": "Contrôles d'actualisation de l'Observatoire",
  "dashboard.toolbar.liveRefresh": "Actualisation en direct",
  "dashboard.toolbar.interval": "Intervalle",
  "dashboard.toolbar.refreshingState": "Actualisation de l'état local…",
  "dashboard.toolbar.lastRefresh": "Dernière actualisation {time}",
  "dashboard.toolbar.notYetRefreshed": "Pas encore actualisé",
  "dashboard.toolbar.refreshTimeUnavailable":
    "Heure d'actualisation indisponible",
  "dashboard.toolbar.refreshing": "Actualisation…",
  "dashboard.toolbar.refreshNow": "Actualiser maintenant",

  // -- dashboard states ---------------------------------------------------------------------
  "dashboard.states.skeletonAria": "Chargement de l'Observatoire",
  "dashboard.states.skeletonSr":
    "Chargement de l'état de l'Observatoire local.",
  "dashboard.states.disconnectedTitle": "Serveur local déconnecté",
  "dashboard.states.errorTitle": "L'Observatoire n'a pas pu se charger",
  "dashboard.states.disconnectedDetail":
    "L'Observatoire ne peut pas joindre le service Fastify local. L'état serveur existant n'a pas été remplacé par des données navigateur.",
  "dashboard.states.unreadableDetail":
    "Le serveur local a renvoyé une réponse illisible.",
  "dashboard.states.connection": "Connexion",
  "dashboard.states.serverResponse": "Réponse du serveur",
  "dashboard.states.retryConnection": "Réessayer la connexion locale",
  "dashboard.states.emptyEyebrow": "En attente de preuves",
  "dashboard.states.emptyTitle": "Pas encore d'état d'Observatoire",
  "dashboard.states.emptyBody":
    "Le serveur local a renvoyé un instantané autoritaire vide. Laissez Muses tourner pendant que les événements arrivent ; cette page ne crée ni croyance ni décision de démonstration.",
  "dashboard.states.staleTitle": "Affichage du dernier instantané serveur.",
  "dashboard.states.staleDefault":
    "L'instantané est plus ancien que la fenêtre de fraîcheur du serveur.",
  "dashboard.states.dismissError": "Fermer l'erreur",

  // -- registry slot degraded boundary --------------------------------------------------------
  "dashboard.slot.degradedEyebrow": "Composant indisponible",
  "dashboard.slot.degradedBody":
    "Ce composant du registre n'a pas pu s'afficher. Les autres zones de l'Observatoire restent disponibles.",

  // -- dashboard surface titles -----------------------------------------------------------------
  "dashboard.surface.state.hero": "État courant",
  "dashboard.surface.belief.distribution": "Distribution de croyance",
  "dashboard.surface.evidence.list": "Preuves",
  "dashboard.surface.events.timeline": "Chronologie des événements",
  "dashboard.surface.decision.card": "Justification de la décision",
  "dashboard.surface.audio.control": "Effet audio",
  "dashboard.surface.metrics.grid": "Métriques",
  "dashboard.surface.privacy.status": "Statut de confidentialité",
  "dashboard.surface.llm.narration": "Narration IA",

  // -- registry: state hero -----------------------------------------------------------------------
  "registry.stateHero.title": "État courant",
  "registry.stateHero.beliefConfidence": "Confiance de la croyance",
  "registry.stateHero.updated": "Mis à jour {time}",

  // -- registry: belief distribution ----------------------------------------------------------------
  "registry.beliefDistribution.title": "Distribution de croyance",
  "registry.beliefDistribution.supports": "soutient",
  "registry.beliefDistribution.opposes": "s'oppose",
  "registry.beliefDistribution.neutral": "neutre",
  "registry.beliefDistribution.probabilityAria": "Probabilité de {label}",
  "registry.beliefDistribution.evidenceItem": "{count} élément de preuve",
  "registry.beliefDistribution.evidenceItems": "{count} éléments de preuve",

  // -- registry: evidence list -----------------------------------------------------------------------
  "registry.evidenceList.title": "Preuves",
  "registry.evidenceList.empty": "Aucune preuve vérifiée n'est disponible.",

  // -- registry: events timeline -----------------------------------------------------------------------
  "registry.eventsTimeline.title": "Événements",
  "registry.eventsTimeline.empty": "Aucun événement enregistré.",

  // -- registry: decision card --------------------------------------------------------------------------
  "registry.decisionCard.title": "Décision",
  "registry.decisionCard.confidence": "Confiance de la décision",
  "registry.decisionCard.expires": "Expire {time}",
  "registry.decisionCard.undo": "Annuler la décision",

  // -- registry: audio control ---------------------------------------------------------------------------
  "registry.audioControl.title": "Contrôle audio",
  "registry.audioControl.noTrack": "Aucune piste sélectionnée",
  "registry.audioControl.playing": "Audio en lecture",
  "registry.audioControl.paused": "Audio en pause",
  "registry.audioControl.volume": "Volume : {percent} %",
  "registry.audioControl.unmute": "Réactiver le son",
  "registry.audioControl.mute": "Couper le son",

  // -- registry: metrics grid ---------------------------------------------------------------------------
  "registry.metricsGrid.title": "Métriques",
  "registry.metricsGrid.increasing": "En hausse",
  "registry.metricsGrid.decreasing": "En baisse",
  "registry.metricsGrid.stable": "Stable",
  "registry.metricsGrid.unknownTrend": "Tendance inconnue",

  // -- registry: privacy status ---------------------------------------------------------------------------
  "registry.privacyStatus.title": "Statut de confidentialité",
  "registry.privacyStatus.localOnly": "LOCAL UNIQUEMENT",
  "registry.privacyStatus.notLocal": "NON LOCAL",
  "registry.privacyStatus.activeSensors": "Capteurs actifs",
  "registry.privacyStatus.none": "Aucun",
  "registry.privacyStatus.retention": "Rétention",
  "registry.privacyStatus.pendingDeletion": "En attente de suppression",
  "registry.privacyStatus.lastExport": "Dernière exportation",

  // -- registry: llm narration ----------------------------------------------------------------------------
  "registry.llmNarration.title": "Narration IA",
  "registry.llmNarration.disclosure":
    "Une fois activé, ce panneau envoie le résumé de croyance courant et les comptages d'événements — jamais le contenu ni les chemins de fichiers — à la passerelle du réseau local configurée. La sortie est purement affichage.",
  "registry.llmNarration.cooldown": "Repos",
  "registry.llmNarration.cooldownDetail":
    "Temporairement indisponible — réessayez sous peu.",
  "registry.llmNarration.generating": "Génération…",
  "registry.llmNarration.generatedBy": "Généré par {model} · {time}",
  "registry.llmNarration.unknownModel": "modèle inconnu",
  "registry.llmNarration.unknownTime": "heure inconnue",
  "registry.llmNarration.explain": "Expliquer l'état courant",
  "registry.llmNarration.summarize": "Résumer la dernière heure",
  "registry.llmNarration.retry": "Réessayer",

  // -- registry: safe fallback ------------------------------------------------------------------------------
  "registry.safeFallback.title": "Composant indisponible",
  "registry.safeFallback.requested": "Demandé : {type}",
  "registry.safeFallback.reason": "Raison : {reason}",
  "registry.safeFallback.dashboardInvalid":
    "La configuration de l'Observatoire est invalide et n'a pas été affichée.",
  "registry.safeFallback.dashboardSchemaVersion":
    "La version de schéma de l'Observatoire n'est pas prise en charge.",
  "registry.safeFallback.componentUnknownType":
    "Ce type de composant n'est pas enregistré.",
  "registry.safeFallback.componentInvalidProps":
    "Ce composant a reçu une configuration invalide.",
  "registry.safeFallback.componentSchemaVersion":
    "La version de schéma de ce composant n'est pas prise en charge.",
  "registry.safeFallback.componentMissingCapability":
    "Ce composant est indisponible car une capacité locale requise manque.",
  "registry.safeFallback.componentRenderError":
    "Ce composant a échoué sûrement et a été isolé du reste de l'Observatoire.",

  // -- foundation status page ---------------------------------------------------------------------------------
  "foundation.status.eyebrow": "Muses v0.1 · enveloppe de fondation",
  "foundation.status.title":
    "Runtime de contexte local, prêt pour l'intégration des modules.",
  "foundation.status.lede":
    "Cette surface minimale vérifie l'enveloppe React et le service local Fastify. Les modules produit possèdent tout le comportement de domaine et s'enregistreront via les hooks de composition typés.",
  "foundation.status.localAuthority": "Service local",
  "foundation.status.checking": "Vérification de l'état de la boucle locale…",
  "foundation.status.authorityUnavailable":
    "Le service local est indisponible.",
  "foundation.status.connected":
    "Connecté · version {version} · disponibilité {seconds} s",
  "foundation.status.notConnected": "Non connecté",
  "foundation.status.connectedAria": "Connecté",
  "foundation.status.securityNote":
    "Périmètre local uniquement. Le bind en boucle locale et les vérifications d'origine réduisent l'exposition, mais ce prototype n'est pas un service de production multi-utilisateur authentifié.",

  // -- root error boundary --------------------------------------------------------------------------------------
  "foundation.errorBoundary.eyebrow": "Erreur de l'interface locale",
  "foundation.errorBoundary.title": "Muses n'a pas pu afficher cette vue.",
  "foundation.errorBoundary.body":
    "Aucun rapport distant n'a été envoyé. Réessayez la vue locale ; les échecs persistants doivent être inspectés dans les journaux de développement locaux.",
  "foundation.errorBoundary.retry": "Réessayer la vue",

  // -- dashboard hooks: user-facing errors -------------------------------------------------------------------------
  "dashboard.errors.manualNeedsEffect":
    "Une commande de transport manuelle exige un effet de l'instantané courant.",
  "dashboard.errors.outcomeDeclined":
    "Le serveur local a refusé le résultat d'effet rapporté.",
  "dashboard.errors.audioCommandFailed":
    "Le moteur audio n'a pas pu exécuter cette commande.",
  "dashboard.errors.generationFailed": "Échec de la génération.",

  // -- dashboard API parse errors ------------------------------------------------------------------------------------
  "api.error.expectedString": '"{key}" doit être une chaîne.',
  "api.error.expectedStringWhenPresent":
    '"{key}" doit être une chaîne quand présent.',
  "api.error.expectedFiniteNumber": '"{key}" doit être un nombre fini.',
  "api.error.expectedBoolean": '"{key}" doit être un booléen.',
  "api.error.expectedObject": '"{key}" doit être un objet.',
  "api.error.expectedArrayWhenPresent":
    '"{key}" doit être un tableau quand présent.',
  "api.error.unsupportedValue":
    'Valeur non prise en charge pour "{key}" : {value}',
  "api.error.expectedUnitInterval": '"{key}" doit être entre 0 et 1.',
  "api.error.expectedIsoDate": '"{key}" doit être une date-heure ISO.',
  "api.error.expectedPrivacyObject":
    "La charge de confidentialité doit être un objet.",
  "api.error.privacyNotLocalOnly":
    "L'Observatoire a rejeté une charge de confidentialité non strictement locale ou annonçant une capacité cloud/clé d'API.",
  "api.error.expectedCapabilityObject":
    "Chaque capacité de confidentialité doit être un objet.",
  "api.error.expectedStringArray": '"{key}" doit être un tableau de chaînes.',
  "api.error.expectedStringArrayEntries":
    'Les entrées de "{key}" doivent être des chaînes.',
  "api.error.expectedEvidenceObject":
    "Chaque preuve de croyance doit être un objet.",
  "api.error.expectedFactorObject":
    "Chaque facteur de croyance doit être un objet.",
  "api.error.expectedBeliefObject":
    "L'instantané de croyance doit être un objet.",
  "api.error.expectedDecisionFactorObject":
    "Chaque facteur de décision doit être un objet.",
  "api.error.expectedDecisionObject": "La décision doit être un objet.",
  "api.error.expectedEffectObjectOrNull":
    '"effect" doit être un objet ou null.',
  "api.error.expectedOutcomeObject": "Le résultat d'effet doit être un objet.",
  "api.error.unsupportedOutcomeStatus":
    "Statut de résultat non pris en charge : {status}",
  "api.error.expectedLedgerObject":
    "L'entrée de registre d'effets doit être un objet.",
  "api.error.expectedSettingsObject":
    "La réponse de paramètres doit être un objet.",
  "api.error.expectedCurrentRelease":
    '"currentRelease" doit être un objet ou null.',
  "api.error.expectedCurrentReleaseDocument":
    '"currentRelease.document" doit être un objet.',
  "api.error.expectedAudioPrivacyObjects":
    "Le document de paramètres doit contenir les objets audio et privacy.",
  "api.error.expectedContextEventObject":
    "Chaque événement de contexte doit être un objet.",
  "api.error.expectedSnapshotObject":
    "L'instantané de l'Observatoire doit être un objet.",
  "api.error.expectedSnapshotKey":
    "L'instantané de l'Observatoire doit inclure \"{key}\".",
  "api.error.expectedPrivacyPayloadLocalOnly":
    "L'Observatoire a rejeté une charge de confidentialité non strictement locale.",
  "api.error.expectedEventPageObject":
    "La page d'événements doit être un objet.",
  "api.error.expectedNextCursor":
    '"nextCursor" doit être une chaîne, null ou omis.',
  "api.error.expectedHasMoreBoolean":
    '"hasMore" doit être un booléen quand présent.',
  "api.error.expectedCursorWhenHasMore":
    '"nextCursor" doit être non null quand "hasMore" est true.',
  "api.error.expectedEventObject": "Chaque événement doit être un objet.",
  "api.error.expectedMetadataJson":
    'Les "metadata" d\'événement doivent contenir des valeurs compatibles JSON.',
  "api.error.expectedEffectResultObject":
    "Le résultat de commande d'effet doit être un objet.",
  "api.error.unknownEffect": "Le serveur local ne suit plus cet effet.",
  "api.error.expectedLlmObject":
    "Le résultat de génération LLM doit être un objet.",
  "api.error.expectedModelLength":
    '"model" doit être une chaîne non vide de 128 caractères au plus.',
  "api.error.expectedBootstrapObject":
    "La réponse bootstrap doit être un objet.",
  "api.error.invalidJsonDetail":
    "Le serveur a renvoyé du JSON invalide : {detail}",
  "api.error.invalidJson": "Le serveur a renvoyé du JSON invalide.",
  "api.error.requestAborted": "Requête annulée.",
  "api.error.unreachable": "Impossible de joindre le serveur Muses local.",
  "api.error.httpStatus": "Le serveur Muses local a renvoyé HTTP {status}.",
  "api.error.effectIdRequired":
    "Un résultat d'effet exige un effectId de l'instantané courant de l'Observatoire.",
  "api.error.unknownDashboardError": "Erreur d'Observatoire inconnue.",

  // -- auth (connexion / inscription / gestion des utilisateurs) ----------------

  "auth.gate.checking": "Vérification de votre session…",
  "auth.session.signOut": "Se déconnecter",
  "auth.session.adminLink": "Gestion des utilisateurs",
  "auth.session.settingsLink": "Paramètres",
  "auth.error.network": "Le serveur Muses est injoignable.",
  "auth.error.sessionExpired": "Votre session a expiré — reconnectez-vous.",

  // -- connexion -----------------------------------------------------------------
  "auth.login.title": "Connexion",
  "auth.login.subtitle":
    "Utilisez l'e-mail et le mot de passe de votre compte Muses.",
  "auth.login.emailLabel": "E-mail",
  "auth.login.passwordLabel": "Mot de passe",
  "auth.login.submit": "Se connecter",
  "auth.login.submitting": "Connexion…",
  "auth.login.toRegister": "Pas encore de compte ? Créez-en un",

  // -- inscription ----------------------------------------------------------------
  "auth.register.title": "Créer un compte",
  "auth.register.subtitle":
    "Recevez un code par e-mail, puis choisissez un mot de passe.",
  "auth.register.stepsAria": "Étapes d'inscription",
  "auth.register.stepEmail": "E-mail",
  "auth.register.stepVerify": "Vérification",
  "auth.register.stepDone": "Terminé",
  "auth.register.emailLabel": "E-mail",
  "auth.register.emailPlaceholder": "vous@exemple.com",
  "auth.register.sendCode": "Envoyer le code",
  "auth.register.sending": "Envoi…",
  "auth.register.invalidEmail": "Saisissez une adresse e-mail valide.",
  "auth.register.changeEmail": "Changer d'e-mail",
  "auth.register.codeLabel": "Code de vérification",
  "auth.register.codePlaceholder": "Code à 6 chiffres",
  "auth.register.codeSent": "Code envoyé — consultez votre boîte mail.",
  "auth.register.devCode": "Code de développement : {code}",
  "auth.register.resend": "Renvoyer le code",
  "auth.register.resendIn": "Renvoi dans {seconds} s",
  "auth.register.codeRequired":
    "Saisissez le code de vérification reçu par e-mail.",
  "auth.register.passwordLabel": "Mot de passe",
  "auth.register.passwordHint": "Au moins 6 caractères.",
  "auth.register.passwordTooShort":
    "Le mot de passe doit compter au moins 6 caractères.",
  "auth.register.displayNameLabel": "Nom affiché (facultatif)",
  "auth.register.displayNamePlaceholder":
    "Par défaut, le préfixe de votre e-mail",
  "auth.register.submit": "Créer le compte",
  "auth.register.submitting": "Création…",
  "auth.register.doneTitle": "Compte créé",
  "auth.register.doneBody": "Bienvenue, {name} — vous êtes connecté.",
  "auth.register.continue": "Continuer",
  "auth.register.toLogin": "Déjà un compte ? Connectez-vous",

  // -- gestion des utilisateurs -----------------------------------------------------
  "auth.admin.title": "Administration des utilisateurs",
  "auth.admin.subtitle": "Comptes locaux : activer, désactiver, supprimer.",
  "auth.admin.loading": "Chargement des utilisateurs…",
  "auth.admin.loadFailed": "Impossible de charger les utilisateurs.",
  "auth.admin.actionFailed": "L'action a échoué.",
  "auth.admin.empty": "Aucun utilisateur pour l'instant.",
  "auth.admin.statsTotal": "Utilisateurs",
  "auth.admin.statsAdmins": "Admins",
  "auth.admin.statsDisabled": "Désactivés",
  "auth.admin.colUser": "Utilisateur",
  "auth.admin.colRole": "Rôle",
  "auth.admin.colStatus": "Statut",
  "auth.admin.colCreatedAt": "Créé le",
  "auth.admin.colActions": "Actions",
  "auth.admin.roleAdmin": "Admin",
  "auth.admin.roleUser": "Utilisateur",
  "auth.admin.active": "Actif",
  "auth.admin.disabled": "Désactivé",
  "auth.admin.activate": "Activer",
  "auth.admin.deactivate": "Désactiver",
  "auth.admin.delete": "Supprimer",
  "auth.admin.confirmDelete": "Confirmer la suppression",
  "auth.admin.processing": "En cours…",
  "auth.admin.selfProtected":
    "Vous ne pouvez pas modifier votre propre compte ici.",
  "auth.admin.deniedTitle": "Réservé aux administrateurs",
  "auth.admin.deniedBody":
    "Connectez-vous avec un compte administrateur pour gérer les utilisateurs.",
  // -- v0.7 self-track player (batch 1, C path) ---------------------------
  "player.title": "Piste personnelle",
  "player.subtitle": "Votre état, orchestré par le signal.",
  "player.state.idle": "Inactif",
  "player.state.playing": "Lecture",
  "player.state.crossfading": "Fondu enchaîné",
  "player.state.ended": "Terminé",
  "player.control.start": "Démarrer",
  "player.control.stop": "Arrêter",
  "player.control.skip": "Passer",
  "player.nowPlaying.label": "En cours",
  "player.attribution.label": "Licence",
  "player.plan.localStubNotice":
    "Plan local — l'API de plan de lecture n'est pas encore branchée.",

  // -- v0.7 vibe signature (batch 1, C path) ------------------------------
  "signature.title": "Signature Vibe",
  "signature.subtitle":
    "Comment vos états se traduisent en musique. v0 : gabarits + réglage manuel.",
  "signature.template.minimalElectronic.name": "Électronique minimal",
  "signature.template.minimalElectronic.description":
    "Pulsations stables pour la concentration profonde. ~118–138 BPM, énergie plafonnée, voix clairsemée.",
  "signature.template.ambient.name": "Ambiant",
  "signature.template.ambient.description":
    "Nappes texturées pour le calme et la récupération. ~60–80 BPM, basse énergie, sans voix.",
  "signature.template.lofiJazz.name": "Jazz lo-fi",
  "signature.template.lofiJazz.description":
    "Accords poussiéreux pour un travail sans hâte. ~70–90 BPM, énergie moyenne, voix légère.",
  "signature.calibration.bpmMin.label": "Borne BPM basse",
  "signature.calibration.bpmMax.label": "Borne BPM haute",
  "signature.calibration.energyCap.label": "Plafond d'énergie",
  "signature.calibration.vocalDensity.label": "Densité vocale",
  "signature.calibration.vocalDensity.none": "Aucune",
  "signature.calibration.vocalDensity.low": "Faible",
  "signature.calibration.vocalDensity.medium": "Moyenne",
  "signature.calibration.vocalDensity.high": "Élevée",
  "signature.calibration.error.bpmRange":
    "Les bornes BPM doivent satisfaire 40 ≤ basse < haute ≤ 200.",
  "signature.summary.heading": "Signature effective",
  "signature.summary.bpm": "Fenêtre BPM",
  "signature.summary.energyCap": "Plafond d'énergie",
  "signature.summary.vocalDensity": "Densité vocale",
  "signature.journal.notice":
    "Les sauts et réécoutes sont enregistrés mais pas encore utilisés pour l'apprentissage.",

  // -- v0.7 journey replay (batch 2, D path) ------------------------------
  "replay.title": "Relecture",
  "replay.subtitle":
    "Votre journée en frise chronologique — naviguez pour revivre chaque état.",
  "replay.loading": "Chargement des parcours…",
  "replay.empty": "Aucun parcours enregistré pour l'instant.",
  "replay.error": "Relecture indisponible :",
};
