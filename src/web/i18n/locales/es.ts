/**
 * Catálogo de mensajes en español. El conjunto de claves coincide exactamente
 * con en.ts (forzado en compilación mediante Record<MessageKey, string>).
 *
 * Glosario:
 *   Muses —— nombre del producto, sin traducir
 *   Observatory —— el Observatorio
 *   rollback —— reversión
 *   publish/release —— publicar / versión
 *   draft —— borrador
 *   belief —— creencia
 *   snapshot —— instantánea
 *   soundscape —— paisaje sonoro
 *   gain —— ganancia
 *   widget —— componente
 *   narration —— narración
 */
import type { MessageKey } from "./en";

export const es: Record<MessageKey, string> = {
  // -- shared ----------------------------------------------------------------
  "common.yes": "Sí",
  "common.no": "No",
  "common.cancel": "Cancelar",
  "common.retry": "Reintentar",
  "common.dismiss": "Cerrar",
  "common.publish": "Publicar",

  // -- settings workspace chrome ---------------------------------------------
  "settings.workspace.title": "Ajustes",
  "settings.workspace.subtitle":
    "Borrador, vista previa, publicación, historial y reversión para el runtime local de Muses.",
  "settings.workspace.unsavedEdits": "Hay ediciones locales sin guardar",
  "settings.workspace.draftSaved": "Borrador guardado en el servidor",
  "settings.workspace.loading": "Cargando ajustes…",
  "settings.workspace.unavailable": "Ajustes no disponibles",
  "settings.workspace.versionsAria": "Versiones de los ajustes",
  "settings.workspace.draftBadge": "Borrador — inactivo",
  "settings.workspace.revisionLabel": "revisión {revision}",
  "settings.workspace.publishedBadge": "Publicado — activo",
  "settings.workspace.errorTitle": "Error en la operación de ajustes",
  "settings.workspace.dismissNoticeAria": "Cerrar el aviso",
  "settings.workspace.navigationAria": "Categorías de ajustes",
  "settings.workspace.draftActionsAria": "Acciones del borrador",
  "settings.workspace.saving": "Guardando…",
  "settings.workspace.saveDraft": "Guardar borrador",
  "settings.workspace.generating": "Generando…",
  "settings.workspace.previewDraft": "Previsualizar borrador",
  "settings.workspace.saveBeforePreviewTitle":
    "Guarda el borrador antes de previsualizar.",
  "settings.workspace.savePreviewFirstTitle":
    "Guarda y previsualiza el borrador antes de publicar.",
  "settings.workspace.preflightNotice":
    "La comprobación local encontró problemas bloqueantes. El servidor sigue siendo la autoridad y no fue llamado.",
  "settings.workspace.draftSavedNotice":
    "Borrador de revisión {revision} guardado en el servidor local.",
  "settings.workspace.saveReason": "Edición del espacio de ajustes: {section}",
  "settings.workspace.publishedNotice":
    "Publicado. La nueva versión es ahora el runtime activo.",
  "settings.workspace.rollbackReason": "Revertir a r{releaseNumber}",
  "settings.workspace.rolledBackNotice":
    "Se revirtió a r{releaseNumber} como nueva versión. El historial no cambia.",
  "settings.workspace.reloadedNotice":
    "Borrador del servidor recargado. Se descartaron los cambios locales no guardados.",
  "settings.workspace.readinessTitle": "Preparación de publicación",
  "settings.workspace.readinessDescription":
    "Publicar exige un borrador guardado con una vista previa vigente del servidor.",
  "settings.workspace.readinessSavedDraft": "Borrador guardado",
  "settings.workspace.readinessPreviewCurrent": "Vista previa vigente",
  "settings.workspace.readinessChanges": "Cambios frente a lo publicado",
  "settings.workspace.readinessUnknown": "Desconocido",
  "settings.workspace.readinessPublishReady": "Listo para publicar",
  "settings.workspace.serverUnreachable":
    "No se pudo alcanzar el servidor local de ajustes.",
  "settings.workspace.previewNoChanges":
    "Sin cambios frente a la versión publicada.",
  "settings.workspace.previewChangesSummary":
    "{count} cambio(s) en {sections}.",

  // -- settings sections (navigation cards) -----------------------------------
  "settings.section.appearance.label": "Apariencia",
  "settings.section.appearance.description": "Tema, densidad y movimiento",
  "settings.section.belief.label": "Creencia",
  "settings.section.belief.description": "Confianza y antigüedad",
  "settings.section.decision.label": "Decisión",
  "settings.section.decision.description": "Enfriamiento y horas de silencio",
  "settings.section.signals.label": "Señales",
  "settings.section.signals.description": "Fuentes y ponderaciones",
  "settings.section.audio.label": "Audio",
  "settings.section.audio.description": "Perfiles y límites de ganancia",
  "settings.section.privacy.label": "Privacidad",
  "settings.section.privacy.description": "Retención y exclusiones",
  "settings.section.llm.label": "Narración IA",
  "settings.section.llm.description": "Mejora de visualización opcional",
  "settings.section.surface.label": "Observatorio",
  "settings.section.surface.description": "Componentes y orden",

  // -- appearance editor -------------------------------------------------------
  "settings.editor.appearance.title": "Apariencia",
  "settings.editor.appearance.description":
    "Presentación del entorno local. Autoritativa desde el servidor como cualquier otra sección — publicar es lo que activa un cambio.",
  "settings.editor.appearance.productName": "Nombre del producto",
  "settings.editor.appearance.productNameHelp":
    "Se muestra en la cabecera del entorno.",
  "settings.editor.appearance.theme": "Tema",
  "settings.editor.appearance.themeSystem": "Seguir al sistema",
  "settings.editor.appearance.themeLight": "Claro",
  "settings.editor.appearance.themeDark": "Oscuro",
  "settings.editor.appearance.accentColor": "Color de acento",
  "settings.editor.appearance.accentHelp":
    "Hexadecimal de seis dígitos, por ejemplo #6c8cff.",
  "settings.editor.appearance.density": "Densidad",
  "settings.editor.appearance.densityComfortable": "Cómoda",
  "settings.editor.appearance.densityCompact": "Compacta",
  "settings.editor.appearance.reducedMotion":
    "Reducir el movimiento no esencial",
  "settings.editor.appearance.language": "Idioma",

  // -- belief editor -----------------------------------------------------------
  "settings.editor.belief.title": "Creencia",
  "settings.editor.belief.description":
    "Umbrales que el proyector determinista debe superar antes de considerar conocido un estado. UNKNOWN sigue siendo un resultado de primera clase.",
  "settings.editor.belief.minimumConfidence": "Confianza mínima",
  "settings.editor.belief.minimumConfidenceHelp":
    "Por debajo de esto el motor de decisión devuelve NO_ACTION.",
  "settings.editor.belief.minimumMargin": "Margen mínimo",
  "settings.editor.belief.minimumMarginHelp":
    "Ventaja que el estado líder necesita sobre su retador.",
  "settings.editor.belief.stabilityWindow": "Ventana de estabilidad (ms)",
  "settings.editor.belief.stabilityWindowHelp":
    "Una creencia más antigua que esta ventana se considera caducada.",
  "settings.editor.belief.note":
    "El vocabulario de estados está fijado en {states} y el estado desconocido es siempre UNKNOWN. Ambos son estructurales y no se pueden editar.",

  // -- decision editor ---------------------------------------------------------
  "settings.editor.decision.title": "Decisión",
  "settings.editor.decision.description":
    "Cuándo puede actuar la automatización. Solo los ajustes de audio reversibles pueden ejecutarse; la entrada manual siempre gana.",
  "settings.editor.decision.cooldown": "Enfriamiento tras acción manual (ms)",
  "settings.editor.decision.cooldownHelp":
    "Tras un cambio manual de audio, la automatización se retira durante este tiempo.",
  "settings.editor.decision.undoWindow": "Ventana de deshacer manual (ms)",
  "settings.editor.decision.undoWindowHelp":
    "Cuánto tiempo permanece reversible un efecto aplicado.",
  "settings.editor.decision.quietHours": "Activar horas de silencio",
  "settings.editor.decision.quietFrom": "Silencio desde",
  "settings.editor.decision.quietUntil": "Silencio hasta",
  "settings.editor.decision.note":
    "Las horas de silencio usan el reloj local y pueden cruzar la medianoche. Durante el silencio, el motor devuelve NO_ACTION con motivo QUIET_HOURS. Las creencias desconocidas o de baja confianza siempre se resuelven en NO_ACTION, y los efectos son siempre reversibles — esto es estructural y no se puede editar.",

  // -- signals editor ----------------------------------------------------------
  "settings.editor.signals.title": "Señales",
  "settings.editor.signals.description":
    "La activación, el peso y la retención de datos de señales aún no se aplican y no se pueden modificar en esta beta.",
  "settings.editor.signals.ideActivity": "Actividad del IDE",
  "settings.editor.signals.gitActivity": "Actividad de Git",
  "settings.editor.signals.appFocus": "Foco de aplicación",
  "settings.editor.signals.terminalActivity": "Actividad del terminal",
  "settings.editor.signals.manualFeedback": "Comentario manual",
  "settings.editor.signals.enabled": "Activada",
  "settings.editor.signals.retainRaw": "Conservar la carga bruta",
  "settings.editor.signals.weight": "Peso",

  // -- audio editor ------------------------------------------------------------
  "settings.editor.audio.title": "Audio",
  "settings.editor.audio.description":
    "El único ejecutor autorizado para actuar automáticamente. Cada cambio aplica rampa de ganancia y es reversible.",
  "settings.editor.audio.allowAutomatic":
    "Permitir el ajuste automático de audio",
  "settings.editor.audio.masterGain": "Techo de ganancia maestra",
  "settings.editor.audio.masterGainHelp":
    "Límite superior estricto; las ganancias por estado se ajustan a él.",
  "settings.editor.audio.soundscape": "Paisaje sonoro",
  "settings.editor.audio.targetGain": "Ganancia objetivo",
  "settings.editor.audio.ramp": "Rampa (ms)",
  "settings.editor.audio.unknownNote":
    "UNKNOWN debe permanecer en silencio: sin paisaje sonoro y ganancia cero.",

  // -- llm editor --------------------------------------------------------------
  "settings.editor.llm.title": "Narración IA",
  "settings.editor.llm.description":
    "Una mejora de visualización opcional. Todo lo demás de Muses funciona exactamente igual con ella desactivada.",
  "settings.editor.llm.enable": "Activar la narración IA (opcional)",
  "settings.editor.llm.enableHelp":
    "Desactivada por omisión. La aplicación es totalmente funcional sin ella.",
  "settings.editor.llm.model": "Alias del modelo",
  "settings.editor.llm.modelHelp":
    "`auto` deja que la pasarela elija el modelo por petición — puede variar cada vez.",
  "settings.editor.llm.note":
    "La dirección y las credenciales de la pasarela vienen del entorno de despliegue y nunca se guardan en los ajustes. El texto generado es solo de visualización.",

  // -- privacy editor ----------------------------------------------------------
  "settings.editor.privacy.title": "Privacidad",
  "settings.editor.privacy.description":
    "La retención afecta a nuevos eventos. Los controles del historial, las exclusiones y la captura de pantalla aún no están implementados.",
  "settings.editor.privacy.rawEventRetention":
    "Retención de eventos brutos (horas)",
  "settings.editor.privacy.rawEventRetentionHelp":
    "Al publicar solo afecta a eventos nuevos. Cero desactiva la captura. Los eventos vencidos se eliminan por lotes, sin borrar datos antiguos, copias ni espacio libre de SQLite. Las filas vencidas aún presentes se pueden consultar mediante la API histórica; la retención no controla el acceso.",
  "settings.editor.privacy.sessionHistoryRetention":
    "Retención del historial de sesiones (días)",
  "settings.editor.privacy.captureScreenContent":
    "Capturar contenido de la pantalla",
  "settings.editor.privacy.excludedApplications": "Aplicaciones excluidas",
  "settings.editor.privacy.excludedApplicationsHelp":
    "Un bundle id o identificador estable de aplicación por línea.",

  // -- dashboard (surface) editor ----------------------------------------------
  "settings.editor.surface.title": "Componentes del Observatorio",
  "settings.editor.surface.description":
    "Solo se aceptan los ocho esquemas de componentes estáticos. Sin HTML, JavaScript ni importaciones dinámicas.",
  "settings.editor.surface.componentType": "Tipo de componente",
  "settings.editor.surface.addComponent": "Añadir componente",
  "settings.editor.surface.empty":
    "No hay componentes del Observatorio. Publicar una superficie vacía deja el Observatorio sin nada que renderizar.",
  "settings.editor.surface.orderAria":
    "Orden de los componentes del Observatorio",
  "settings.editor.surface.componentAria": "Componente {label} {index}",
  "settings.editor.surface.moveUp": "Subir",
  "settings.editor.surface.moveDown": "Bajar",
  "settings.editor.surface.remove": "Quitar",
  "settings.editor.surface.removeAria": "Quitar {label}",
  "settings.editor.surface.stableId": "Id estable",
  "settings.editor.surface.stableIdHelp":
    "Letras, dígitos, punto, dos puntos, guion bajo o guion.",
  "settings.editor.surface.showConfidence": "Mostrar confianza",
  "settings.editor.surface.showUnknownReason":
    "Mostrar el motivo de desconocido",
  "settings.editor.surface.maxStates": "Estados máximos",
  "settings.editor.surface.showFactorContributions":
    "Mostrar contribuciones de factores",
  "settings.editor.surface.limit": "Límite",
  "settings.editor.surface.showSource": "Mostrar fuente",
  "settings.editor.surface.showPayloadSummary": "Mostrar resumen de carga",
  "settings.editor.surface.showNoAction": "Mostrar decisiones NO_ACTION",
  "settings.editor.surface.showUndoAvailability":
    "Mostrar disponibilidad de deshacer",
  "settings.editor.surface.allowManualOverride": "Permitir control manual",
  "settings.editor.surface.showMasterVolume": "Mostrar volumen maestro",
  "settings.editor.surface.metrics": "Métricas",
  "settings.editor.surface.showRetention": "Mostrar retención",
  "settings.editor.surface.showExcludedApplications":
    "Mostrar aplicaciones excluidas",
  "settings.editor.surface.showModelAttribution":
    "Mostrar atribución del modelo",

  // -- widget definitions (surface editor pick list + preview) ------------------
  "settings.widget.stateHero.label": "Tarjeta de estado",
  "settings.widget.stateHero.description":
    "Estado de creencia actual, confianza y motivo de desconocido.",
  "settings.widget.beliefDistribution.label": "Distribución de creencia",
  "settings.widget.beliefDistribution.description":
    "Probabilidad entre estados candidatos con pesos de factores.",
  "settings.widget.evidenceList.label": "Lista de evidencias",
  "settings.widget.evidenceList.description":
    "Eventos que movieron la creencia actual, lo más nuevo primero.",
  "settings.widget.eventsTimeline.label": "Cronología de eventos",
  "settings.widget.eventsTimeline.description":
    "Eventos de contexto brutos en orden de llegada.",
  "settings.widget.decisionCard.label": "Tarjeta de decisión",
  "settings.widget.decisionCard.description":
    "La decisión de política activa y por qué se eligió.",
  "settings.widget.audioControl.label": "Control de audio",
  "settings.widget.audioControl.description":
    "Transporte del paisaje sonoro, perfil y control manual.",
  "settings.widget.metricsGrid.label": "Rejilla de métricas",
  "settings.widget.metricsGrid.description":
    "Contadores móviles para la salud de creencia y efectos.",
  "settings.widget.privacyStatus.label": "Estado de privacidad",
  "settings.widget.privacyStatus.description":
    "Postura solo local, retención y exclusiones.",
  "settings.widget.llmNarration.label": "Narración IA",
  "settings.widget.llmNarration.description":
    "Panel de explicación en texto simple, opcional y activado por el usuario.",

  // -- preview panel -------------------------------------------------------------
  "settings.preview.draftBadge": "Vista previa del borrador — inactiva",
  "settings.preview.title": "Vista previa frente a r{releaseNumber}",
  "settings.preview.body":
    "La versión publicada sigue siendo r{releaseNumber}. La vista previa la resuelve el servidor local y no ejecuta efectos.",
  "settings.preview.close": "Cerrar vista previa",
  "settings.preview.validationPassed":
    "El servidor validó este documento correctamente.",
  "settings.preview.changedPaths": "Rutas modificadas ({count})",
  "settings.preview.identical":
    "Este documento es idéntico a la versión publicada. Publicarlo crearía una versión sin cambio funcional.",

  // -- release history -----------------------------------------------------------
  "settings.release.title": "Historial de versiones",
  "settings.release.description":
    "Registros de publicación inmutables del servidor local de ajustes.",
  "settings.release.empty": "No hay versiones publicadas disponibles.",
  "settings.release.published": "Publicada",
  "settings.release.rollbackBadge": "Reversión",
  "settings.release.publishedBy": "Publicada por {actor}",
  "settings.release.current": "Versión actual",
  "settings.release.rollBackToThis": "Revertir a esta versión",

  // -- publish dialog --------------------------------------------------------------
  "settings.dialog.publish.defaultSummary":
    "Publicar el borrador de ajustes revisado",
  "settings.dialog.publish.title": "Publicar el borrador de ajustes",
  "settings.dialog.publish.description":
    "Publicar reemplaza los ajustes activos autoritativos del servidor. La versión anterior queda disponible para reversión.",
  "settings.dialog.publish.summaryLabel": "Resumen de la versión",
  "settings.dialog.publish.acknowledge":
    "Revisé la vista previa del borrador y entiendo que publicar cambia los ajustes activos.",
  "settings.dialog.publish.publishing": "Publicando…",

  // -- rollback dialog --------------------------------------------------------------
  "settings.dialog.rollback.title": "Revertir los ajustes publicados",
  "settings.dialog.rollback.body":
    "Esto crea una versión nueva a partir de r{releaseNumber}. No borra el historial.",
  "settings.dialog.rollback.warning":
    "Los ajustes activos serán reemplazados. Escriba ROLLBACK en inglés para continuar.",
  "settings.dialog.rollback.phraseLabel": "Frase de confirmación",
  "settings.dialog.rollback.rollingBack": "Revirtiendo…",
  "settings.dialog.rollback.rollBack": "Revertir",

  // -- conflict dialog ----------------------------------------------------------------
  "settings.dialog.conflict.title": "Los ajustes cambiaron en el servidor",
  "settings.dialog.conflict.body":
    "El servidor rechazó la escritura en {field}: esperaba {expected} pero contiene {actual}. No se sobrescribió nada.",
  "settings.dialog.conflict.reloadTitle": "Recargar desde el servidor",
  "settings.dialog.conflict.reloadDescription":
    "Descartar los cambios locales no guardados y cargar el borrador y la versión autoritativos del servidor.",
  "settings.dialog.conflict.keepTitle": "Seguir editando",
  "settings.dialog.conflict.keepDescription":
    "Mantener las ediciones locales. Guardar seguirá fallando hasta recargar el borrador.",

  // -- dashboard shell ------------------------------------------------------------------
  "dashboard.skipLink": "Saltar al contenido del Observatorio",
  "dashboard.eyebrow": "Muses · Observatorio local",
  "dashboard.guideLink": "Guía de uso",
  "dashboard.title": "Contexto, creencia y acción reversible",
  "dashboard.lede":
    "Una vista autoritativa del servidor sobre lo que Muses observó, por qué cambió su creencia y si decidió actuar.",
  "dashboard.localBadgeAria": "Runtime solo local",
  "dashboard.localBadge": "Runtime local",
  "dashboard.primaryRegionAria": "Estado actual del Observatorio",
  "dashboard.noComponents":
    "El Observatorio publicado no tiene componentes para esta zona. Añada uno en Ajustes y publíquelo para verlo aquí.",
  "dashboard.eventStreamEyebrow": "Flujo de eventos del servidor",
  "dashboard.recentEvents": "Eventos de contexto recientes",
  "dashboard.loadedCount": "{count} cargados",
  "dashboard.loadingOlderEvents": "Cargando eventos anteriores…",
  "dashboard.loadOlderEvents": "Cargar eventos anteriores",
  "dashboard.allEventsLoaded": "Todos los eventos disponibles están cargados",
  "dashboard.noEventsAvailable": "No hay eventos disponibles",
  "dashboard.railAria": "Controles, métricas y privacidad",
  "dashboard.audioPromptAria": "Intervención de audio pendiente",
  "dashboard.audioPromptTitle": "Sugerencia de sonido pendiente de activar",
  "dashboard.audioPromptBody":
    "Solo se activa en esta página y puede pausarse en cualquier momento.",
  "dashboard.audioPromptStart": "Activar el sonido de esta sesión",
  "dashboard.audioPromptPause": "Pausar el sonido ahora",
  "dashboard.audioPromptDismiss": "Cerrar el aviso",

  // -- dashboard toolbar ------------------------------------------------------------------
  "dashboard.toolbar.aria": "Controles de actualización del panel",
  "dashboard.toolbar.liveRefresh": "Actualización en vivo",
  "dashboard.toolbar.interval": "Intervalo",
  "dashboard.toolbar.refreshingState": "Actualizando el estado local…",
  "dashboard.toolbar.lastRefresh": "Última actualización {time}",
  "dashboard.toolbar.notYetRefreshed": "Aún sin actualizar",
  "dashboard.toolbar.refreshTimeUnavailable":
    "Hora de actualización no disponible",
  "dashboard.toolbar.refreshing": "Actualizando…",
  "dashboard.toolbar.refreshNow": "Actualizar ahora",

  // -- dashboard states ---------------------------------------------------------------------
  "dashboard.states.skeletonAria": "Cargando el Observatorio",
  "dashboard.states.skeletonSr": "Cargando el estado del Observatorio local.",
  "dashboard.states.disconnectedTitle": "Servidor local desconectado",
  "dashboard.states.errorTitle": "El Observatorio no pudo cargarse",
  "dashboard.states.disconnectedDetail":
    "El panel no puede alcanzar el servicio Fastify local. El estado existente del servidor no fue reemplazado por datos del navegador.",
  "dashboard.states.unreadableDetail":
    "El servidor local devolvió una respuesta ilegible.",
  "dashboard.states.connection": "Conexión",
  "dashboard.states.serverResponse": "Respuesta del servidor",
  "dashboard.states.retryConnection": "Reintentar la conexión local",
  "dashboard.states.emptyEyebrow": "Esperando evidencias",
  "dashboard.states.emptyTitle": "Aún no hay estado del Observatorio",
  "dashboard.states.emptyBody":
    "El servidor local devolvió una instantánea autoritativa vacía. Mantenga Muses en ejecución mientras llegan eventos; esta página no crea una creencia ni decisión de demostración.",
  "dashboard.states.staleTitle":
    "Mostrando la última instantánea del servidor.",
  "dashboard.states.staleDefault":
    "La instantánea es más antigua que la ventana de frescura del servidor.",
  "dashboard.states.dismissError": "Cerrar el error",

  // -- registry slot degraded boundary --------------------------------------------------------
  "dashboard.slot.degradedEyebrow": "Componente no disponible",
  "dashboard.slot.degradedBody":
    "Este componente del registro no pudo renderizarse. Las demás zonas del Observatorio siguen disponibles.",

  // -- dashboard surface titles -----------------------------------------------------------------
  "dashboard.surface.state.hero": "Estado actual",
  "dashboard.surface.belief.distribution": "Distribución de creencia",
  "dashboard.surface.evidence.list": "Evidencias",
  "dashboard.surface.events.timeline": "Cronología de eventos",
  "dashboard.surface.decision.card": "Justificación de la decisión",
  "dashboard.surface.audio.control": "Efecto de audio",
  "dashboard.surface.metrics.grid": "Métricas",
  "dashboard.surface.privacy.status": "Estado de privacidad",
  "dashboard.surface.llm.narration": "Narración IA",

  // -- registry: state hero -----------------------------------------------------------------------
  "registry.stateHero.title": "Estado actual",
  "registry.stateHero.beliefConfidence": "Confianza de la creencia",
  "registry.stateHero.updated": "Actualizado {time}",

  // -- registry: belief distribution ----------------------------------------------------------------
  "registry.beliefDistribution.title": "Distribución de creencia",
  "registry.beliefDistribution.supports": "apoya",
  "registry.beliefDistribution.opposes": "se opone",
  "registry.beliefDistribution.neutral": "neutral",
  "registry.beliefDistribution.probabilityAria": "Probabilidad de {label}",
  "registry.beliefDistribution.evidenceItem": "{count} evidencia",
  "registry.beliefDistribution.evidenceItems": "{count} evidencias",

  // -- registry: evidence list -----------------------------------------------------------------------
  "registry.evidenceList.title": "Evidencias",
  "registry.evidenceList.empty": "No hay evidencias verificadas disponibles.",

  // -- registry: events timeline -----------------------------------------------------------------------
  "registry.eventsTimeline.title": "Eventos",
  "registry.eventsTimeline.empty": "No se ha registrado ningún evento.",

  // -- registry: decision card --------------------------------------------------------------------------
  "registry.decisionCard.title": "Decisión",
  "registry.decisionCard.confidence": "Confianza de la decisión",
  "registry.decisionCard.expires": "Caduca {time}",
  "registry.decisionCard.undo": "Deshacer decisión",

  // -- registry: audio control ---------------------------------------------------------------------------
  "registry.audioControl.title": "Control de audio",
  "registry.audioControl.noTrack": "Ninguna pista seleccionada",
  "registry.audioControl.playing": "Audio en reproducción",
  "registry.audioControl.paused": "Audio en pausa",
  "registry.audioControl.volume": "Volumen: {percent}%",
  "registry.audioControl.unmute": "Activar sonido",
  "registry.audioControl.mute": "Silenciar",

  // -- registry: metrics grid ---------------------------------------------------------------------------
  "registry.metricsGrid.title": "Métricas",
  "registry.metricsGrid.increasing": "Subiendo",
  "registry.metricsGrid.decreasing": "Bajando",
  "registry.metricsGrid.stable": "Estable",
  "registry.metricsGrid.unknownTrend": "Tendencia desconocida",

  // -- registry: privacy status ---------------------------------------------------------------------------
  "registry.privacyStatus.title": "Estado de privacidad",
  "registry.privacyStatus.localOnly": "SOLO LOCAL",
  "registry.privacyStatus.notLocal": "NO LOCAL",
  "registry.privacyStatus.activeSensors": "Sensores activos",
  "registry.privacyStatus.none": "Ninguno",
  "registry.privacyStatus.retention": "Retención",
  "registry.privacyStatus.pendingDeletion": "Pendiente de eliminación",
  "registry.privacyStatus.lastExport": "Última exportación",

  // -- registry: llm narration ----------------------------------------------------------------------------
  "registry.llmNarration.title": "Narración IA",
  "registry.llmNarration.disclosure":
    "Al activarse, este panel envía el resumen de creencia actual y los recuentos de eventos — nunca contenidos ni rutas de archivos — a la pasarela de red local configurada. La salida es solo de visualización.",
  "registry.llmNarration.cooldown": "Enfriamiento",
  "registry.llmNarration.cooldownDetail":
    "No disponible temporalmente — reintente pronto.",
  "registry.llmNarration.generating": "Generando…",
  "registry.llmNarration.generatedBy": "Generado por {model} · {time}",
  "registry.llmNarration.unknownModel": "modelo desconocido",
  "registry.llmNarration.unknownTime": "hora desconocida",
  "registry.llmNarration.explain": "Explicar el estado actual",
  "registry.llmNarration.summarize": "Resumir la última hora",
  "registry.llmNarration.retry": "Reintentar",

  // -- registry: safe fallback ------------------------------------------------------------------------------
  "registry.safeFallback.title": "Componente no disponible",
  "registry.safeFallback.requested": "Solicitado: {type}",
  "registry.safeFallback.reason": "Motivo: {reason}",
  "registry.safeFallback.dashboardInvalid":
    "La configuración del Observatorio es inválida y no se renderizó.",
  "registry.safeFallback.dashboardSchemaVersion":
    "La versión de esquema del Observatorio no está soportada.",
  "registry.safeFallback.componentUnknownType":
    "Este tipo de componente no está registrado.",
  "registry.safeFallback.componentInvalidProps":
    "Este componente recibió configuración inválida.",
  "registry.safeFallback.componentSchemaVersion":
    "La versión de esquema de este componente no está soportada.",
  "registry.safeFallback.componentMissingCapability":
    "Este componente no está disponible porque falta una capacidad local necesaria.",
  "registry.safeFallback.componentRenderError":
    "Este componente falló de forma segura y quedó aislado del resto del Observatorio.",

  // -- foundation status page ---------------------------------------------------------------------------------
  "foundation.status.eyebrow": "Muses v0.1 · entorno base",
  "foundation.status.title":
    "Runtime de contexto local, listo para integrar módulos.",
  "foundation.status.lede":
    "Esta superficie mínima verifica el entorno React y el servicio local Fastify. Los módulos de producto poseen todo el comportamiento de dominio y se registrarán mediante los hooks de composición tipados.",
  "foundation.status.localAuthority": "Servicio local",
  "foundation.status.checking": "Comprobando el estado del bucle local…",
  "foundation.status.authorityUnavailable":
    "El servicio local no está disponible.",
  "foundation.status.connected":
    "Conectado · versión {version} · activo {seconds} s",
  "foundation.status.notConnected": "Sin conectar",
  "foundation.status.connectedAria": "Conectado",
  "foundation.status.securityNote":
    "Perímetro solo local. El enlace al loopback y las comprobaciones de origen reducen la exposición, pero este prototipo no es un servicio de producción multiusuario autenticado.",

  // -- root error boundary --------------------------------------------------------------------------------------
  "foundation.errorBoundary.eyebrow": "Error de la interfaz local",
  "foundation.errorBoundary.title": "Muses no pudo renderizar esta vista.",
  "foundation.errorBoundary.body":
    "No se envió ningún informe remoto. Reintente la vista local; las fallas persistentes deben inspeccionarse en los registros locales de desarrollo.",
  "foundation.errorBoundary.retry": "Reintentar la vista",

  // -- dashboard hooks: user-facing errors -------------------------------------------------------------------------
  "dashboard.errors.manualNeedsEffect":
    "Un comando manual de transporte necesita un efecto de la instantánea actual.",
  "dashboard.errors.outcomeDeclined":
    "El servidor local rechazó el resultado del efecto reportado.",
  "dashboard.errors.audioCommandFailed":
    "El motor de audio no pudo completar ese comando.",
  "dashboard.errors.generationFailed": "Falló la generación.",

  // -- dashboard API parse errors ------------------------------------------------------------------------------------
  "api.error.expectedString": '"{key}" debe ser una cadena.',
  "api.error.expectedStringWhenPresent":
    '"{key}" debe ser una cadena cuando está presente.',
  "api.error.expectedFiniteNumber": '"{key}" debe ser un número finito.',
  "api.error.expectedBoolean": '"{key}" debe ser un booleano.',
  "api.error.expectedObject": '"{key}" debe ser un objeto.',
  "api.error.expectedArrayWhenPresent":
    '"{key}" debe ser un array cuando está presente.',
  "api.error.unsupportedValue": 'Valor no soportado para "{key}": {value}',
  "api.error.expectedUnitInterval": '"{key}" debe estar entre 0 y 1.',
  "api.error.expectedIsoDate": '"{key}" debe ser una fecha-hora ISO.',
  "api.error.expectedPrivacyObject":
    "La carga de privacidad debe ser un objeto.",
  "api.error.privacyNotLocalOnly":
    "El Observatorio rechazó una carga de privacidad que no es estrictamente solo local o que reporta capacidad de nube/clave de API.",
  "api.error.expectedCapabilityObject":
    "Cada capacidad de privacidad debe ser un objeto.",
  "api.error.expectedStringArray": '"{key}" debe ser un array de cadenas.',
  "api.error.expectedStringArrayEntries":
    'Las entradas de "{key}" deben ser cadenas.',
  "api.error.expectedEvidenceObject":
    "Cada evidencia de creencia debe ser un objeto.",
  "api.error.expectedFactorObject":
    "Cada factor de creencia debe ser un objeto.",
  "api.error.expectedBeliefObject":
    "La instantánea de creencia debe ser un objeto.",
  "api.error.expectedDecisionFactorObject":
    "Cada factor de decisión debe ser un objeto.",
  "api.error.expectedDecisionObject": "La decisión debe ser un objeto.",
  "api.error.expectedEffectObjectOrNull": '"effect" debe ser un objeto o null.',
  "api.error.expectedOutcomeObject":
    "El resultado del efecto debe ser un objeto.",
  "api.error.unsupportedOutcomeStatus":
    "Estado de resultado no soportado: {status}",
  "api.error.expectedLedgerObject":
    "La entrada del registro de efectos debe ser un objeto.",
  "api.error.expectedSettingsObject":
    "La respuesta de ajustes debe ser un objeto.",
  "api.error.expectedCurrentRelease":
    '"currentRelease" debe ser un objeto o null.',
  "api.error.expectedCurrentReleaseDocument":
    '"currentRelease.document" debe ser un objeto.',
  "api.error.expectedAudioPrivacyObjects":
    "El documento de ajustes debe contener los objetos audio y privacy.",
  "api.error.expectedContextEventObject":
    "Cada evento de contexto debe ser un objeto.",
  "api.error.expectedSnapshotObject":
    "La instantánea del Observatorio debe ser un objeto.",
  "api.error.expectedSnapshotKey":
    'La instantánea del Observatorio debe incluir "{key}".',
  "api.error.expectedPrivacyPayloadLocalOnly":
    "El Observatorio rechazó una carga de privacidad que no es estrictamente solo local.",
  "api.error.expectedEventPageObject":
    "La página de eventos debe ser un objeto.",
  "api.error.expectedNextCursor":
    '"nextCursor" debe ser una cadena, null u omitirse.',
  "api.error.expectedHasMoreBoolean":
    '"hasMore" debe ser un booleano cuando está presente.',
  "api.error.expectedCursorWhenHasMore":
    '"nextCursor" debe ser no null cuando "hasMore" es true.',
  "api.error.expectedEventObject": "Cada evento debe ser un objeto.",
  "api.error.expectedMetadataJson":
    'Los "metadata" del evento deben contener valores compatibles con JSON.',
  "api.error.expectedEffectResultObject":
    "El resultado del comando de efecto debe ser un objeto.",
  "api.error.unknownEffect": "El servidor local ya no sigue este efecto.",
  "api.error.expectedLlmObject":
    "El resultado de generación LLM debe ser un objeto.",
  "api.error.expectedModelLength":
    '"model" debe ser una cadena no vacía de 128 caracteres como máximo.',
  "api.error.expectedBootstrapObject":
    "La respuesta bootstrap debe ser un objeto.",
  "api.error.invalidJsonDetail": "El servidor devolvió JSON inválido: {detail}",
  "api.error.invalidJson": "El servidor devolvió JSON inválido.",
  "api.error.requestAborted": "Solicitud cancelada.",
  "api.error.unreachable": "No se puede alcanzar el servidor local de Muses.",
  "api.error.httpStatus": "El servidor local de Muses devolvió HTTP {status}.",
  "api.error.effectIdRequired":
    "Un resultado de efecto necesita un effectId de la instantánea actual del Observatorio.",
  "api.error.unknownDashboardError": "Error desconocido del Observatorio.",

  // -- auth (iniciar sesión / registro / gestión de usuarios) --------------------

  "auth.gate.checking": "Comprobando tu sesión…",
  "auth.session.signOut": "Cerrar sesión",
  "auth.session.adminLink": "Gestión de usuarios",
  "auth.session.settingsLink": "Ajustes",
  "auth.error.network": "No se puede conectar con el servidor de Muses.",
  "auth.error.sessionExpired":
    "Tu sesión ha caducado: vuelve a iniciar sesión.",

  // -- iniciar sesión ---------------------------------------------------------------
  "auth.login.title": "Iniciar sesión",
  "auth.login.subtitle": "Usa el correo y la contraseña de tu cuenta de Muses.",
  "auth.login.emailLabel": "Correo",
  "auth.login.passwordLabel": "Contraseña",
  "auth.login.submit": "Iniciar sesión",
  "auth.login.submitting": "Iniciando sesión…",
  "auth.login.toRegister": "¿Sin cuenta? Crea una",

  // -- registro --------------------------------------------------------------------
  "auth.register.title": "Crear cuenta",
  "auth.register.subtitle":
    "Recibe un código por correo y luego define tu contraseña.",
  "auth.register.stepsAria": "Pasos de registro",
  "auth.register.stepEmail": "Correo",
  "auth.register.stepVerify": "Verificación",
  "auth.register.stepDone": "Listo",
  "auth.register.emailLabel": "Correo",
  "auth.register.emailPlaceholder": "tu@ejemplo.com",
  "auth.register.sendCode": "Enviar código",
  "auth.register.sending": "Enviando…",
  "auth.register.invalidEmail": "Introduce una dirección de correo válida.",
  "auth.register.changeEmail": "Cambiar correo",
  "auth.register.codeLabel": "Código de verificación",
  "auth.register.codePlaceholder": "Código de 6 dígitos",
  "auth.register.codeSent": "Código enviado: revisa tu bandeja de entrada.",
  "auth.register.devCode": "Código de desarrollo: {code}",
  "auth.register.resend": "Reenviar código",
  "auth.register.resendIn": "Reenviar en {seconds} s",
  "auth.register.codeRequired":
    "Introduce el código de verificación del correo.",
  "auth.register.passwordLabel": "Contraseña",
  "auth.register.passwordHint": "Al menos 6 caracteres.",
  "auth.register.passwordTooShort":
    "La contraseña debe tener al menos 6 caracteres.",
  "auth.register.displayNameLabel": "Nombre visible (opcional)",
  "auth.register.displayNamePlaceholder":
    "Por defecto, el prefijo de tu correo",
  "auth.register.submit": "Crear cuenta",
  "auth.register.submitting": "Creando…",
  "auth.register.doneTitle": "Cuenta creada",
  "auth.register.doneBody": "Bienvenido, {name}: has iniciado sesión.",
  "auth.register.continue": "Continuar",
  "auth.register.toLogin": "¿Ya tienes cuenta? Inicia sesión",

  // -- gestión de usuarios --------------------------------------------------------
  "auth.admin.title": "Administración de usuarios",
  "auth.admin.subtitle": "Cuentas locales: activar, desactivar y eliminar.",
  "auth.admin.loading": "Cargando usuarios…",
  "auth.admin.loadFailed": "No se pudieron cargar los usuarios.",
  "auth.admin.actionFailed": "La acción falló.",
  "auth.admin.empty": "Todavía no hay usuarios.",
  "auth.admin.statsTotal": "Usuarios",
  "auth.admin.statsAdmins": "Admins",
  "auth.admin.statsDisabled": "Desactivados",
  "auth.admin.colUser": "Usuario",
  "auth.admin.colRole": "Rol",
  "auth.admin.colStatus": "Estado",
  "auth.admin.colCreatedAt": "Creado",
  "auth.admin.colActions": "Acciones",
  "auth.admin.roleAdmin": "Admin",
  "auth.admin.roleUser": "Usuario",
  "auth.admin.active": "Activo",
  "auth.admin.disabled": "Desactivado",
  "auth.admin.activate": "Activar",
  "auth.admin.deactivate": "Desactivar",
  "auth.admin.delete": "Eliminar",
  "auth.admin.confirmDelete": "Confirmar eliminación",
  "auth.admin.processing": "Procesando…",
  "auth.admin.selfProtected": "No puedes modificar tu propia cuenta aquí.",
  "auth.admin.deniedTitle": "Solo administradores",
  "auth.admin.deniedBody":
    "Inicia sesión con una cuenta de administrador para gestionar usuarios.",
  // -- v0.7 self-track player (batch 1, C path) ---------------------------
  "player.title": "Pista personal",
  "player.subtitle": "Tu estado, orquestado por la señal.",
  "player.state.idle": "Inactivo",
  "player.state.playing": "Reproduciendo",
  "player.state.crossfading": "Fundido cruzado",
  "player.state.ended": "Terminado",
  "player.control.start": "Iniciar",
  "player.control.stop": "Detener",
  "player.control.skip": "Saltar",
  "player.nowPlaying.label": "Sonando",
  "player.attribution.label": "Licencia",
  "player.plan.localStubNotice":
    "Plan local — la API del plan de reproducción aún no está conectada.",

  // -- v0.7 vibe signature (batch 1, C path) ------------------------------
  "signature.title": "Firma Vibe",
  "signature.subtitle":
    "Cómo se traducen tus estados en música. v0: plantillas y ajuste manual.",
  "signature.template.minimalElectronic.name": "Electrónica minimalista",
  "signature.template.minimalElectronic.description":
    "Pulsos estables para la concentración profunda. ~118–138 BPM, energía con tope, voz escasa.",
  "signature.template.ambient.name": "Ambiental",
  "signature.template.ambient.description":
    "Texturas para la calma y la recuperación. ~60–80 BPM, baja energía, sin voz.",
  "signature.template.lofiJazz.name": "Jazz lo-fi",
  "signature.template.lofiJazz.description":
    "Acordes polvorientos para el trabajo sin prisa. ~70–90 BPM, energía media, voz ligera.",
  "signature.calibration.bpmMin.label": "Límite BPM inferior",
  "signature.calibration.bpmMax.label": "Límite BPM superior",
  "signature.calibration.energyCap.label": "Tope de energía",
  "signature.calibration.vocalDensity.label": "Densidad vocal",
  "signature.calibration.vocalDensity.none": "Ninguna",
  "signature.calibration.vocalDensity.low": "Baja",
  "signature.calibration.vocalDensity.medium": "Media",
  "signature.calibration.vocalDensity.high": "Alta",
  "signature.calibration.error.bpmRange":
    "Los límites de BPM deben cumplir 40 ≤ inferior < superior ≤ 200.",
  "signature.summary.heading": "Firma efectiva",
  "signature.summary.bpm": "Ventana BPM",
  "signature.summary.energyCap": "Tope de energía",
  "signature.summary.vocalDensity": "Densidad vocal",
  "signature.journal.notice":
    "Los saltos y reescuchas se registran pero aún no se usan para aprender.",

  // -- v0.7 journey replay (batch 2, D path) ------------------------------
  "replay.title": "Repetición",
  "replay.subtitle":
    "Tu día como línea de tiempo: arrastra para revivir cada estado.",
  "replay.loading": "Cargando jornadas…",
  "replay.empty": "Aún no hay jornadas registradas.",
  "replay.error": "Repetición no disponible:",
};
