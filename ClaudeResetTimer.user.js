// ==UserScript==
// @name         Claude Reset Timer + Auto-Send
// @namespace    ivanov007.userscripts
// @version      2.2.1
// @description  Floating panel that detects Claude's rate-limit via fetch, modal, or inline banner. Shows countdown, manual time edit, and auto-clicks Send on reset. Also counts your messages in the current chat and logs usage when the limit is hit. Supports English, Spanish, and French.
// @author       ivanov007
// @match        https://claude.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// @run-at       document-idle
// @homepageURL  https://github.com/ivanov/claude-reset-timer
// @supportURL   https://github.com/ivanov/claude-reset-timer/issues
// ==/UserScript==

(function () {
  'use strict';

  // ======================== CONFIG & I18N ========================
  const STORAGE_KEY = 'claudeResetTimer_v211';
  const MAX_SEND_ATTEMPTS = 20;
  const BASE_RETRY_DELAY = 3000;
  const MAX_RETRY_DELAY = 15000;
  const SEND_DELAY_MS = 5000;   // espera tras resetAt antes del primer clic
  const VERIFY_DELAY_MS = 5000; // espera tras un clic de enviar/reintentar antes de verificar
  const PANEL_WIDTH = 560;      // px; antes 500, ampliado para el contador de mensajes
  const COUNT_THROTTLE_MS = 1500; // frecuencia máxima de recálculo del contador
  const MAX_LIMIT_LOG = 20;       // registros de límite alcanzado que se conservan

  // Aviso por umbral: preparado pero DESACTIVADO. Cuando tengas datos reales en el
  // registro de límites, pon WARN_ENABLED = true y define uno o ambos umbrales.
  const WARN_ENABLED = false;
  const WARN_MSGS = null;   // ej. 25  -> avisa al llegar a 25 mensajes tuyos en el chat
  const WARN_CHARS = null;  // ej. 60000 -> avisa al llegar a ~60k caracteres en el chat

  // Auto-detect language from <html lang> or navigator, allow manual override
  const detectedLang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
  const supportedLangs = ['es', 'en', 'fr'];
  const lang = supportedLangs.includes(detectedLang) ? detectedLang : 'en';

  const i18n = {
    es: {
      resetLabel: 'Reinicia',
      editTitle: 'Editar hora manualmente',
      autoSend: 'Auto-enviar',
      noData: 'Sin datos aún',
      shouldHaveReset: 'Debería haber reiniciado',
      timeLeft: (h, m) => h > 0 ? `Faltan ${h}h ${m}m` : `Faltan ${m}m`,
      statusDetected: (src, time) => `Detectado (${src}) ${time}`,
      statusManualUpdate: 'Hora actualizada manualmente',
      statusAutoSendScheduled: (time) => `Auto-envío programado a las ${time}`,
      statusClickSent: 'Clic enviado, verificando...',
      statusClickNoEffect: 'Clic no tuvo efecto, reintentando...',
      statusSentOk: 'Mensaje enviado automáticamente ✔',
      statusBtnNotReady: 'Botón no disponible aún, reintentando...',
      statusTooManyRetries: 'Demasiados reintentos. Auto-envío cancelado.',
      statusWatchdog: 'Watchdog: forzando envío',
      myMsgs: 'Mis msgs',
      countTitle: 'Tus mensajes en este chat · caracteres totales del chat (estimación del peso). "~" = aproximado, leído de la pantalla',
      // Modal grande + banner pequeño inline
      modalPatterns: [
        /resets at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
        /se reinicia(?: a las)?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        /reinicia(?: a las)?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        // Banner pequeño sobre el composer
        /(?:se qued[oó] sin mensajes|has agotado tu l[ií]mite|l[ií]mite alcanzado).*?(?:se reinicia|reinicia)\s+(?:a las|en)\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        /(?:se reinicia|reinicia)\s+(?:a las|en)\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        // Redacción real observada: "se ha quedado sin mensajes gratuitos hasta las HH:MM"
        /sin mensajes.*?hasta(?: las)?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        // Genérico de respaldo: cualquier "hasta (las) HH:MM" cerca de contexto de límite
        /hasta(?: las)?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
      ],
      sendBtnLabels: ['Send message', 'Enviar mensaje', 'Envoyer le message'],
      continueBtnLabels: ['continuar', 'continue', 'continuer'],
      retryBtnLabels: ['reintentar', 'volver a intentar', 'retry', 'try again', 'réessayer', 'reessayer'],
      statusRetrying: 'Envío fallido, pulsando Reintentar...',
      ampm: true,
    },
    en: {
      resetLabel: 'Resets',
      editTitle: 'Edit time manually',
      autoSend: 'Auto-send',
      noData: 'No data yet',
      shouldHaveReset: 'Should have reset',
      timeLeft: (h, m) => h > 0 ? `${h}h ${m}m left` : `${m}m left`,
      statusDetected: (src, time) => `Detected (${src}) ${time}`,
      statusManualUpdate: 'Time updated manually',
      statusAutoSendScheduled: (time) => `Auto-send scheduled at ${time}`,
      statusClickSent: 'Click sent, verifying...',
      statusClickNoEffect: 'Click had no effect, retrying...',
      statusSentOk: 'Message sent automatically ✔',
      statusBtnNotReady: 'Button not ready yet, retrying...',
      statusTooManyRetries: 'Too many retries. Auto-send cancelled.',
      statusWatchdog: 'Watchdog: forcing send',
      myMsgs: 'My msgs',
      countTitle: 'Your messages in this chat · total chat characters (weight estimate). "~" = approximate, read from the screen',
      modalPatterns: [
        /resets at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
        /resets?\s+(?:at|in)\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        // Inline banner small
        /(?:you['']?ve hit your usage limit|you are out of messages|out of messages|usage limit reached).*?(?:resets?|window resets?)\s+(?:at|in)\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        /window resets?\s+(?:at|in)\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        // Redacción alternativa observada en español ("hasta"); posible equivalente en inglés
        /out of (?:free )?messages.*?until\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
        /until\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)/i,
      ],
      sendBtnLabels: ['Send message', 'Enviar mensaje', 'Envoyer le message'],
      continueBtnLabels: ['continue', 'continuar', 'continuer'],
      retryBtnLabels: ['retry', 'try again', 'reintentar', 'volver a intentar', 'réessayer', 'reessayer'],
      statusRetrying: 'Send failed, clicking Retry...',
      ampm: true,
    },
    fr: {
      resetLabel: 'Réinit.',
      editTitle: "Modifier l'heure manuellement",
      autoSend: 'Envoi auto',
      noData: 'Aucune donnée',
      shouldHaveReset: 'Devrait avoir réinitialisé',
      timeLeft: (h, m) => h > 0 ? `Reste ${h}h ${m}m` : `Reste ${m}m`,
      statusDetected: (src, time) => `Détecté (${src}) ${time}`,
      statusManualUpdate: 'Heure mise à jour manuellement',
      statusAutoSendScheduled: (time) => `Envoi auto programmé à ${time}`,
      statusClickSent: 'Clic envoyé, vérification...',
      statusClickNoEffect: 'Clic sans effet, nouvelle tentative...',
      statusSentOk: 'Message envoyé automatiquement ✔',
      statusBtnNotReady: 'Bouton non prêt, nouvelle tentative...',
      statusTooManyRetries: 'Trop de tentatives. Envoi auto annulé.',
      statusWatchdog: 'Watchdog: forçage envoi',
      myMsgs: 'Mes msgs',
      countTitle: 'Vos messages dans ce chat · caractères totaux du chat (estimation du poids). "~" = approximatif, lu à l’écran',
      modalPatterns: [
        /r(?:é|e)initiali[sz](?:ation|ation|é)\s+(?:à|a|at)\s+(\d{1,2}[h:]\d{2})/i,
        /r(?:é|e)initiali[sz](?:ation|ation|é)\s+(?:dans|in)\s+(\d{1,2}[h:]\d{2})/i,
        // Bannière inline
        /(?:vous avez atteint votre limite|limite atteinte|hors des messages).*?(?:se r[eé]initialise|r[eé]initialise)\s+(?:[aà]|dans)\s+(\d{1,2}[h:]\d{2})/i,
        /(?:se r[eé]initialise|r[eé]initialise)\s+(?:[aà]|dans)\s+(\d{1,2}[h:]\d{2})/i,
        // Posible redacción alternativa con "jusqu'à"
        /jusqu['’]?[aà]\s+(\d{1,2}[h:]\d{2})/i,
      ],
      sendBtnLabels: ['Envoyer le message', 'Send message', 'Enviar mensaje'],
      continueBtnLabels: ['continuer', 'continue', 'continuar'],
      retryBtnLabels: ['réessayer', 'reessayer', 'retry', 'try again', 'reintentar', 'volver a intentar'],
      statusRetrying: 'Échec de l’envoi, clic sur Réessayer...',
      ampm: false,
    },
  };

  const t = i18n[lang];

  // ======================== STATE ========================
  function sanitizeState(raw) {
    return {
      x: typeof raw.x === 'number' ? raw.x : null,
      y: typeof raw.y === 'number' ? raw.y : null,
      autoSend: !!raw.autoSend,
      resetAt: typeof raw.resetAt === 'number' ? raw.resetAt : null,
      sentForResetAt: typeof raw.sentForResetAt === 'number' ? raw.sentForResetAt : null,
      snap: raw.snap || { left: false, right: true, top: false, bottom: true },
      lang: supportedLangs.includes(raw.lang) ? raw.lang : lang,
      limitLog: Array.isArray(raw.limitLog) ? raw.limitLog.slice(-MAX_LIMIT_LOG) : [],
    };
  }

  const state = Object.assign(
    { x: null, y: null, autoSend: false, resetAt: null, sentForResetAt: null, snap: null, lang, limitLog: [] },
    sanitizeState(GM_getValue(STORAGE_KEY, {}))
  );

  function saveState() {
    GM_setValue(STORAGE_KEY, state);
  }

  function alreadySentForCurrentCycle() {
    return state.resetAt !== null && state.sentForResetAt === state.resetAt;
  }

  let autoSendTimer = null;
  let sendAttempts = 0;

  // ======================== CHAT STATS & LIMIT LOG ========================
  // Selector confirmado con el HTML real: cada mensaje del usuario es un
  // div[data-testid="user-message"]; cada turno (usuario + Claude) es un
  // [data-transcript-row].
  // Respaldo: cuenta lo que hay PINTADO en pantalla. claude.ai virtualiza la lista,
  // así que en chats largos esto puede ser menor que el total real.
  function getDomStats() {
    const msgs = document.querySelectorAll('[data-testid="user-message"]').length;
    let chars = 0;
    document.querySelectorAll('[data-transcript-row]').forEach((row) => {
      let n = (row.textContent || '').length;
      // Los elementos sr-only [data-find-omitted] duplican texto; se restan.
      row.querySelectorAll('[data-find-omitted]').forEach((el) => {
        n -= (el.textContent || '').length;
      });
      chars += Math.max(0, n);
    });
    return { msgs, chars };
  }

  // ---- Conteo exacto desde los datos del chat (endpoint interno de claude.ai) ----
  // Se confirmó en uso real: /api/organizations y
  // /api/organizations/{org}/chat_conversations/{chat}?tree=True&rendering_mode=messages&render_all_tools=true
  // devuelven chat_messages (sender, text, content, parent_message_uuid) y
  // current_leaf_message_uuid. Es un endpoint no documentado: si falla, se usa el DOM.
  let apiOrgId = null;
  let apiStats = null;      // { chatId, msgs, chars }
  let apiFetching = false;
  let apiPending = false;
  let apiFailCount = 0;
  let apiTimer = null;

  function currentChatId() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  function apiValid() {
    const id = currentChatId();
    return !!(apiStats && id && apiStats.chatId === id);
  }

  function messageChars(m) {
    let n = 0;
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && typeof b.text === 'string') n += b.text.length;
      }
    }
    if (n === 0 && typeof m.text === 'string') n = m.text.length;
    return n;
  }

  // Con tree=True la respuesta puede incluir ramas abandonadas (ediciones/reintentos).
  // Solo cuenta la rama activa: desde current_leaf_message_uuid hacia atrás.
  function computeBranchStats(conv) {
    const list = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];
    const byId = new Map(list.map((m) => [m.uuid, m]));
    let branch = [];
    let cur = byId.get(conv.current_leaf_message_uuid);
    if (cur) {
      const seen = new Set();
      while (cur && !seen.has(cur.uuid)) {
        seen.add(cur.uuid);
        branch.push(cur);
        cur = byId.get(cur.parent_message_uuid);
      }
    } else {
      branch = list; // sin hoja conocida: se cuentan todos
    }
    let msgs = 0, chars = 0;
    for (const m of branch) {
      if (m.sender === 'human') msgs++;
      chars += messageChars(m);
    }
    return { msgs, chars, branchLen: branch.length, total: list.length };
  }

  async function apiGetJson(url) {
    const r = await origFetch.call(window, url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function refreshApiStats() {
    const chatId = currentChatId();
    if (!chatId || apiFailCount >= 3) return;
    if (apiFetching) { apiPending = true; return; }
    apiFetching = true;
    try {
      const path = (org) => `/api/organizations/${org}/chat_conversations/${chatId}?tree=True&rendering_mode=messages&render_all_tools=true`;
      let conv = null;
      if (apiOrgId) {
        conv = await apiGetJson(path(apiOrgId));
      } else {
        const orgs = await apiGetJson('/api/organizations');
        for (const o of (Array.isArray(orgs) ? orgs : [])) {
          try {
            conv = await apiGetJson(path(o.uuid));
            apiOrgId = o.uuid;
            break;
          } catch (e) { /* probar la siguiente organización */ }
        }
        if (!conv) throw new Error('no organization returned the conversation');
      }
      const s = computeBranchStats(conv);
      if (currentChatId() === chatId) {
        apiStats = { chatId, msgs: s.msgs, chars: s.chars };
      }
      apiFailCount = 0;
      console.log('[ClaudeResetTimer] chat stats (API)', { msgs: s.msgs, chars: s.chars, branchLen: s.branchLen, total: s.total });
    } catch (e) {
      apiFailCount++;
      console.log('[ClaudeResetTimer] chat stats API failed (' + apiFailCount + '/3), using DOM fallback', e);
    } finally {
      apiFetching = false;
      if (typeof updateCounter === 'function') updateCounter();
      if (apiPending) {
        apiPending = false;
        scheduleApiRefresh(300);
      }
    }
  }

  function scheduleApiRefresh(delay) {
    if (apiTimer) clearTimeout(apiTimer);
    apiTimer = setTimeout(() => { apiTimer = null; refreshApiStats(); }, delay);
  }

  // Estadísticas a mostrar/registrar: API si es válida para este chat; si no, DOM (aprox.)
  function getChatStats() {
    if (apiValid()) return { msgs: apiStats.msgs, chars: apiStats.chars, approx: false };
    const d = getDomStats();
    d.approx = true;
    return d;
  }

  function isOverThreshold(s) {
    if (!WARN_ENABLED) return false;
    return (WARN_MSGS !== null && s.msgs >= WARN_MSGS) ||
           (WARN_CHARS !== null && s.chars >= WARN_CHARS);
  }

  // Guarda cuántos mensajes/caracteres tenía el chat al alcanzar el límite.
  // Se deduplica por hora de reinicio (fetch y aviso suelen detectar el mismo ciclo).
  function logLimitHit(source, resetAtMs) {
    try {
      const log = Array.isArray(state.limitLog) ? state.limitLog : [];
      const last = log[log.length - 1];
      if (last && Math.abs(last.resetAt - resetAtMs) < 120000) return;
      const s = getChatStats();
      const rec = {
        at: new Date().toLocaleString(),
        resetAt: resetAtMs, // numérico (ms) para deduplicar
        resetAtLocal: new Date(resetAtMs).toLocaleString(),
        source,
        msgs: s.msgs,
        chars: s.chars,
        approx: s.approx, // true = leído del DOM (puede estar incompleto)
        path: location.pathname,
      };
      log.push(rec);
      state.limitLog = log.slice(-MAX_LIMIT_LOG);
      saveState();
      console.log('[ClaudeResetTimer] limit hit', rec);
      console.table(state.limitLog);
    } catch (e) {
      console.log('[ClaudeResetTimer] limit log error', e);
    }
  }

  // ======================== FETCH INTERCEPTOR ========================
  function applyResetFromUnixSeconds(unixSeconds, source) {
    const ms = unixSeconds * 1000;
    if (state.resetAt === ms) return;
    state.resetAt = ms;
    logLimitHit(source, ms);
    saveState();
    render();
    setStatus(t.statusDetected(source, new Date().toLocaleTimeString()));
    if (state.autoSend) scheduleAutoSend();
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : (req && req.url) || '';
      if (url.includes('/completion') || url.includes('/message')) {
        promise.then((response) => {
          try {
            response
              .clone()
              .text()
              .then((text) => {
                let resetsAt = null;
                // Try JSON parse first
                try {
                  const json = JSON.parse(text);
                  if (json.error?.resetsAt) resetsAt = json.error.resetsAt;
                  else if (json.resetsAt) resetsAt = json.resetsAt;
                  else if (json.details?.resetsAt) resetsAt = json.details.resetsAt;
                } catch {
                  const m = text.match(/"resetsAt"\s*:\s*(\d+)/);
                  if (m) resetsAt = parseInt(m[1], 10);
                }
                if (resetsAt) {
                  applyResetFromUnixSeconds(resetsAt, 'fetch');
                }
                // Terminó una respuesta (enviar, editar o reintentar): recontar
                if (url.includes('/completion')) scheduleApiRefresh(800);
              })
              .catch(() => {});
          } catch (e) {}
        }).catch(() => {});
      }
    } catch (e) {
      console.log('[ClaudeResetTimer] fetch patch error', e);
    }
    return promise;
  };

  // ======================== UI ========================
  const panel = document.createElement('div');
  panel.id = 'crt-panel';
  panel.innerHTML = `
    <div id="crt-grip"><span></span><span></span><span></span></div>
    <div id="crt-body">
      <div class="crt-col" id="crt-col-time">
        <div id="crt-row">
          <span id="crt-label">${t.resetLabel}</span>
          <button id="crt-edit" title="${t.editTitle}">✎</button>
        </div>
        <span id="crt-time">--:--</span>
        <div id="crt-countdown">${t.noData}</div>
      </div>
      <div id="crt-divider"></div>
      <div class="crt-col" id="crt-col-actions">
        <label id="crt-autosend-label">
          <input type="checkbox" id="crt-autosend" />
          ${t.autoSend}
        </label>
        <div id="crt-status"></div>
      </div>
      <div id="crt-divider2"></div>
      <div class="crt-col" id="crt-col-count">
        <span id="crt-count" title="${t.countTitle}">${t.myMsgs} --</span>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    #crt-panel {
      --crt-bg: #2d2d2f;
      --crt-grip-bg: #262628;
      --crt-border: #3f3f42;
      --crt-text: #ececec;
      --crt-text-dim: #9a9a9f;
      --crt-text-dim2: #b8b8bd;
      --crt-text-dim3: #7c7c82;
      --crt-text-label: #dcdce0;
      --crt-dot: #55555a;
      --crt-input-bg: #1e1e20;
      --crt-shadow: rgba(0,0,0,.45);

      position: fixed;
      height: 28px;
      width: ${PANEL_WIDTH}px;
      display: flex;
      flex-direction: row;
      background: var(--crt-bg);
      color: var(--crt-text);
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      border: 1px solid var(--crt-border);
      border-radius: 14px;
      z-index: 999999;
      box-shadow: 0 6px 20px var(--crt-shadow);
      user-select: none;
      overflow: hidden;
      transition: background .25s, border-color .25s, color .25s;
    }
    #crt-panel.crt-light {
      --crt-bg: #ffffff;
      --crt-grip-bg: #f0f0f1;
      --crt-border: #dcdce0;
      --crt-text: #1a1a1a;
      --crt-text-dim: #6b6b70;
      --crt-text-dim2: #55555a;
      --crt-text-dim3: #85858a;
      --crt-text-label: #2a2a2c;
      --crt-dot: #b5b5ba;
      --crt-input-bg: #f5f5f6;
      --crt-shadow: rgba(0,0,0,.15);
    }
    #crt-grip {
      flex: 0 0 18px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 3px;
      cursor: move;
      background: var(--crt-grip-bg);
    }
    #crt-grip span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--crt-dot);
    }
    #crt-body {
      flex: 1;
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 0 12px;
      gap: 10px;
      min-width: 0;
    }
    .crt-col {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    #crt-col-time { flex: 1.2; }
    #crt-col-actions { flex: 1; }
    #crt-col-count { flex: 0 0 auto; }
    #crt-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    #crt-label { color: var(--crt-text-dim); font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
    #crt-time { font-weight: 600; font-size: 12px; }
    #crt-edit {
      background: none;
      border: none;
      color: var(--crt-text-dim);
      cursor: pointer;
      font-size: 10px;
      padding: 1px 3px;
      border-radius: 4px;
      line-height: 1;
    }
    #crt-edit:hover { background: var(--crt-border); color: var(--crt-text); }
    #crt-time-input {
      font: inherit;
      font-weight: 600;
      font-size: 12px;
      width: 80px;
      background: var(--crt-input-bg);
      color: var(--crt-text);
      border: 1px solid var(--crt-dot);
      border-radius: 6px;
      padding: 0 4px;
    }
    #crt-countdown {
      color: var(--crt-text-dim2);
      font-size: 10px;
    }
    #crt-count {
      color: var(--crt-text-dim2);
      font-size: 10px;
      white-space: nowrap;
    }
    #crt-count.crt-warn {
      color: #e5534b;
      font-weight: 600;
    }
    #crt-divider,
    #crt-divider2 {
      align-self: stretch;
      width: 1px;
      background: var(--crt-border);
      margin: 5px 0;
    }
    #crt-autosend-label {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      color: var(--crt-text-label);
      font-size: 10px;
    }
    #crt-status {
      color: var(--crt-text-dim3);
      font-size: 9px;
    }
  `;
  document.head.appendChild(style);

  // ======================== TEMA CLARO/OSCURO ========================
  function detectDarkMode() {
    const html = document.documentElement;
    // Señal 1: clases típicas de Tailwind/apps modernas en <html>
    if (html.classList.contains('dark')) return true;
    if (html.classList.contains('light')) return false;
    // Señal 2: atributo data-theme, usado por algunos frameworks
    const dataTheme = html.getAttribute('data-theme');
    if (dataTheme === 'dark') return true;
    if (dataTheme === 'light') return false;
    // Respaldo: preferencia del sistema operativo/navegador
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    panel.classList.toggle('crt-light', !detectDarkMode());
  }

  applyTheme();

  // Si la página cambia de tema en caliente (toggle de dark/light sin recargar),
  // el cambio normalmente se refleja como una modificación de clase/atributo en <html>.
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });

  // Respaldo adicional: si el usuario cambia el tema del SO mientras la pestaña está abierta
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }

  // ======================== POSITION ========================
  const SNAP_MARGIN = 12;
  const SNAP_THRESHOLD = 28;

  if (!state.snap) {
    state.snap = { left: false, right: true, top: false, bottom: true };
  }

  function applySnap() {
    const w = panel.offsetWidth || PANEL_WIDTH;
    const h = panel.offsetHeight || 28;
    if (state.snap.left) state.x = SNAP_MARGIN;
    if (state.snap.right) state.x = window.innerWidth - w - SNAP_MARGIN;
    if (state.snap.top) state.y = SNAP_MARGIN;
    if (state.snap.bottom) state.y = window.innerHeight - h - SNAP_MARGIN;
    panel.style.left = state.x + 'px';
    panel.style.top = state.y + 'px';
  }

  if (state.x === null || state.y === null) {
    applySnap();
  } else {
    panel.style.left = state.x + 'px';
    panel.style.top = state.y + 'px';
  }

  window.addEventListener('resize', applySnap);

  // ======================== DRAG ========================
  const grip = panel.querySelector('#crt-grip');
  let dragging = false, offX = 0, offY = 0;
  grip.addEventListener('mousedown', (e) => {
    dragging = true;
    offX = e.clientX - panel.offsetLeft;
    offY = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.x = e.clientX - offX;
    state.y = e.clientY - offY;
    panel.style.left = state.x + 'px';
    panel.style.top = state.y + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;

    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const nearLeft = state.x <= SNAP_THRESHOLD;
    const nearRight = window.innerWidth - (state.x + w) <= SNAP_THRESHOLD;
    const nearTop = state.y <= SNAP_THRESHOLD;
    const nearBottom = window.innerHeight - (state.y + h) <= SNAP_THRESHOLD;

    state.snap = { left: nearLeft, right: nearRight, top: nearTop, bottom: nearBottom };
    if (nearLeft || nearRight || nearTop || nearBottom) {
      applySnap();
    }
    saveState();
  });

  // ======================== ELEMENTS & RENDER ========================
  const timeEl = panel.querySelector('#crt-time');
  const editBtn = panel.querySelector('#crt-edit');
  const countdownEl = panel.querySelector('#crt-countdown');
  const statusEl = panel.querySelector('#crt-status');
  const autoSendCb = panel.querySelector('#crt-autosend');

  autoSendCb.checked = !!state.autoSend;
  autoSendCb.addEventListener('change', () => {
    state.autoSend = autoSendCb.checked;
    saveState();
    if (state.autoSend && state.resetAt) scheduleAutoSend();
    else clearAutoSend();
  });

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function fmtTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function render() {
    if (!state.resetAt) {
      timeEl.textContent = '--:--';
      countdownEl.textContent = t.noData;
      return;
    }
    const resetDate = new Date(state.resetAt);
    timeEl.textContent = fmtTime(resetDate);
    const diffMs = state.resetAt - Date.now();
    if (diffMs <= 0) {
      countdownEl.textContent = t.shouldHaveReset;
    } else {
      const totalMin = Math.round(diffMs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      countdownEl.textContent = t.timeLeft(h, m);
    }
  }

  setInterval(render, 30000);
  render();

  // ======================== MESSAGE COUNTER ========================
  const countEl = panel.querySelector('#crt-count');

  function fmtChars(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  function updateCounter() {
    const s = getChatStats();
    const tilde = s.approx ? '~' : '';
    const text = `${t.myMsgs} ${tilde}${s.msgs} · ${tilde}${fmtChars(s.chars)}`;
    // Solo se escribe si cambió, para no generar mutaciones innecesarias
    if (countEl.textContent !== text) countEl.textContent = text;
    countEl.classList.toggle('crt-warn', isOverThreshold(s));
  }

  // Limitador de frecuencia: durante el streaming de una respuesta el DOM cambia
  // sin parar; se recalcula como máximo cada COUNT_THROTTLE_MS.
  let countTimer = null;
  function scheduleCount() {
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      updateCounter();
    }, COUNT_THROTTLE_MS);
  }

  const countObserver = new MutationObserver((mutations) => {
    // Con datos de la API el DOM no hace falta (y se evita el costo en chats largos)
    if (apiValid()) return;
    // Ignorar los cambios del propio panel para no entrar en bucle
    if (mutations.every((m) => panel.contains(m.target))) return;
    scheduleCount();
  });
  countObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  // claude.ai es una SPA: al cambiar de chat solo cambia la URL y el DOM se rehace
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      apiFailCount = 0;
      scheduleCount();
      scheduleApiRefresh(300);
    }
  }, 2000);

  updateCounter();
  refreshApiStats();

  // ======================== MANUAL EDIT ========================
  editBtn.addEventListener('click', () => {
    const current = state.resetAt ? new Date(state.resetAt) : new Date();
    const hh = String(current.getHours()).padStart(2, '0');
    const mm = String(current.getMinutes()).padStart(2, '0');

    const input = document.createElement('input');
    input.type = 'time';
    input.id = 'crt-time-input';
    input.value = `${hh}:${mm}`;

    timeEl.replaceWith(input);
    input.focus();

    function commit() {
      const [h, m] = input.value.split(':').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const target = new Date();
        target.setHours(h, m, 0, 0);
        if (target.getTime() <= Date.now()) {
          target.setDate(target.getDate() + 1);
        }
        state.resetAt = target.getTime();
        saveState();
        if (state.autoSend) scheduleAutoSend();
        setStatus(t.statusManualUpdate);
      }
      input.replaceWith(timeEl);
      render();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  });

  // ======================== MODAL & BANNER DETECTION ========================
  function tryParseFromText(text) {
    for (const pattern of t.modalPatterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const timeStr = match[1].replace(/\s+/g, ' ').trim();
      const parsed = parseTimeStrToDate(timeStr);
      if (!parsed) continue;

      const changed = state.resetAt !== parsed.getTime();
      state.resetAt = parsed.getTime();
      if (changed) logLimitHit('banner/modal', state.resetAt);
      saveState();
      render();
      setStatus(t.statusDetected('banner/modal', new Date().toLocaleTimeString()));
      if (state.autoSend) scheduleAutoSend();
      return true;
    }
    return false;
  }

  function tryParseFromNode(node) {
    return tryParseFromText(node.textContent || '');
  }

  function parseTimeStrToDate(timeStr) {
    // Supports "7:50 PM", "19:30", "19h30"
    const normalized = timeStr.replace('h', ':');
    const m = normalized.match(/(\d{1,2}):(\d{2})(?:\s?(AM|PM))?/i);
    if (!m) return null;
    let [, hh, mm, ampm] = m;
    hh = parseInt(hh, 10);
    mm = parseInt(mm, 10);

    if (ampm) {
      ampm = ampm.toUpperCase();
      if (ampm === 'PM' && hh !== 12) hh += 12;
      if (ampm === 'AM' && hh === 12) hh = 0;
    }

    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  // Observer para nodos añadidos
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Revisar el nodo añadido y sus descendientes
        if (tryParseFromNode(node)) return;
        // Si el nodo añadido es un contenedor, revisar sus hijos
        if (node.querySelectorAll) {
          for (const child of node.querySelectorAll('*')) {
            if (tryParseFromNode(child)) return;
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Scan inicial
  tryParseFromNode(document.body);

  // Scan periódico de respaldo (cada 10s) para banners que ya existen
  // o que el observer pueda haber perdido
  setInterval(() => {
    if (state.resetAt && state.resetAt > Date.now()) return; // ya tenemos datos válidos
    tryParseFromNode(document.body);
  }, 10000);

  // ======================== AUTO-SEND (ROBUST) ========================
  function clearAutoSend() {
    if (autoSendTimer) {
      clearTimeout(autoSendTimer);
      autoSendTimer = null;
    }
  }

  function scheduleAutoSend() {
    clearAutoSend();
    sendAttempts = 0;
    if (!state.resetAt) return;
    if (alreadySentForCurrentCycle()) return;
    // Se espera SEND_DELAY_MS extra: al segundo exacto del reinicio el servidor
    // a veces todavía rechaza el envío.
    const delay = state.resetAt + SEND_DELAY_MS - Date.now();
    if (delay <= 0) {
      attemptSend();
      return;
    }
    setStatus(t.statusAutoSendScheduled(fmtTime(new Date(state.resetAt))));
    autoSendTimer = setTimeout(attemptSend, delay);
  }

  function findSendButton() {
    // Exact aria-label match (multiple languages)
    for (const label of t.sendBtnLabels) {
      const btn = document.querySelector(`button[aria-label="${label}"]`);
      if (btn) return btn;
    }
    // Fallback by data-testid
    const byTestId = document.querySelector('button[data-testid="send-button"]');
    if (byTestId) return byTestId;
    // Fallback by text content
    return [...document.querySelectorAll('button')].find(b => {
      const lbl = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
      return lbl.includes('send') || lbl.includes('enviar') || lbl.includes('envoyer');
    });
  }

  // El botón "Continue" no tiene aria-label: se identifica por texto exacto.
  // Se excluyen los botones del propio panel.
  function findContinueButton() {
    const labels = t.continueBtnLabels;
    return [...document.querySelectorAll('button')].find(b => {
      if (panel.contains(b)) return false;
      const txt = (b.textContent || '').trim().toLowerCase();
      return labels.includes(txt);
    }) || null;
  }

  // El enlace "Reintentar" es un <span role="button">, no un <button>.
  function findRetryLink() {
    const labels = t.retryBtnLabels;
    return [...document.querySelectorAll('[role="button"], button')].find(el => {
      if (panel.contains(el)) return false;
      const txt = (el.textContent || '').trim().toLowerCase();
      return labels.includes(txt);
    }) || null;
  }

  function isButtonEnabled(btn) {
    return !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
  }

  let lastClick = null; // { el, kind: 'send' | 'continue' | 'retry' }

  function synthClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };

    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
  }

  function getRetryDelay() {
    // Exponential backoff with cap
    return Math.min(MAX_RETRY_DELAY, BASE_RETRY_DELAY * Math.pow(2, sendAttempts));
  }

  function verifySendResult() {
    autoSendTimer = null; // the timeout that called us has expired

    let failed;
    if (lastClick && lastClick.kind === 'continue') {
      // Continuar: éxito si el botón desapareció o volvió a deshabilitarse
      const stillThere = document.contains(lastClick.el) && isButtonEnabled(lastClick.el);
      failed = stillThere;
      console.log('[ClaudeResetTimer] post-click verification (continue)', new Date().toLocaleTimeString(), { stillThere });
    } else if (lastClick && lastClick.kind === 'retry') {
      // Reintentar: éxito si el enlace desapareció
      const retryStillThere = !!findRetryLink();
      failed = retryStillThere;
      console.log('[ClaudeResetTimer] post-click verification (retry)', new Date().toLocaleTimeString(), { retryStillThere });
    } else {
      // Enviar: falla si el texto sigue en el cuadro O si apareció el enlace
      // "Reintentar" (el mensaje pasó al chat con error y el cuadro quedó vacío).
      const composer = document.querySelector('div.ProseMirror');
      const stillHasText = !!composer && composer.innerText.trim().length > 0;
      const retryStillThere = !!findRetryLink();
      failed = stillHasText || retryStillThere;
      console.log('[ClaudeResetTimer] post-click verification (send)', new Date().toLocaleTimeString(), { stillHasText, retryStillThere });
    }

    if (failed) {
      setStatus(t.statusClickNoEffect);
      sendAttempts++;
      if (sendAttempts >= MAX_SEND_ATTEMPTS) {
        setStatus(t.statusTooManyRetries);
        state.autoSend = false;
        autoSendCb.checked = false;
        saveState();
        return;
      }
      autoSendTimer = setTimeout(attemptSend, getRetryDelay());
    } else {
      setStatus(t.statusSentOk);
      sendAttempts = 0;
      state.sentForResetAt = state.resetAt;
      saveState();
    }
  }

  function attemptSend() {
    autoSendTimer = null; // the timeout that called us has expired
    if (!state.autoSend) return;
    if (alreadySentForCurrentCycle()) return;

    if (sendAttempts >= MAX_SEND_ATTEMPTS) {
      setStatus(t.statusTooManyRetries);
      state.autoSend = false;
      autoSendCb.checked = false;
      saveState();
      return;
    }

    // Prioridad: 1) enlace "Reintentar" si un envío anterior falló;
    // 2) si hay texto escrito, botón de enviar;
    // 3) si el cuadro está vacío, botón "Continuar" (y al final el de enviar).
    const retryLink = findRetryLink();
    const composer = document.querySelector('div.ProseMirror');
    const hasText = !!composer && composer.innerText.trim().length > 0;
    const continueBtn = (retryLink || hasText) ? null : findContinueButton();
    const targetBtn = retryLink || continueBtn || findSendButton();
    const kind = retryLink ? 'retry' : (continueBtn ? 'continue' : 'send');
    const info = targetBtn ? {
      kind,
      found: true,
      disabled: targetBtn.disabled,
      ariaDisabled: targetBtn.getAttribute('aria-disabled')
    } : { kind, found: false };
    console.log('[ClaudeResetTimer] attempt #' + (sendAttempts + 1), new Date().toLocaleTimeString(), info);

    if (isButtonEnabled(targetBtn)) {
      lastClick = { el: targetBtn, kind };
      synthClick(targetBtn);
      setStatus(kind === 'retry' ? t.statusRetrying : t.statusClickSent);
      // "Continuar" desaparece casi al instante; enviar/reintentar necesitan más margen
      autoSendTimer = setTimeout(verifySendResult, kind === 'continue' ? 1000 : VERIFY_DELAY_MS);
      return;
    }

    sendAttempts++;
    setStatus(t.statusBtnNotReady);
    autoSendTimer = setTimeout(attemptSend, getRetryDelay());
  }

  // Resume on page load
  if (state.autoSend && state.resetAt && !alreadySentForCurrentCycle()) {
    if (state.resetAt + SEND_DELAY_MS > Date.now()) {
      scheduleAutoSend();
    } else {
      attemptSend();
    }
  }

  // ======================== WATCHDOG ========================
  setInterval(() => {
    if (state.autoSend && state.resetAt && !alreadySentForCurrentCycle() &&
        Date.now() >= state.resetAt && !autoSendTimer) {
      console.log('[ClaudeResetTimer] watchdog:', t.statusWatchdog);
      attemptSend();
    }
  }, 20000);
})();
