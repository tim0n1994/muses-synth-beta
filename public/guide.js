// Muses guide standalone: language toggle with persistence (zcode widgetState kept when embedded)
(function () {
  var root = document.getElementById("muses-guide");
  function persist(lang) {
    try { localStorage.setItem("muses-guide-lang", lang); } catch (e) {}
    try {
      if (window.zcode && window.zcode.setWidgetState) {
        window.zcode.setWidgetState({ privateContent: { lang: lang } }).catch(function () {});
      }
    } catch (e) {}
  }
  function apply(lang, save) {
    if (lang !== "zh" && lang !== "en") lang = "zh";
    root.className = lang;
    document.getElementById("mg-lang-zh").setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
    document.getElementById("mg-lang-en").setAttribute("aria-pressed", lang === "en" ? "true" : "false");
    if (save) persist(lang);
  }
  document.getElementById("mg-lang-zh").addEventListener("click", function () { apply("zh", true); });
  document.getElementById("mg-lang-en").addEventListener("click", function () { apply("en", true); });
  var saved = null;
  try { saved = localStorage.getItem("muses-guide-lang"); } catch (e) {}
  if (!saved) {
    try {
      saved = window.zcode && window.zcode.widgetState && window.zcode.widgetState.privateContent
        && window.zcode.widgetState.privateContent.lang;
    } catch (e) {}
  }
  if (!saved) {
    try { saved = (navigator.language || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en"; } catch (e) { saved = "en"; }
  }
  apply(saved, false);
})();
