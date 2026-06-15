// ==UserScript==
// @name         BAIXATRON - Auto Downloader Universal
// @namespace    https://github.com/HelloKiw1
// @version      3.1
// @description  👾 O Alien que invade downloads! 📡 - Painel visual para download automático de arquivos
// @author       HelloKiw1
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">👾</text></svg>
// ==/UserScript==

/**
 * BAIXATRON - AUTO-DOWNLOADER UNIVERSAL v3.1 COM PAINEL VISUAL
 *
 * 👾 O Alien que invade downloads! 📡
 *
 * Produzido por HelloKiw1
 * GitHub: https://github.com/HelloKiw1
 *
 * Script com interface visual completa:
 * - Painel de controle flutuante
 * - Lista de downloads com checkboxes
 * - Barra de progresso
 * - Estatísticas em tempo real
 * - Controles de velocidade
 *
 * COMO USAR:
 * - O painel aparece automaticamente ao carregar a página
 * - Clique em [⊙] Escanear para encontrar downloads
 * - Selecione os arquivos desejados
 * - Clique em [▶] Iniciar para começar
 *
 * SEMPRE COMEÇA COM dryRun: true (MODO SEGURO)
 */

(() => {
  if (window.__dl?.stop) window.__dl.stop();

  // ============================================
  // CONFIGURAÇÕES INICIAIS
  // ============================================
  const opts = {
    dryRun: true,
    delayMs: 2000,
    waitForDownload: true,
    waitForDownloadTimeout: 3000,
    concurrency: 1,
    maxRetries: 1,
    tableExpandWaitMs: 900,
    tableExpandMaxClicks: 12,
    tableSweepMaxPages: 25,
    tableSweepTabs: true,
    tableSweepMaxTabs: 20,
    folderSweepEnabled: true,
    folderExpandWaitMs: 450,
    folderExpandMaxClicks: 400,
    rootSelector: null,
    autoDetectIframe: true,
    maxClicks: Infinity,
    dedupe: true,
    verbose: true, // ativar logs para debug
  };

  // ============================================
  // UTILITÁRIOS
  // ============================================
  const exts = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|odt|ods|txt|csv|rtf)$/i;
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const normLoose = (s) => {
    const base = norm(s || "");
    try {
      return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch {
      return base;
    }
  };

  const parseNameFilterTerms = (raw) =>
    (raw || "")
      .split(/[\n,;|]+/)
      .map((term) => term.trim())
      .filter(Boolean);

  const FILE_TYPE_ALIAS = {
    pdf: "pdf",
    csv: "csv",
    doc: "doc",
    docx: "docx",
    word: "doc",
    xls: "xls",
    xlsx: "xlsx",
    excel: "xls",
    xml: "xml",
    txt: "txt",
    text: "txt",
    rtf: "rtf",
    zip: "zip",
    rar: "rar",
    "7z": "7z",
    odt: "odt",
    ods: "ods",
    ppt: "ppt",
    pptx: "pptx",
  };

  const normalizeFileTypeToken = (raw) => {
    const cleaned = normLoose(raw || "")
      .replace(/^\.+/, "")
      .replace(/[^a-z0-9]+/g, "");

    if (!cleaned) return "";
    return FILE_TYPE_ALIAS[cleaned] || "";
  };

  const parseTypeFilterTerms = (raw) => {
    const terms = parseNameFilterTerms(raw);
    const tokens = new Set();

    const knownRegex =
      /\b(pdf|csv|docx?|xlsx?|xls|xml|txt|text|rtf|zip|rar|7z|odt|ods|pptx?|excel|word)\b/g;

    for (const term of terms) {
      const loose = normLoose(term)
        .replace(/^\s*(tipo|type)\s*[:#=\-]?\s*/i, "")
        .trim();

      const direct = normalizeFileTypeToken(loose);
      if (direct) {
        tokens.add(direct);
        continue;
      }

      knownRegex.lastIndex = 0;
      let match;
      while ((match = knownRegex.exec(loose)) !== null) {
        const normalized = normalizeFileTypeToken(match[1]);
        if (normalized) tokens.add(normalized);
      }
    }

    return Array.from(tokens);
  };

  const parseFilterCriteria = (raw) => {
    const terms = parseNameFilterTerms(raw);
    const ids = new Set();
    const idRanges = [];
    const textTokens = [];

    for (const term of terms) {
      const cleaned = term.trim();
      if (!cleaned) continue;

      const loose = normLoose(cleaned);
      const rangeMatch = loose.match(
        /^(?:de\s*)?(?:id\s*[:#-]?\s*)?(\d{1,10})\s*(?:-|ate|a|to|\.\.)\s*(?:id\s*[:#-]?\s*)?(\d{1,10})$/i,
      );
      if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
        const a = parseInt(rangeMatch[1], 10);
        const b = parseInt(rangeMatch[2], 10);
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
          idRanges.push([Math.min(a, b), Math.max(a, b)]);
          continue;
        }
      }

      const idMatch =
        cleaned.match(/^id\s*[:#-]?\s*(\d{1,10})$/i) ||
        cleaned.match(/^(\d{1,10})$/);
      if (idMatch && idMatch[1]) {
        const numeric = parseInt(idMatch[1], 10);
        if (Number.isFinite(numeric) && numeric > 0) {
          ids.add(numeric);
          continue;
        }
      }

      textTokens.push(loose);
    }

    return {
      terms,
      ids,
      idRanges,
      textTokens: textTokens.filter(Boolean),
    };
  };

  const toAbs = (href) => {
    if (!href || typeof href !== "string") return "";
    const cleaned = href.trim();
    if (!cleaned || cleaned === "#" || /^javascript:/i.test(cleaned)) return "";
    try {
      return new URL(cleaned, document.baseURI).href;
    } catch {
      return "";
    }
  };

  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };

  const sanitizeFileName = (name, defaultExt = "pdf") => {
    const base = (name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();

    if (!base) return `download.${defaultExt}`;

    // Se ja tem extensao, respeita.
    if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
    return `${base}.${defaultExt}`;
  };

  const fileNameFromContentDisposition = (headerValue) => {
    if (!headerValue) return "";
    const starMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        return decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ""));
      } catch {
        return starMatch[1].trim().replace(/^"|"$/g, "");
      }
    }
    const match = headerValue.match(/filename=([^;]+)/i);
    return match ? match[1].trim().replace(/^"|"$/g, "") : "";
  };

  const fileNameFromUrl = (url) => {
    if (!url) return "";

    try {
      const parsed = new URL(url, document.baseURI);
      const fromQuery =
        parsed.searchParams.get("filename") ||
        parsed.searchParams.get("file") ||
        parsed.searchParams.get("name");

      if (fromQuery) return decodeURIComponent(fromQuery.trim());

      const segment = (parsed.pathname.split("/").pop() || "").trim();
      if (!segment) return "";
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  };

  const splitFileNameExt = (fileName) => {
    const raw = String(fileName || "").trim();
    if (!raw) return { base: "", ext: "" };

    const extMatch = raw.match(/\.([a-z0-9]{2,5})$/i);
    if (!extMatch || !extMatch[1]) {
      return { base: raw, ext: "" };
    }

    const base = raw.slice(0, -extMatch[0].length).trim();
    const ext =
      normalizeFileTypeToken(extMatch[1]) || extMatch[1].toLowerCase();
    return { base, ext };
  };

  const cleanRecordLabel = (raw) => {
    let text = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";

    // Remove sufixo de data de publicacao quando existir.
    text = text.replace(/\s*-\s*publicado em.*$/i, "").trim();
    return text;
  };

  const slugifyRecordText = (raw) =>
    cleanRecordLabel(raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const PT_MONTHS = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12",
  };

  const pad2 = (value) => String(value || "").padStart(2, "0");

  const parseDateFromText = (raw) => {
    const text = normLoose(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";

    const ymdMatch = text.match(
      /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
    );
    if (ymdMatch) {
      return `${ymdMatch[1]}-${pad2(ymdMatch[2])}-${pad2(ymdMatch[3])}`;
    }

    const dmyMatch = text.match(
      /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/,
    );
    if (dmyMatch) {
      return `${dmyMatch[3]}-${pad2(dmyMatch[2])}-${pad2(dmyMatch[1])}`;
    }

    const ptMatch = text.match(
      /\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})\b/i,
    );
    if (ptMatch) {
      const month = PT_MONTHS[ptMatch[2].toLowerCase()];
      if (month) {
        return `${ptMatch[3]}-${month}-${pad2(ptMatch[1])}`;
      }
    }

    return "";
  };

  const parseNumeroFromText = (raw) => {
    const text = normLoose(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";

    const prefixedMatch = text.match(
      /\b(?:lei|decreto|resolucao|portaria|ato|emenda|projeto|medida|instrucao)?\s*n[ºo°.]?\s*(\d{1,6})(?:\s*\/\s*\d{4})?\b/i,
    );
    if (prefixedMatch && prefixedMatch[1]) {
      return String(parseInt(prefixedMatch[1], 10));
    }

    const lawMatch = text.match(/\blei\s*(\d{1,6})\s*\/\s*\d{4}\b/i);
    if (lawMatch && lawMatch[1]) {
      return String(parseInt(lawMatch[1], 10));
    }

    const genericMatch = text.match(/\b(\d{1,6})\s*\/\s*\d{4}\b/);
    if (genericMatch && genericMatch[1]) {
      return String(parseInt(genericMatch[1], 10));
    }

    return "";
  };

  const parseDescricaoFromText = (raw) => {
    let text = cleanRecordLabel(raw || "");
    if (!text) return "";

    text = text
      .replace(
        /^\s*(?:lei|decreto|resolucao|portaria|ato|emenda|projeto|medida|instrucao)\s*n[ºo°.]?\s*\d{1,6}(?:\s*\/\s*\d{4})?\s*/i,
        "",
      )
      .trim();
    text = text
      .replace(/^\s*\d{1,2}\s+de\s+[a-z]+\s+de\s+20\d{2}\s*/i, "")
      .trim();
    text = text.replace(/^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*/i, "").trim();
    text = text.replace(/^\s*[-–—:|]\s*/i, "").trim();
    text = text.replace(/\s+[-–—:|]\s*$/i, "").trim();

    return text;
  };

  const buildExtractedJsonRecord = (it) => {
    const liveEl = it?.el || null;
    const container = liveEl ? getContainer(liveEl) : null;
    const titleNode =
      container?.querySelector?.(
        ".card-body .ptitle, .media-body .ptitle, .ptitle",
      ) ||
      container?.querySelector?.(
        ".package-title, .entry-title, h1, h2, h3, h4",
      );
    const rawTitle = cleanRecordLabel(
      titleNode?.textContent ||
        getRecordTitle(liveEl) ||
        it?.titleName ||
        it?.text ||
        "",
    );
    const downloadNode =
      liveEl?.closest?.(
        "a[data-downloadurl], a[data-href], a[data-url], a[href]",
      ) ||
      container?.querySelector?.(
        "a[data-downloadurl], a[data-href], a[data-url], a[href]",
      ) ||
      liveEl;
    const liveUrl = extractDownloadUrl(downloadNode) || it?.url || "";
    const urlName = cleanRecordLabel(fileNameFromUrl(liveUrl) || "");
    // Prefer the final filename captured during the actual fetch/download (if available)
    const finalCaptured = it?.finalFileName || it?.finalFilename || "";
    const urlSlug = slugifyRecordText(
      urlName || liveUrl || rawTitle || it?.titleName || it?.text || "",
    );
    const slugTitle = cleanRecordLabel((urlName || "").replace(/[-_]+/g, " "));
    const resolvedTitle =
      rawTitle && !isGenericDownloadTitle(rawTitle) ? rawTitle : slugTitle;
    const numberSource = [rawTitle, urlName, liveUrl]
      .filter(Boolean)
      .join(" | ");

    // Extract descriptive paragraph immediately below title when possible
    let descriptionText = "";
    try {
      if (titleNode && titleNode.nextElementSibling) {
        const cand = titleNode.nextElementSibling;
        if ((cand.textContent || "").trim())
          descriptionText = cand.textContent.trim();
      }
      if (!descriptionText && container) {
        const candidates = container.querySelectorAll(
          "p, .description, .excerpt, .package-description, .entry-summary, .lead",
        );
        for (const c of candidates) {
          const t = (c.textContent || "").trim();
          if (t && t.length > 8) {
            descriptionText = t;
            break;
          }
        }
      }
    } catch (e) {
      descriptionText = "";
    }

    const chosenUrl = finalCaptured
      ? // ensure leading slash to match expected shape like `/filename.pdf`
        finalCaptured.startsWith("/")
        ? finalCaptured
        : "/" + finalCaptured
      : urlName
        ? urlName.startsWith("/")
          ? urlName
          : "/" + urlName
        : urlSlug || slugifyRecordText(rawTitle) || "";

    return {
      data: parseDateFromText(rawTitle) || parseDateFromText(urlName) || "",
      url: chosenUrl || "",
      numero: parseNumeroFromText(numberSource) || "",
      descricao:
        (descriptionText && cleanRecordLabel(descriptionText)) ||
        resolvedTitle ||
        parseDescricaoFromText(rawTitle) ||
        parseDescricaoFromText(urlName) ||
        "",
    };
  };

  const buildExtractedJsonPayload = (items = null) => {
    const selectedOnly =
      !items && state.selectedKeys && state.selectedKeys.size > 0
        ? state.queue.filter((item) => state.selectedKeys.has(item.key))
        : null;

    const sourceItems =
      Array.isArray(items) && items.length
        ? items
        : selectedOnly && selectedOnly.length
          ? selectedOnly
          : state.queue.length
            ? state.queue
            : collect(false);

    return sourceItems
      .map(buildExtractedJsonRecord)
      .filter((item) => item.url || item.descricao || item.numero || item.data);
  };

  const downloadExtractedJson = (
    items = null,
    fileName = "informações_extraidos.json",
  ) => {
    const payload = buildExtractedJsonPayload(items);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);

    console.log(
      "[BAIXATRON] 💾 JSON exportado:",
      fileName,
      "| itens:",
      payload.length,
    );
    return payload;
  };

  const normalizeFileSegment = (raw, compact = false) => {
    let text = cleanRecordLabel(raw);
    if (!text) return "";

    text = text
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[_]+/g, "_")
      .trim();

    if (compact) {
      text = text.replace(/\s+/g, "");
    } else {
      text = text.replace(/\s+/g, " ");
    }

    return text.replace(/^[_\-. ]+|[_\-. ]+$/g, "").trim();
  };

  const isLikelyRandomBaseName = (rawBase) => {
    const base = normLoose(rawBase || "");
    if (!base) return true;

    if (/^(download|arquivo|file|document|documento|anexo)$/i.test(base))
      return true;
    if (/^\d{6,}$/.test(base)) return true;
    if (/^[a-f0-9]{16,}$/i.test(base)) return true;

    // Tokens longos alfanumericos sem separadores geralmente sao IDs/hash.
    if (
      /^[a-z0-9]{14,}$/i.test(base) &&
      /[a-z]/i.test(base) &&
      /\d/.test(base) &&
      !/[_\- ]/.test(base)
    ) {
      return true;
    }

    if (base.length >= 24 && !/[_\- ]/.test(base)) return true;
    return false;
  };

  const isGenericDownloadTitle = (rawTitle) => {
    const title = normLoose(rawTitle || "");
    if (!title) return true;
    return /(baixe|baixar|download|arquivo em|clique aqui|visualizar|abrir arquivo)/i.test(
      title,
    );
  };

  const blobLooksLikeHtml = async (blob) => {
    if (!blob || blob.size === 0) return false;

    try {
      const head = (await blob.slice(0, 512).text()).trim().toLowerCase();
      return (
        head.startsWith("<!doctype html") ||
        head.startsWith("<html") ||
        head.includes("<head") ||
        head.includes("<body")
      );
    } catch {
      return false;
    }
  };

  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;

    try {
      // Ignora elementos não renderizados (inclusive quando o pai está com display:none).
      if (el.getClientRects().length === 0) return false;
    } catch {
      return false;
    }

    let cur = el;
    while (cur && cur.nodeType === 1) {
      const s = getComputedStyle(cur);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.opacity === "0"
      )
        return false;
      cur = cur.parentElement;
    }

    return true;
  };

  const downloadIconSignatures = [
    "M216 0h80c13.3 0 24 10.7 24 24v168",
    "M387.66 192H332V48",
  ];

  const viewIconSignatures = ["M572.52 241.4C518.29 135.59 410.93 64 288 64"];

  const hasIconPath = (el, signatures) => {
    const svgPaths = Array.from(el.querySelectorAll("svg path"));
    return svgPaths.some((path) => {
      const d = path.getAttribute("d") || "";
      return signatures.some((sig) => d.includes(sig));
    });
  };

  const hasDownloadIcon = (el) => {
    const classText = norm(el.className || "");
    if (
      /(fa-download|ri-download|icon-download|btn-download|download-btn|download-icon)/i.test(
        classText,
      )
    ) {
      return true;
    }

    return hasIconPath(el, downloadIconSignatures);
  };

  const hasViewIcon = (el) => hasIconPath(el, viewIconSignatures);

  const looksLikeDownload = (el) => {
    const text = norm(
      [
        el.innerText,
        el.textContent,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.dataset?.tooltip,
        el.dataset?.title,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const cls = norm(el.className);
    const hrefAttr =
      el.getAttribute("href") ||
      el.dataset.href ||
      el.dataset.url ||
      el.dataset.file ||
      "";
    const hrefAbs = toAbs(hrefAttr);
    const onclick = el.getAttribute("onclick") || "";
    const isButton =
      el.tagName === "BUTTON" || el.getAttribute("role") === "button";
    const iconOnlyButton = isButton && !text;
    const iconDownload = hasDownloadIcon(el);
    const iconView = hasViewIcon(el);

    const uiKeywords =
      /fechar|aplicar|cancelar|limpar|remover|ir para|visualizar|adicionar|campo|p[aá]gina|pagina[cç][aã]o|exportar|export|filtro|pesquisar|buscar/i;
    if (uiKeywords.test(text)) return false;

    if (iconView && !iconDownload) return false;

    if (iconOnlyButton) {
      return iconDownload;
    }

    return (
      iconDownload ||
      el.hasAttribute("download") ||
      /download|baixar|baixe|arquivo|anexo|\.pdf/i.test(text) ||
      /scgridfieldoddlink|scgridfieldevenlink|css_arquivo_documento|download|arquivo|anexo/i.test(
        cls,
      ) ||
      exts.test(hrefAttr) ||
      exts.test(hrefAbs) ||
      /nm_mostra_doc|arquivo|anexo|download/i.test(hrefAttr) ||
      /wpdm-download|download-file/i.test(hrefAttr) ||
      /wpdm-download-button/i.test(cls) ||
      /download|baixar|nm_mostra_doc/i.test(onclick)
    );
  };

  const getContainer = (el) =>
    el.closest(
      "article, li, .elementor-post, .elementor-widget, .wpdm-link-template, .card, .list-group-item, .entry, .item, .row, tr, [id]",
    ) ||
    el.parentElement ||
    el;

  const getRecordTitle = (el) => {
    const titleNode = el
      .closest(
        ".w3eden, .card, .wpdm-download-link, .wpdm-link-template, .media-body",
      )
      ?.querySelector(
        ".ptitle, .package-title, .title, h1, h2, h3, h4, strong",
      );
    if (titleNode) {
      const titleText = cleanRecordLabel(titleNode.textContent || "");
      if (titleText && !/^(download|baixar|baixe)$/i.test(normLoose(titleText)))
        return titleText;
    }

    // Caso tabela desktop: pega titulo da primeira coluna da linha.
    const row = el.closest("tr");
    if (row) {
      const firstCell = row.querySelector("td[title], th[title], td, th");
      if (firstCell) {
        const fromTitle = (firstCell.getAttribute("title") || "").trim();
        if (fromTitle) return fromTitle;
        const fromText = (firstCell.textContent || "").trim();
        if (fromText) return fromText;
      }
    }

    // Caso card mobile: tenta localizar campo "Titulo:".
    const card = el.closest("div");
    if (card) {
      const spans = Array.from(card.querySelectorAll("span"));
      const titleLabel = spans.find((s) =>
        /t[ií]tulo\s*:/i.test((s.textContent || "").trim()),
      );
      if (titleLabel && titleLabel.nextElementSibling) {
        const titleValue = (
          titleLabel.nextElementSibling.textContent || ""
        ).trim();
        if (titleValue) return titleValue;
      }
    }

    // Estrutura em arvore (ano/mes) com bloco .isFileLink.
    const fileLinkBlock = el.closest(".isFileLink");
    if (fileLinkBlock) {
      const blockText = cleanRecordLabel(fileLinkBlock.textContent || "");
      if (blockText) return blockText;
    }

    return "";
  };

  const getFolderHierarchyFromElement = (el) => {
    if (!el || !el.closest) return [];

    const folders = [];
    let node = el.closest("li");

    while (node) {
      if (node.classList && node.classList.contains("has-children")) {
        let label = null;
        try {
          label = node.querySelector(":scope > label");
        } catch {
          label = node.querySelector("label");
        }

        const labelText = normalizeFileSegment(label?.textContent || "", true);
        if (labelText) folders.push(labelText);
      }

      const parentUl = node.parentElement;
      node = parentUl && parentUl.closest ? parentUl.closest("li") : null;
    }

    return folders.reverse();
  };

  const getContextFileTitleFromElement = (el) => {
    if (!el || !el.closest) return "";

    const fileLinkBlock = el.closest(".isFileLink");
    if (fileLinkBlock) {
      const blockText = cleanRecordLabel(fileLinkBlock.textContent || "");
      if (blockText) return blockText;
    }

    const liText = cleanRecordLabel(el.closest("li")?.textContent || "");
    if (liText) return liText;

    return "";
  };

  const extractDownloadUrl = (el) => {
    if (!el) return "";

    const direct = [
      el.dataset?.downloadurl,
      el.getAttribute("data-downloadurl"),
      el.dataset?.href,
      el.getAttribute("data-href"),
      el.dataset?.url,
      el.getAttribute("data-url"),
      el.dataset?.file,
      el.getAttribute("data-file"),
      el.getAttribute("href"),
    ];

    for (const raw of direct) {
      if (!raw) continue;
      const rawText = String(raw).trim();
      if (!rawText || rawText === "#" || /^javascript:/i.test(rawText))
        continue;
      const abs = toAbs(raw || "");
      if (!abs || abs === document.baseURI || abs === window.location.href)
        continue;
      if (abs) return abs;
    }

    const cont = getContainer(el);
    if (!cont || !cont.querySelectorAll) return "";

    const nearby = Array.from(
      cont.querySelectorAll("a[href], [data-href], [data-url], [data-file]"),
    );
    for (const node of nearby) {
      const raw =
        node.getAttribute("href") ||
        node.dataset?.downloadurl ||
        node.dataset?.href ||
        node.dataset?.url ||
        node.dataset?.file ||
        node.getAttribute("data-downloadurl") ||
        node.getAttribute("data-href") ||
        node.getAttribute("data-url") ||
        node.getAttribute("data-file") ||
        "";

      const abs = toAbs(raw);
      if (!abs || abs === document.baseURI || abs === window.location.href)
        continue;

      const hint = norm(
        [
          raw,
          node.className,
          node.getAttribute("onclick"),
          node.getAttribute("title"),
          node.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" "),
      );

      if (
        exts.test(raw) ||
        exts.test(abs) ||
        /download|baixar|nm_mostra_doc|arquivo|anexo|wpdm-download/i.test(hint)
      ) {
        return abs;
      }
    }

    return "";
  };

  const inferFileTypeFromUrl = (url) => {
    if (!url) return "";

    try {
      const parsed = new URL(url, document.baseURI);
      const pathname = (parsed.pathname || "").toLowerCase();

      const downloadPath = pathname.match(/\/download\/([a-z0-9]+)\//i);
      if (downloadPath && downloadPath[1]) {
        const pathType = normalizeFileTypeToken(downloadPath[1]);
        if (pathType) return pathType;
      }

      const extMatch = pathname.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
      if (extMatch && extMatch[1]) {
        const extType = normalizeFileTypeToken(extMatch[1]);
        if (extType) return extType;
      }

      const paramCandidates = [
        parsed.searchParams.get("type"),
        parsed.searchParams.get("format"),
        parsed.searchParams.get("ext"),
        parsed.searchParams.get("filetype"),
      ];

      for (const raw of paramCandidates) {
        const token = normalizeFileTypeToken(raw || "");
        if (token) return token;
      }
    } catch {
      const fallbackExt = String(url)
        .toLowerCase()
        .match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
      if (fallbackExt && fallbackExt[1]) {
        const extType = normalizeFileTypeToken(fallbackExt[1]);
        if (extType) return extType;
      }
    }

    return "";
  };

  const inferFileTypeFromElement = (el, resolvedUrl = "") => {
    const byUrl = inferFileTypeFromUrl(resolvedUrl || extractDownloadUrl(el));
    if (byUrl) return byUrl;

    const imgSrc = el?.querySelector?.("img")?.getAttribute?.("src") || "";
    const iconClass =
      el?.querySelector?.("i,svg")?.getAttribute?.("class") || "";

    const hint = normLoose(
      [
        el?.innerText,
        el?.textContent,
        el?.getAttribute?.("aria-label"),
        el?.getAttribute?.("title"),
        el?.getAttribute?.("class"),
        el?.getAttribute?.("onclick"),
        imgSrc,
        iconClass,
      ]
        .filter(Boolean)
        .join(" "),
    );

    const rules = [
      ["pdf", /\bpdf\b|pdf-icon/],
      ["csv", /\bcsv\b/],
      ["doc", /\bdoc\b|\bword\b|doc-icon/],
      ["docx", /\bdocx\b/],
      ["xls", /\bxls\b|\bexcel\b|excel-icon/],
      ["xlsx", /\bxlsx\b/],
      ["xml", /\bxml\b|xml-icon/],
      ["txt", /\btxt\b|\btext\b|txt-icon/],
      ["rtf", /\brtf\b/],
      ["zip", /\bzip\b/],
      ["rar", /\brar\b/],
      ["7z", /\b7z\b/],
      ["odt", /\bodt\b/],
      ["ods", /\bods\b/],
      ["ppt", /\bppt\b/],
      ["pptx", /\bpptx\b/],
    ];

    for (const [type, rx] of rules) {
      if (rx.test(hint)) return type;
    }

    return "";
  };

  const resolveDownloadFileName = (
    it,
    suggestedName,
    titleFallback,
    liveEl,
  ) => {
    const el = liveEl || it?.el;
    const folders = getFolderHierarchyFromElement(el);

    const candidate = String(suggestedName || "").trim();
    const candidateParts = splitFileNameExt(candidate);
    const fallbackParts = splitFileNameExt(titleFallback || "");

    const hasFolderContext = folders.length >= 2;
    const shouldUseHierarchy =
      hasFolderContext && isLikelyRandomBaseName(candidateParts.base || "");

    let preferredTitle = cleanRecordLabel(it?.titleName || "");
    if (!preferredTitle)
      preferredTitle = cleanRecordLabel(getContextFileTitleFromElement(el));
    if (!preferredTitle) preferredTitle = cleanRecordLabel(titleFallback || "");

    if (shouldUseHierarchy && !isGenericDownloadTitle(preferredTitle)) {
      const preferredParts = splitFileNameExt(preferredTitle);
      const titleBase = normalizeFileSegment(
        preferredParts.base || preferredTitle,
        false,
      );
      const folderBase = folders
        .map((segment) => normalizeFileSegment(segment, true))
        .filter(Boolean)
        .join("_");

      if (folderBase && titleBase) {
        const ext =
          preferredParts.ext ||
          candidateParts.ext ||
          inferFileTypeFromUrl(it?.url) ||
          normalizeFileTypeToken(it?.fileType) ||
          "pdf";

        return sanitizeFileName(`${folderBase}_${titleBase}`, ext);
      }
    }

    let fallbackName = candidate;
    if (!fallbackName || fallbackName.length < 3) {
      fallbackName = preferredTitle || titleFallback || "download";
    }

    const extHint =
      splitFileNameExt(fallbackName).ext ||
      fallbackParts.ext ||
      candidateParts.ext ||
      inferFileTypeFromUrl(it?.url) ||
      normalizeFileTypeToken(it?.fileType) ||
      "pdf";

    return sanitizeFileName(fallbackName, extHint);
  };

  const keyOf = (el, idx, fallbackText = "", resolvedUrl = "") => {
    const href = resolvedUrl || extractDownloadUrl(el);

    if (el.dataset && el.dataset.package) return `pkg:${el.dataset.package}`;
    if (el.dataset && el.dataset.id) return `id:${el.dataset.id}`;
    if (el.getAttribute("data-id")) return `did:${el.getAttribute("data-id")}`;

    const onclick = (el.getAttribute("onclick") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      onclick &&
      /download|baixar|nm_mostra_doc|arquivo|anexo/i.test(onclick)
    ) {
      return "oc:" + hash(onclick.slice(0, 300));
    }

    // Se tem URL válida e única, usar ela como chave principal
    if (href && href !== document.baseURI && href.length > 10) {
      return "url:" + href;
    }

    const cont = getContainer(el);
    const contId =
      cont.getAttribute("id") ||
      cont.getAttribute("data-id") ||
      cont.getAttribute("data-package-id");
    if (contId) return "cont:" + contId;

    const btnText = norm(
      el.innerText || el.textContent || fallbackText || "",
    ).slice(0, 100);
    const contText = norm(cont.innerText || "").slice(0, 200);
    const combined = btnText + "|" + contText;

    return "txt:" + hash(combined);
  };

  // ============================================
  // SELETORES
  // ============================================
  const selectors = [
    "a[download]",
    'a[href*="/download"]',
    'a[href*="nm_mostra_doc"]',
    "a.scGridFieldOddLink, a.scGridFieldEvenLink",
    "a.css_arquivo_documento_grid_line",
    'a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xls"], a[href$=".xlsx"], ' +
      'a[href$=".ppt"], a[href$=".pptx"], a[href$=".zip"], a[href$=".rar"], a[href$=".7z"], ' +
      'a[href$=".odt"], a[href$=".ods"], a[href$=".txt"], a[href$=".csv"], a[href$=".rtf"]',
    "a.wpdm-download-button, a.wpdm-download-link",
    "a.elementor-button, a.elementor-button-link",
    "a.nt_btn",
    "[data-download], [data-file]",
    "button",
    '[role="button"]',
  ].join(",");

  // ============================================
  // ESTADO GLOBAL
  // ============================================
  const state = {
    queue: [],
    processed: [],
    running: false,
    expandingTable: false,
    blockedFrames: [],
    timer: null,
    startedAt: null,
    errors: [],
    doneKeys: new Set(),
    queuedKeys: new Set(),
    selectedKeys: new Set(),
    itemIdByKey: new Map(),
    nextItemId: 1,
    pageType: null,
  };

  const runningSet = new Set();

  const detectPageType = () => {
    const url = window.location.href.toLowerCase();
    const html = document.documentElement.outerHTML.toLowerCase();

    if (
      html.includes("nmsc_iframe") ||
      html.includes("scriptcase") ||
      html.includes("pesq_publicacoes_grid")
    ) {
      return "iframe-grid";
    }

    if (
      html.includes("wpdm") ||
      html.includes("download-monitor") ||
      html.includes("elementor")
    ) {
      return "direct-links";
    }

    return "generic";
  };

  state.pageType = detectPageType();

  // ============================================
  // COLETA DE LINKS
  // ============================================
  const collectFromRoot = (root) => {
    if (!root || !root.querySelectorAll) return [];

    const pageHint = getCurrentPageNumber();
    const tabHint = getCurrentTabMarker();

    return Array.from(root.querySelectorAll(selectors))
      .filter((el) => {
        const tag = el.tagName;
        const isBtn =
          tag === "A" ||
          tag === "BUTTON" ||
          el.getAttribute("role") === "button";
        const visible = isVisible(el);
        const download = looksLikeDownload(el);
        return isBtn && visible && download;
      })
      .map((el, idx) => {
        const url = extractDownloadUrl(el);
        const titleName = getRecordTitle(el);
        const displayText =
          titleName ||
          cleanRecordLabel(fileNameFromUrl(url) || "") ||
          cleanRecordLabel(
            el.getAttribute("aria-label") || el.getAttribute("title") || "",
          ) ||
          (el.innerText || el.textContent || "").trim().slice(0, 120);
        const text = (
          el.innerText ||
          el.textContent ||
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          titleName ||
          ""
        )
          .trim()
          .slice(0, 120);
        const fileType = inferFileTypeFromElement(el, url);
        const key = keyOf(el, idx, titleName, url);
        return {
          el,
          url,
          text,
          displayText,
          titleName,
          fileType,
          key,
          idx,
          sourcePage: pageHint,
          sourceTabMarker: tabHint,
        };
      });
  };

  const collect = (logEnabled = true) => {
    let roots = [];
    const blockedFrames = [];

    if (opts.rootSelector) {
      const root = document.querySelector(opts.rootSelector);
      if (root) roots.push(root);
    } else {
      roots.push(document);

      if (opts.autoDetectIframe) {
        const frames = Array.from(document.querySelectorAll("iframe"));
        for (const frame of frames) {
          try {
            const frameDoc =
              frame.contentDocument || frame.contentWindow?.document;
            if (frameDoc) roots.push(frameDoc);
          } catch {
            const rawSrc = frame.getAttribute("src") || frame.src || "";
            const normalized = toAbs(rawSrc) || rawSrc || "(iframe sem src)";
            blockedFrames.push(normalized);
          }
        }
      }
    }

    state.blockedFrames = Array.from(new Set(blockedFrames)).filter(Boolean);

    if (!roots.length) return [];

    const all = roots.flatMap((root) => collectFromRoot(root));

    const map = new Map();
    for (const it of all) if (!map.has(it.key)) map.set(it.key, it);

    if (opts.verbose && blockedFrames.length && logEnabled) {
      console.warn(
        "[BAIXATRON] ⚠️ Iframes com acesso bloqueado (cross-origin):",
        blockedFrames.length,
      );
      if (map.size === 0) {
        console.warn(
          "[BAIXATRON] 💡 Dica: abra o iframe em nova aba (domínio do conteúdo) para escanear os botões de download.",
        );
        console.warn(
          "[BAIXATRON] 💡 Atalho: use __dl.openBlockedFrames() ou botão [↗] Abrir Iframe(s).",
        );
      }
    }

    if (logEnabled) {
      console.log(
        "[BAIXATRON] 🔍 Collect: elementos brutos:",
        all.length,
        "| únicos após dedupe:",
        map.size,
      );
    }
    return Array.from(map.values());
  };

  const isControlDisabled = (el) => {
    if (!el) return true;
    if (el.disabled) return true;
    const ariaDisabled = (el.getAttribute("aria-disabled") || "").toLowerCase();
    if (ariaDisabled === "true") return true;
    const clsTokens = String(el.className || "")
      .split(/\s+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

    // Em Tailwind, classes como "disabled:opacity-50" nao significam estado desabilitado atual.
    return (
      clsTokens.includes("disabled") ||
      clsTokens.includes("is-disabled") ||
      clsTokens.includes("btn-disabled")
    );
  };

  const dispatchFormEvents = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const parseNumberish = (value) => {
    const raw = String(value || "").replace(/\./g, "");
    const match = raw.match(/-?\d+/);
    if (!match) return NaN;
    return parseInt(match[0], 10);
  };

  const getControlContextText = (el) => {
    const text = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.id,
      el.name,
      el.className,
      el.closest("label")?.textContent,
      el.parentElement?.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    return norm(text);
  };

  const getCleanOptionNumber = (opt) => {
    if (!opt) return NaN;

    const valueText = String(opt.value || "").trim();
    const labelText = String(opt.textContent || "").trim();

    if (/^\d{1,4}$/.test(valueText)) return parseInt(valueText, 10);
    if (/^\d{1,4}$/.test(labelText)) return parseInt(labelText, 10);

    return NaN;
  };

  const looksLikeRowsPerPageSelect = (select) => {
    const options = Array.from(select.options || []);
    if (options.length < 2) return false;

    const contextText = getControlContextText(select);
    const hasRowsContext =
      /por p[aá]gina|itens por|registros por|linhas por|results per page|rows per page|page size|per page|page length|tamanho da p[aá]gina/i.test(
        contextText,
      );
    if (hasRowsContext) {
      return true;
    }

    const hasUuidLikeValue = options.some((opt) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-/i.test(String(opt.value || "").trim()),
    );
    if (hasUuidLikeValue) return false;

    const numericOptions = options
      .map(getCleanOptionNumber)
      .filter((n) => Number.isFinite(n) && n > 0);

    if (numericOptions.length < 2) return false;

    const min = Math.min(...numericOptions);
    const max = Math.max(...numericOptions);
    const hasLikelyPageSize = numericOptions.some((n) =>
      [10, 20, 25, 50, 100].includes(n),
    );

    // Evita confundir com seletor de página (1,2,3...) ou filtros diversos.
    return (
      min >= 5 &&
      max <= 500 &&
      (hasLikelyPageSize || (max >= 20 && max / min >= 2))
    );
  };

  const pickBestRowsPerPageOption = (select) => {
    const options = Array.from(select.options || []);
    if (options.length === 0) return null;

    const allOption = options.find((opt) => {
      const valueText = (opt.value || "").trim();
      const labelText = opt.textContent || "";
      return (
        valueText === "-1" || /\b(all|todos?|todas?|tudo)\b/i.test(labelText)
      );
    });
    if (allOption) return allOption;

    let best = null;
    let bestNumber = -Infinity;

    for (const opt of options) {
      const numberValue = getCleanOptionNumber(opt);
      if (!Number.isFinite(numberValue)) continue;
      if (numberValue > bestNumber) {
        bestNumber = numberValue;
        best = opt;
      }
    }

    return best;
  };

  const expandRowsPerPage = async () => {
    let changed = 0;

    const selects = Array.from(document.querySelectorAll("select"))
      .filter((select) => !select.closest("#__dl-panel"))
      .filter((select) => isVisible(select) && !isControlDisabled(select))
      .filter((select) => looksLikeRowsPerPageSelect(select));

    for (const select of selects) {
      const targetOption = pickBestRowsPerPageOption(select);
      if (!targetOption) continue;

      const nextValue = targetOption.value;
      const currentValue = select.value;
      if (nextValue === currentValue && targetOption.selected) continue;

      select.value = nextValue;
      targetOption.selected = true;
      dispatchFormEvents(select);
      changed++;
    }

    if (changed > 0) {
      await wait(Math.max(250, opts.tableExpandWaitMs));
    }

    return changed;
  };

  const getCollectSignature = () =>
    collect(false)
      .map((it) => it.key)
      .join("|");

  const getPaginationContainers = () => {
    const containerSelectors = [
      "nav",
      "ul",
      "ol",
      '[class*="pagination" i]',
      '[class*="pagin" i]',
      '[class*="pager" i]',
      '[aria-label*="pagin" i]',
      '[aria-label*="page" i]',
    ].join(",");

    const directContainers = Array.from(
      document.querySelectorAll(containerSelectors),
    );
    const pageActionControls = Array.from(
      document.querySelectorAll(
        'button[title], a[title], [role="button"][title], button[aria-label], a[aria-label], [role="button"][aria-label]',
      ),
    )
      .filter((el) => {
        const label = norm(
          [el.getAttribute("title"), el.getAttribute("aria-label")]
            .filter(Boolean)
            .join(" "),
        );
        return /(p[aá]gina anterior|p[aá]gina pr[oó]xima|anterior|pr[oó]xim[ao]?|next|prev(?:ious)?)/i.test(
          label,
        );
      })
      .filter((el) => !el.closest("#__dl-panel"));

    const nearControlContainers = pageActionControls
      .map(
        (el) =>
          el.closest("nav, section, article, div, ul, ol") || el.parentElement,
      )
      .filter(Boolean);

    const unique = [];
    const seen = new Set();
    for (const el of [...directContainers, ...nearControlContainers]) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      unique.push(el);
    }

    return unique
      .filter((el) => !el.closest("#__dl-panel"))
      .filter((el) => isVisible(el));
  };

  const isLikelyPaginationControl = (el) => {
    if (!el) return false;
    if (!isVisible(el) || isControlDisabled(el)) return false;
    if (looksLikeDownload(el)) return false;

    const rawText = (el.innerText || el.textContent || "").trim();
    const controlText = norm(
      [
        rawText,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("rel"),
      ]
        .filter(Boolean)
        .join(" "),
    );
    const cls = getClassText(el);
    const idName = norm(
      [el.id, el.getAttribute("name")].filter(Boolean).join(" "),
    );

    const isNumeric = /^\d{1,4}$/.test(rawText);
    const isDirectional =
      /(pr[oó]xim[ao]?|next|seguinte|anterior|prev(?:ious)?|voltar|p[aá]gina anterior|p[aá]gina pr[oó]xima|[«‹←»›→])/i.test(
        controlText,
      );
    const hasHint =
      /\b(pagin|page|pager|pagina|p[aá]gina)\b/i.test(controlText) ||
      /\b(pagin|page|pager|pagina|p[aá]gina)\b/i.test(cls) ||
      /\b(pagin|page|pager|pagina|p[aá]gina)\b/i.test(idName);

    return isNumeric || isDirectional || hasHint;
  };

  const getPaginationControls = (container) => {
    if (!container || !container.querySelectorAll) return [];

    return Array.from(container.querySelectorAll('button, a, [role="button"]'))
      .filter((el) => isVisible(el) && !isControlDisabled(el))
      .filter((el) => !looksLikeDownload(el))
      .filter(isLikelyPaginationControl);
  };

  const getControlText = (el) =>
    norm(
      [
        el.innerText,
        el.textContent,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("rel"),
      ]
        .filter(Boolean)
        .join(" "),
    );

  const getClassText = (el) => {
    if (!el) return "";
    if (typeof el.className === "string") return norm(el.className);
    return norm(el.getAttribute("class") || "");
  };

  const getTabContainers = () => {
    const selectors = [
      '[role="tablist"]',
      ".nav-tabs",
      ".nav-pills",
      '[class*="tablist" i]',
      '[class*="tabs-nav" i]',
      '[class*="tab-list" i]',
    ].join(",");

    return Array.from(document.querySelectorAll(selectors))
      .filter((el) => !el.closest("#__dl-panel"))
      .filter((el) => isVisible(el));
  };

  const isLikelyTabControl = (el) => {
    if (!el) return false;
    if (!isVisible(el) || isControlDisabled(el)) return false;
    if (el.closest("#__dl-panel")) return false;
    if (looksLikeDownload(el)) return false;

    const role = (el.getAttribute("role") || "").toLowerCase();
    const dataToggle = norm(
      [el.getAttribute("data-bs-toggle"), el.getAttribute("data-toggle")]
        .filter(Boolean)
        .join(" "),
    );
    const ariaControls = (el.getAttribute("aria-controls") || "").trim();
    const href = (el.getAttribute("href") || "").trim();
    const classText = getClassText(el);
    const parent = el.parentElement;
    const parentClassText = getClassText(parent);

    const hasTabRole = role === "tab";
    const hasTabToggle = /\b(tab|pill)\b/i.test(dataToggle);
    const hasAriaControls =
      Boolean(ariaControls) && Boolean(document.getElementById(ariaControls));
    const hashTarget =
      href.startsWith("#") && href.length > 1
        ? document.querySelector(href)
        : null;
    const classHint =
      /\b(tab|tabs|tab-link|tab-btn|nav-link|pill|pills)\b/.test(classText);
    const parentHint = /\b(tab|tabs|tablist|nav-tabs|nav-pills|pill)\b/.test(
      parentClassText,
    );

    return (
      hasTabRole ||
      hasTabToggle ||
      hasAriaControls ||
      Boolean(hashTarget) ||
      (classHint && parentHint)
    );
  };

  const getTabControls = (container) => {
    if (!container || !container.querySelectorAll) return [];

    return Array.from(
      container.querySelectorAll('[role="tab"], button, a, [role="button"]'),
    ).filter(isLikelyTabControl);
  };

  const isCurrentTabControl = (el) => {
    if (!el) return false;

    const ariaSelected = (el.getAttribute("aria-selected") || "").toLowerCase();
    if (ariaSelected === "true") return true;
    if (ariaSelected === "false") return false;

    const classText = getClassText(el);
    if (
      /\b(active|current|selected|is-active|tab-active|show)\b/.test(classText)
    )
      return true;

    const ariaControls = (el.getAttribute("aria-controls") || "").trim();
    if (ariaControls) {
      const panel = document.getElementById(ariaControls);
      if (panel && isVisible(panel)) return true;
    }

    const dataTarget = (
      el.getAttribute("data-bs-target") ||
      el.getAttribute("data-target") ||
      ""
    ).trim();
    if (dataTarget && dataTarget.startsWith("#")) {
      const panel = document.querySelector(dataTarget);
      if (panel && isVisible(panel)) return true;
    }

    const href = (el.getAttribute("href") || "").trim();
    if (href.startsWith("#") && href.length > 1) {
      const panel = document.querySelector(href);
      if (panel && isVisible(panel)) return true;
    }

    return false;
  };

  const getTabControlMarker = (el) => {
    if (!el) return "";

    const parent = el.closest(
      '[role="tablist"], .nav-tabs, .nav-pills, [class*="tablist" i], [class*="tabs-nav" i], [class*="tab-list" i]',
    );
    const parentId = parent?.id || parent?.getAttribute("data-id") || "";
    const ariaControls = (el.getAttribute("aria-controls") || "").trim();
    const dataTarget = (
      el.getAttribute("data-bs-target") ||
      el.getAttribute("data-target") ||
      ""
    ).trim();
    const href = (el.getAttribute("href") || "").trim();
    const ownId = (el.id || el.getAttribute("data-id") || "").trim();
    const text = getControlText(el) || getClassText(el) || "tab-control";
    const pos = parent ? Array.from(parent.children).indexOf(el) : -1;

    return [
      "tab",
      parentId.slice(0, 40),
      ownId.slice(0, 40),
      ariaControls.slice(0, 40),
      dataTarget.slice(0, 40),
      href.slice(0, 60),
      text.slice(0, 80),
      String(pos),
    ].join(":");
  };

  const getTabStateMarker = () => {
    const markers = [];
    const containers = getTabContainers();

    for (const container of containers) {
      const controls = getTabControls(container);
      if (controls.length < 2) continue;

      const active = controls.find(isCurrentTabControl);
      if (active) {
        markers.push(getTabControlMarker(active));
      }
    }

    return markers.join("|");
  };

  const getCurrentTabMarker = () => {
    const containers = getTabContainers();
    for (const container of containers) {
      const controls = getTabControls(container);
      if (controls.length < 2) continue;

      const active = controls.find(isCurrentTabControl);
      if (active) return getTabControlMarker(active);
    }

    return "";
  };

  const getAllTabControls = () => {
    const dedupe = new Map();

    const containers = getTabContainers();
    for (const container of containers) {
      const controls = getTabControls(container);
      for (const control of controls) {
        const marker = getTabControlMarker(control);
        if (!marker || dedupe.has(marker)) continue;
        dedupe.set(marker, control);
      }
    }

    return Array.from(dedupe.values());
  };

  const findTabControlByMarker = (marker) => {
    if (!marker) return null;
    return (
      getAllTabControls().find(
        (control) => getTabControlMarker(control) === marker,
      ) || null
    );
  };

  const goToTabMarker = async (marker) => {
    if (!marker) return false;

    const currentMarker = getCurrentTabMarker();
    if (currentMarker && currentMarker === marker) return true;

    const control = findTabControlByMarker(marker);
    if (!control) return false;

    const beforeSig = getCollectSignature();
    const beforeStateMarker = getViewStateMarker();

    if (typeof control.click === "function") {
      control.click();
    } else {
      control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }

    const changed = await waitForCollectChange(
      beforeSig,
      opts.tableExpandWaitMs * 6,
      beforeStateMarker,
    );
    if (changed) {
      await waitForCollectSettled(opts.tableExpandWaitMs * 6);
    }

    const afterMarker = getCurrentTabMarker();
    return changed || (afterMarker && afterMarker === marker);
  };

  const getControlPageNumber = (el) => {
    const directText = (el.innerText || el.textContent || "").trim();
    if (/^\d{1,4}$/.test(directText)) {
      return parseInt(directText, 10);
    }

    const attrText = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-page"),
      el.getAttribute("data-pagenumber"),
    ]
      .filter(Boolean)
      .join(" ");

    const match = attrText.match(/\b(\d{1,4})\b/);
    return match ? parseInt(match[1], 10) : NaN;
  };

  const isCurrentPageControl = (el) => {
    const ariaCurrent = (el.getAttribute("aria-current") || "").toLowerCase();
    if (ariaCurrent === "page" || ariaCurrent === "true") return true;

    const ownClass = getClassText(el);
    if (/\b(active|current|selected|is-active|page-active)\b/.test(ownClass))
      return true;

    const ownPage = getControlPageNumber(el);
    if (Number.isFinite(ownPage)) {
      const highlighted =
        /\b(bg-gradient-to-r|text-white|scale-105)\b/.test(ownClass) &&
        !/\bbg-white\b/.test(ownClass);
      if (highlighted) return true;
    }

    const parent = el.parentElement;
    if (!parent) return false;

    const parentAriaCurrent = (
      parent.getAttribute("aria-current") || ""
    ).toLowerCase();
    if (parentAriaCurrent === "page" || parentAriaCurrent === "true")
      return true;

    const parentClass = getClassText(parent);
    if (/\b(active|current|selected|is-active|page-active)\b/.test(parentClass))
      return true;

    if (Number.isFinite(ownPage)) {
      const parentHighlighted =
        /\b(bg-gradient-to-r|text-white|scale-105)\b/.test(parentClass) &&
        !/\bbg-white\b/.test(parentClass);
      if (parentHighlighted) return true;
    }

    return false;
  };

  const getControlMarker = (el) => {
    const page = getControlPageNumber(el);
    if (Number.isFinite(page)) return `page:${page}`;

    const parent = el.parentElement;
    const pos = parent ? Array.from(parent.children).indexOf(el) : -1;
    const text = getControlText(el) || getClassText(el) || "icon-control";
    return `ctrl:${text.slice(0, 80)}:${pos}`;
  };

  const getPaginationStateMarker = () => {
    const containers = getPaginationContainers();
    const markers = [];

    for (const container of containers) {
      const controls = getPaginationControls(container);
      if (controls.length < 2) continue;

      const active = controls.find(isCurrentPageControl);
      if (active) {
        markers.push(getControlMarker(active));
      }
    }

    return markers.join("|");
  };

  const getViewStateMarker = () =>
    [getPaginationStateMarker(), getTabStateMarker()].filter(Boolean).join("|");

  const getCurrentPageNumber = () => {
    const containers = getPaginationContainers();
    for (const container of containers) {
      const controls = getPaginationControls(container);
      if (controls.length < 2) continue;

      const active = controls.find(isCurrentPageControl);
      if (!active) continue;

      const page = getControlPageNumber(active);
      if (Number.isFinite(page)) return page;
    }

    return NaN;
  };

  const findPaginationControlByPage = (pageNumber) => {
    if (!Number.isFinite(pageNumber)) return null;

    const containers = getPaginationContainers();
    for (const container of containers) {
      const controls = getPaginationControls(container);
      const match = controls.find(
        (control) => getControlPageNumber(control) === pageNumber,
      );
      if (match) return match;
    }

    return null;
  };

  const goToPageNumber = async (pageNumber) => {
    if (!Number.isFinite(pageNumber)) return false;

    const currentPage = getCurrentPageNumber();
    if (Number.isFinite(currentPage) && currentPage === pageNumber) return true;

    const control = findPaginationControlByPage(pageNumber);
    if (!control) return false;

    const beforeSig = getCollectSignature();
    const beforeStateMarker = getViewStateMarker();

    if (typeof control.click === "function") {
      control.click();
    } else {
      control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }

    const changed = await waitForCollectChange(
      beforeSig,
      opts.tableExpandWaitMs * 6,
      beforeStateMarker,
    );
    if (changed) {
      await waitForCollectSettled(opts.tableExpandWaitMs * 6);
    }

    const afterPage = getCurrentPageNumber();
    return Number.isFinite(afterPage) && afterPage === pageNumber;
  };

  const waitForCollectChange = async (
    previousSignature,
    timeoutMs,
    previousStateMarker = "",
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await wait(250);
      const nextSignature = getCollectSignature();
      if (nextSignature !== previousSignature) return true;

      if (previousStateMarker) {
        const nextStateMarker = getViewStateMarker();
        if (nextStateMarker !== previousStateMarker) return true;
      }
    }
    return false;
  };

  const waitForCollectSettled = async (timeoutMs) => {
    const startedAt = Date.now();
    let lastSignature = "";
    let stableHits = 0;
    let lastItems = [];

    while (Date.now() - startedAt < timeoutMs) {
      await wait(250);
      const items = collect(false);
      const signature = items.map((it) => it.key).join("|");

      if (signature === lastSignature) {
        stableHits++;
      } else {
        stableHits = 0;
        lastSignature = signature;
      }

      lastItems = items;

      // Considera assentado quando houver itens e duas leituras seguidas iguais.
      if (items.length > 0 && stableHits >= 1) {
        return items;
      }
    }

    return lastItems;
  };

  const clickLoadMoreControls = async () => {
    const loadMoreRegex =
      /mostrar mais|carregar mais|ver mais|mais resultados|mais itens|exibir mais|load more|show more|see more/i;
    let clicks = 0;

    while (clicks < opts.tableExpandMaxClicks) {
      const candidates = Array.from(
        document.querySelectorAll('button, a, [role="button"]'),
      )
        .filter((el) => !el.closest("#__dl-panel"))
        .filter((el) => isVisible(el) && !isControlDisabled(el))
        .filter((el) => !looksLikeDownload(el))
        .filter((el) => {
          const text = norm(
            [
              el.innerText,
              el.textContent,
              el.getAttribute("aria-label"),
              el.getAttribute("title"),
            ]
              .filter(Boolean)
              .join(" "),
          );
          return loadMoreRegex.test(text);
        });

      if (candidates.length === 0) break;

      const target = candidates[0];
      const beforeSig = getCollectSignature();

      if (typeof target.click === "function") {
        target.click();
      } else {
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }

      clicks++;
      const changed = await waitForCollectChange(
        beforeSig,
        opts.tableExpandWaitMs * 4,
      );
      if (!changed) break;
    }

    return clicks;
  };

  const folderDownloadSelector = [
    ".isFileLink",
    "a[download]",
    'a[href*="/download/"]',
    'a[href$=".pdf" i]',
    'a[href$=".csv" i]',
    'a[href$=".doc" i]',
    'a[href$=".docx" i]',
    'a[href$=".xml" i]',
    'a[href$=".txt" i]',
  ].join(",");

  const isFolderContainerLoaded = (container) => {
    if (!container || !container.querySelector) return false;
    return Boolean(container.querySelector(folderDownloadSelector));
  };

  const getFolderContainerSignature = (container) => {
    if (!container || !container.querySelectorAll) return "";

    const totalItems = container.querySelectorAll("li").length;
    const totalFiles = container.querySelectorAll(
      folderDownloadSelector,
    ).length;
    const textSize = (container.textContent || "").trim().length;
    return `${totalItems}|${totalFiles}|${textSize}`;
  };

  const waitForFolderContainerChange = async (
    container,
    previousSignature,
    timeoutMs,
  ) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await wait(220);
      const nextSignature = getFolderContainerSignature(container);
      if (nextSignature !== previousSignature) return true;
    }

    return false;
  };

  const getFolderToggleCheckbox = (toggle) => {
    if (!toggle || !toggle.getAttribute) return null;

    const forId = (toggle.getAttribute("for") || "").trim();
    if (forId) {
      const linked = document.getElementById(forId);
      if (
        linked &&
        linked.tagName === "INPUT" &&
        (linked.type || "").toLowerCase() === "checkbox"
      ) {
        return linked;
      }
    }

    const prev = toggle.previousElementSibling;
    if (
      prev &&
      prev.tagName === "INPUT" &&
      (prev.type || "").toLowerCase() === "checkbox"
    ) {
      return prev;
    }

    return null;
  };

  const getFolderExpandCandidates = (attemptedMarkers) => {
    const containers = Array.from(
      document.querySelectorAll(".has-file-on-it"),
    ).filter((container) => !container.closest("#__dl-panel"));

    const candidates = [];

    for (const container of containers) {
      const toggle = container.previousElementSibling;
      if (!toggle || !toggle.getAttribute) continue;
      if (toggle.closest && toggle.closest("#__dl-panel")) continue;

      const tag = (toggle.tagName || "").toUpperCase();
      const role = (toggle.getAttribute("role") || "").toLowerCase();
      const isToggleLike =
        tag === "LABEL" || tag === "A" || tag === "BUTTON" || role === "button";
      if (!isToggleLike) continue;

      const marker =
        toggle.getAttribute("data-path") ||
        toggle.getAttribute("for") ||
        `${norm(toggle.textContent || "").slice(0, 120)}|${container.childElementCount}`;

      if (!marker || attemptedMarkers.has(marker)) continue;

      const checkbox = getFolderToggleCheckbox(toggle);
      const loaded = isFolderContainerLoaded(container);

      // Se ja esta aberto, nao clicar para evitar colapsar novamente.
      if (checkbox && checkbox.checked) continue;

      // Sem checkbox e sem arquivos novos para carregar: ignora.
      if (!checkbox && loaded) continue;

      candidates.push({ marker, toggle, checkbox, container, loaded });
    }

    return candidates;
  };

  const expandFolderTrees = async () => {
    let openedFolders = 0;
    let ajaxClicks = 0;
    let loadedFolders = 0;
    const attemptedMarkers = new Set();

    while (attemptedMarkers.size < opts.folderExpandMaxClicks) {
      const candidates = getFolderExpandCandidates(attemptedMarkers);
      if (candidates.length === 0) break;

      const target = candidates[0];
      attemptedMarkers.add(target.marker);

      // Caso ja tenha arquivos carregados, apenas expande visualmente sem novo request.
      if (target.checkbox && target.loaded) {
        target.checkbox.checked = true;
        dispatchFormEvents(target.checkbox);
        openedFolders++;
        await wait(Math.max(100, Math.floor(opts.folderExpandWaitMs / 2)));
        continue;
      }

      const beforeSignature = getFolderContainerSignature(target.container);

      if (typeof target.toggle.click === "function") {
        target.toggle.click();
      } else {
        target.toggle.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }

      ajaxClicks++;

      const changed = await waitForFolderContainerChange(
        target.container,
        beforeSignature,
        opts.folderExpandWaitMs * 8,
      );
      if (changed) loadedFolders++;

      await wait(Math.max(120, opts.folderExpandWaitMs));
    }

    return {
      attempted: attemptedMarkers.size,
      openedFolders,
      ajaxClicks,
      loadedFolders,
    };
  };

  const findNextPaginationControl = (clickedMarkers = new Set()) => {
    const nextRegex =
      /(pr[oó]xim[ao]?|next|seguinte|avan[cç]ar|pr[oó]x\b|[»›→])/i;
    const prevRegex = /(anterior|prev(?:ious)?|voltar|[«‹←])/i;
    const nextClassRegex =
      /(next|chevron-right|angle-right|arrow-right|caret-right|icon-right|ri-arrow-right|fa-angle-right|fa-chevron-right|bi-chevron-right|pagination-next)/i;
    const prevClassRegex =
      /(prev|previous|chevron-left|angle-left|arrow-left|caret-left|icon-left|ri-arrow-left|fa-angle-left|fa-chevron-left|bi-chevron-left|pagination-prev)/i;

    const pickFromControls = (controls) => {
      if (!controls || controls.length === 0) return null;

      const activeIndex = controls.findIndex(isCurrentPageControl);
      const currentPage =
        activeIndex >= 0 ? getControlPageNumber(controls[activeIndex]) : NaN;

      const numericControls = controls
        .map((el) => ({ el, page: getControlPageNumber(el) }))
        .filter((entry) => Number.isFinite(entry.page));

      const sortedNumeric = numericControls
        .slice()
        .sort((a, b) => a.page - b.page);

      if (Number.isFinite(currentPage)) {
        const nextNumeric = sortedNumeric
          .filter((entry) => entry.page > currentPage)
          .map((entry) => entry.el)
          .find((el) => !clickedMarkers.has(getControlMarker(el)));

        if (nextNumeric) return nextNumeric;
      } else if (sortedNumeric.length > 0) {
        // Se não identificou página ativa, evita clicar na menor (geralmente página 1).
        const guessNext = sortedNumeric
          .filter((entry) => entry.page > 1)
          .map((entry) => entry.el)
          .find((el) => !clickedMarkers.has(getControlMarker(el)));

        if (guessNext) return guessNext;

        if (sortedNumeric.length > 1) {
          const second = sortedNumeric[1].el;
          if (!clickedMarkers.has(getControlMarker(second))) return second;
        }
      }

      if (activeIndex >= 0) {
        for (let i = activeIndex + 1; i < controls.length; i++) {
          const candidate = controls[i];
          if (isCurrentPageControl(candidate)) continue;

          const text = getControlText(candidate);
          const classText = getClassText(candidate);
          if (prevRegex.test(text) || prevClassRegex.test(classText)) continue;
          if (clickedMarkers.has(getControlMarker(candidate))) continue;

          return candidate;
        }
      }

      const nextByLabel = controls.find((candidate) => {
        const text = getControlText(candidate);
        const classText = getClassText(candidate);
        const rel = (candidate.getAttribute("rel") || "").toLowerCase();

        if (prevRegex.test(text) || prevClassRegex.test(classText))
          return false;

        const looksLikeNext =
          nextRegex.test(text) ||
          nextClassRegex.test(classText) ||
          rel === "next";
        if (!looksLikeNext) return false;

        return !clickedMarkers.has(getControlMarker(candidate));
      });

      if (nextByLabel) return nextByLabel;

      const anyNumeric = numericControls
        .map((entry) => entry.el)
        .find(
          (el) =>
            !isCurrentPageControl(el) &&
            !clickedMarkers.has(getControlMarker(el)),
        );

      return anyNumeric || null;
    };

    const containers = getPaginationContainers();
    for (const container of containers) {
      const controls = getPaginationControls(container);
      if (controls.length < 2) continue;

      const picked = pickFromControls(controls);
      if (picked) return picked;
    }

    const controls = Array.from(
      document.querySelectorAll('button, a, [role="button"]'),
    )
      .filter((el) => !el.closest("#__dl-panel"))
      .filter((el) => isVisible(el) && !isControlDisabled(el))
      .filter((el) => !looksLikeDownload(el))
      .filter(isLikelyPaginationControl);
    return pickFromControls(controls);
  };

  const collectThroughPagination = async () => {
    const allItems = new Map();
    const clickedMarkers = new Set();

    const addCurrentPageItems = (items = null) => {
      const currentPage = getCurrentPageNumber();
      const currentTabMarker = getCurrentTabMarker();
      const source = items || collect(false);
      let addedCount = 0;
      for (const item of source) {
        const enriched = {
          ...item,
          sourcePage: Number.isFinite(item.sourcePage)
            ? item.sourcePage
            : Number.isFinite(currentPage)
              ? currentPage
              : NaN,
          sourceTabMarker: item.sourceTabMarker || currentTabMarker || "",
        };

        if (!allItems.has(item.key)) {
          allItems.set(item.key, enriched);
          addedCount++;
        }
      }

      return {
        pageNumber: Number.isFinite(currentPage) ? currentPage : null,
        foundOnPage: source.length,
        addedCount,
        totalAccumulated: allItems.size,
      };
    };

    const initialStats = addCurrentPageItems();
    if (opts.verbose) {
      console.log(
        `[BAIXATRON] 📄 Página ${initialStats.pageNumber || 1}: ${initialStats.foundOnPage} encontrado(s) | total acumulado: ${initialStats.totalAccumulated}`,
      );
    }

    let movedPages = 0;
    for (let i = 0; i < opts.tableSweepMaxPages; i++) {
      let pageAdvanced = false;

      // Tenta candidatos alternativos de paginação caso o primeiro não mude a lista.
      for (let attempt = 0; attempt < 5; attempt++) {
        const nextControl = findNextPaginationControl(clickedMarkers);
        if (!nextControl) break;

        const beforeSig = getCollectSignature();
        const beforeStateMarker = getViewStateMarker();
        const marker = getControlMarker(nextControl);
        const controlLabel = (
          nextControl.innerText ||
          nextControl.textContent ||
          nextControl.getAttribute("aria-label") ||
          nextControl.getAttribute("title") ||
          ""
        ).trim();

        if (opts.verbose) {
          console.log(
            "[BAIXATRON] 🔄 Tentando paginacao:",
            controlLabel || "(sem texto)",
            "| marker:",
            marker,
          );
        }

        if (typeof nextControl.click === "function") {
          nextControl.click();
        } else {
          nextControl.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        }
        clickedMarkers.add(marker);

        const changed = await waitForCollectChange(
          beforeSig,
          opts.tableExpandWaitMs * 6,
          beforeStateMarker,
        );
        if (!changed) {
          if (opts.verbose) {
            console.warn(
              "[BAIXATRON] ⚠️ Clique de paginacao sem mudanca detectada:",
              controlLabel || "(sem texto)",
              "| marker:",
              marker,
            );
          }
          continue;
        }

        movedPages++;
        const settledItems = await waitForCollectSettled(
          opts.tableExpandWaitMs * 6,
        );
        const pageStats = addCurrentPageItems(settledItems);
        if (opts.verbose) {
          console.log(
            `[BAIXATRON] 📄 Página ${pageStats.pageNumber || "?"}: ${pageStats.foundOnPage} encontrado(s) | total acumulado: ${pageStats.totalAccumulated}`,
          );
        }
        pageAdvanced = true;
        break;
      }

      if (!pageAdvanced) break;
    }

    return {
      items: Array.from(allItems.values()),
      movedPages,
    };
  };

  const findNextTabControl = (clickedMarkers = new Set()) => {
    const pickFromControls = (controls) => {
      if (!controls || controls.length < 2) return null;

      const activeIndex = controls.findIndex(isCurrentTabControl);
      if (activeIndex >= 0) {
        for (let i = activeIndex + 1; i < controls.length; i++) {
          const candidate = controls[i];
          const marker = getTabControlMarker(candidate);
          if (!marker || clickedMarkers.has(marker)) continue;
          if (isCurrentTabControl(candidate)) continue;
          return candidate;
        }
      }

      const anyInactive = controls.find((candidate) => {
        const marker = getTabControlMarker(candidate);
        if (!marker || clickedMarkers.has(marker)) return false;
        return !isCurrentTabControl(candidate);
      });

      return anyInactive || null;
    };

    const containers = getTabContainers();
    for (const container of containers) {
      const controls = getTabControls(container);
      const picked = pickFromControls(controls);
      if (picked) return picked;
    }

    return pickFromControls(getAllTabControls());
  };

  const collectCurrentViewDeep = async () => {
    const loadMoreClicks = await clickLoadMoreControls();
    const pagedResult = await collectThroughPagination();
    const items = pagedResult.items.length ? pagedResult.items : collect(false);

    return {
      items,
      loadMoreClicks,
      movedPages: pagedResult.movedPages,
    };
  };

  const collectThroughTabsAndPagination = async () => {
    const allItems = new Map();
    const clickedTabMarkers = new Set();

    let switchedTabs = 0;
    let loadMoreClicks = 0;
    let movedPages = 0;

    const addItems = (items) => {
      for (const item of items || []) {
        if (!allItems.has(item.key)) {
          allItems.set(item.key, item);
        }
      }
    };

    const collectCurrentTabView = async () => {
      const deep = await collectCurrentViewDeep();
      addItems(deep.items);
      loadMoreClicks += deep.loadMoreClicks;
      movedPages += deep.movedPages;
    };

    await collectCurrentTabView();

    if (!opts.tableSweepTabs) {
      return {
        items: Array.from(allItems.values()),
        switchedTabs,
        loadMoreClicks,
        movedPages,
      };
    }

    for (let i = 0; i < opts.tableSweepMaxTabs; i++) {
      const nextTab = findNextTabControl(clickedTabMarkers);
      if (!nextTab) break;

      const marker = getTabControlMarker(nextTab);
      if (!marker) break;
      clickedTabMarkers.add(marker);

      if (isCurrentTabControl(nextTab)) continue;

      const beforeSig = getCollectSignature();
      const beforeStateMarker = getViewStateMarker();

      if (typeof nextTab.click === "function") {
        nextTab.click();
      } else {
        nextTab.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }

      const changed = await waitForCollectChange(
        beforeSig,
        opts.tableExpandWaitMs * 6,
        beforeStateMarker,
      );
      if (!changed) continue;

      switchedTabs++;
      await waitForCollectSettled(opts.tableExpandWaitMs * 6);
      await collectCurrentTabView();
    }

    return {
      items: Array.from(allItems.values()),
      switchedTabs,
      loadMoreClicks,
      movedPages,
    };
  };

  const fillQueueFromItems = (items) => {
    state.queue = [];
    state.queuedKeys.clear();
    state.selectedKeys.clear();

    let added = 0;
    let skipped = 0;

    for (const it of items) {
      if (opts.dedupe && state.doneKeys.has(it.key)) {
        skipped++;
        continue;
      }

      if (!state.itemIdByKey.has(it.key)) {
        state.itemIdByKey.set(it.key, state.nextItemId++);
      }
      it.itemId = state.itemIdByKey.get(it.key);

      state.queue.push(it);
      state.queuedKeys.add(it.key);
      state.selectedKeys.add(it.key);
      added++;
    }

    updateUI();
    return { added, skipped };
  };

  const applyQueueNameFilter = (mode, rawInput = null) => {
    if (mode !== "keep" && mode !== "remove") {
      alert("[BAIXATRON] Modo de filtro invalido. Use keep ou remove.");
      return null;
    }

    if (state.running) {
      alert(
        "[BAIXATRON] Pause os downloads antes de aplicar filtros por nome.",
      );
      return null;
    }

    if (state.queue.length === 0) {
      alert("[BAIXATRON] A fila esta vazia. Use [⊙] Escanear primeiro.");
      return null;
    }

    const actionLabel = mode === "keep" ? "manter" : "remover";
    const raw =
      typeof rawInput === "string"
        ? rawInput
        : prompt(
            `[BAIXATRON] Digite os nomes/trechos para ${actionLabel} da checklist.\n` +
              "Separe por quebra de linha, virgula, ponto e virgula ou barra vertical.",
          );

    if (raw === null) return null;

    const criteria = parseFilterCriteria(raw);
    const terms = criteria.terms;
    if (!terms.length) {
      alert("[BAIXATRON] Nenhum nome informado.");
      return null;
    }

    const totalBefore = state.queue.length;
    const nextQueue = [];
    let matched = 0;

    for (const it of state.queue) {
      const haystack = normLoose(
        [it.titleName, it.text].filter(Boolean).join(" "),
      );
      const itemId = Number(it.itemId);
      const idMatch = Number.isFinite(itemId) && criteria.ids.has(itemId);
      const idRangeMatch =
        Number.isFinite(itemId) &&
        criteria.idRanges.some(
          ([start, end]) => itemId >= start && itemId <= end,
        );
      const textMatch = criteria.textTokens.some((token) =>
        haystack.includes(token),
      );
      const isMatch = idMatch || idRangeMatch || textMatch;
      if (isMatch) matched++;

      const shouldKeep = mode === "keep" ? isMatch : !isMatch;
      if (shouldKeep) {
        nextQueue.push(it);
      } else {
        state.selectedKeys.delete(it.key);
      }
    }

    state.queue = nextQueue;
    state.queuedKeys.clear();
    for (const it of state.queue) {
      state.queuedKeys.add(it.key);
    }

    const queueKeys = new Set(state.queue.map((it) => it.key));
    state.selectedKeys.forEach((key) => {
      if (!queueKeys.has(key)) state.selectedKeys.delete(key);
    });

    const totalAfter = nextQueue.length;
    const removedCount = Math.max(0, totalBefore - totalAfter);

    updateUI();

    console.log(
      "[BAIXATRON] 🧪 Filtro por nome aplicado | modo:",
      mode,
      "| termos:",
      terms.length,
      "| correspondencias:",
      matched,
      "| removidos da fila:",
      removedCount,
      "| restantes:",
      totalAfter,
    );

    alert(
      `[BAIXATRON] Filtro aplicado (${mode === "keep" ? "manter" : "remover"}).\n` +
        `Termos: ${terms.length}\n` +
        `IDs no filtro: ${criteria.ids.size}\n` +
        `Faixas de ID: ${criteria.idRanges.length}\n` +
        `Correspondencias: ${matched}\n` +
        `Removidos da checklist: ${removedCount}\n` +
        `Restantes: ${totalAfter}`,
    );

    return {
      mode,
      termsCount: terms.length,
      matched,
      removedCount,
      remaining: totalAfter,
    };
  };

  const applyQueueTypeFilter = (mode, rawInput = null) => {
    if (mode !== "keep" && mode !== "remove") {
      alert("[BAIXATRON] Modo de filtro de tipo invalido. Use keep ou remove.");
      return null;
    }

    if (state.running) {
      alert(
        "[BAIXATRON] Pause os downloads antes de aplicar filtros por tipo.",
      );
      return null;
    }

    if (state.queue.length === 0) {
      alert("[BAIXATRON] A fila esta vazia. Use [⊙] Escanear primeiro.");
      return null;
    }

    const actionLabel = mode === "keep" ? "manter" : "remover";
    const raw =
      typeof rawInput === "string"
        ? rawInput
        : prompt(
            `[BAIXATRON] Digite os tipos para ${actionLabel} da checklist.\n` +
              "Exemplos: pdf, csv, doc, xml, txt, xls, zip.",
          );

    if (raw === null) return null;

    const types = parseTypeFilterTerms(raw);
    if (!types.length) {
      alert(
        "[BAIXATRON] Nenhum tipo valido informado. Exemplos: pdf, csv, doc, xml, txt.",
      );
      return null;
    }

    const totalBefore = state.queue.length;
    const nextQueue = [];
    let matched = 0;

    for (const it of state.queue) {
      const itemType =
        normalizeFileTypeToken(it.fileType) ||
        inferFileTypeFromUrl(it.url) ||
        inferFileTypeFromElement(it.el, it.url);
      it.fileType = itemType;

      const isMatch = Boolean(itemType) && types.includes(itemType);
      if (isMatch) matched++;

      const shouldKeep = mode === "keep" ? isMatch : !isMatch;
      if (shouldKeep) {
        nextQueue.push(it);
      } else {
        state.selectedKeys.delete(it.key);
      }
    }

    state.queue = nextQueue;
    state.queuedKeys.clear();
    for (const it of state.queue) {
      state.queuedKeys.add(it.key);
    }

    const queueKeys = new Set(state.queue.map((it) => it.key));
    state.selectedKeys.forEach((key) => {
      if (!queueKeys.has(key)) state.selectedKeys.delete(key);
    });

    const totalAfter = nextQueue.length;
    const removedCount = Math.max(0, totalBefore - totalAfter);

    updateUI();

    console.log(
      "[BAIXATRON] 🧪 Filtro por tipo aplicado | modo:",
      mode,
      "| tipos:",
      types.join(", "),
      "| correspondencias:",
      matched,
      "| removidos da fila:",
      removedCount,
      "| restantes:",
      totalAfter,
    );

    alert(
      `[BAIXATRON] Filtro por tipo aplicado (${mode === "keep" ? "manter" : "remover"}).\n` +
        `Tipos: ${types.join(", ")}\n` +
        `Correspondencias: ${matched}\n` +
        `Removidos da checklist: ${removedCount}\n` +
        `Restantes: ${totalAfter}`,
    );

    return {
      mode,
      types,
      matched,
      removedCount,
      remaining: totalAfter,
    };
  };

  const expandTable = async () => {
    if (state.running || state.expandingTable) return [];

    state.expandingTable = true;
    updateUI();

    try {
      console.log(
        "[BAIXATRON] 🧩 Tentando expandir tabela, abas e paginação...",
      );
      const baselineItems = collect(false);

      const changedSelects = await expandRowsPerPage();
      const folderResult = opts.folderSweepEnabled
        ? await expandFolderTrees()
        : { attempted: 0, openedFolders: 0, ajaxClicks: 0, loadedFolders: 0 };
      const sweepResult = await collectThroughTabsAndPagination();

      let finalItems = sweepResult.items.length
        ? sweepResult.items
        : collect(false);
      if (finalItems.length === 0 && baselineItems.length > 0) {
        console.warn(
          "[BAIXATRON] ⚠️ Expansão zerou a coleta. Mantendo itens da coleta inicial para evitar perda de fila.",
        );
        finalItems = baselineItems;
      }
      const stats = fillQueueFromItems(finalItems);

      console.log(
        "[BAIXATRON] ✅ Expansão finalizada | itens:",
        finalItems.length,
        "| selects alterados:",
        changedSelects,
        "| pastas processadas:",
        folderResult.attempted,
        "| pastas abertas:",
        folderResult.openedFolders,
        "| cliques AJAX em pastas:",
        folderResult.ajaxClicks,
        "| pastas carregadas:",
        folderResult.loadedFolders,
        "| abas percorridas:",
        sweepResult.switchedTabs,
        '| cliques em "mais":',
        sweepResult.loadMoreClicks,
        "| páginas percorridas:",
        sweepResult.movedPages,
        "| adicionados:",
        stats.added,
        "| pulados:",
        stats.skipped,
      );

      if (finalItems.length === 0 && state.blockedFrames.length > 0) {
        console.warn(
          "[BAIXATRON] ⚠️ Nenhum item acessível nesta aba por causa de iframe cross-origin.",
        );
        console.warn(
          "[BAIXATRON] 💡 Abra o conteúdo com __dl.openBlockedFrames() para escanear no domínio correto.",
        );
      }

      return finalItems;
    } catch (err) {
      console.error("[BAIXATRON] ❌ Falha ao expandir tabela:", err);
      return [];
    } finally {
      state.expandingTable = false;
      updateUI();
    }
  };

  // ============================================
  // SCAN: Lista todos os downloads
  // ============================================
  const scan = async () => {
    let folderResult = {
      attempted: 0,
      openedFolders: 0,
      ajaxClicks: 0,
      loadedFolders: 0,
    };

    if (opts.folderSweepEnabled) {
      folderResult = await expandFolderTrees();
      if (folderResult.attempted > 0) {
        console.log(
          "[BAIXATRON] 🗂️ Pastas processadas no scan:",
          folderResult.attempted,
          "| abertas:",
          folderResult.openedFolders,
          "| cliques AJAX:",
          folderResult.ajaxClicks,
          "| carregadas:",
          folderResult.loadedFolders,
        );
      }
    }

    const items = collect();
    console.log(
      "[BAIXATRON] 📊 Coleta: encontrados",
      items.length,
      "botões únicos",
    );

    const { added, skipped } = fillQueueFromItems(items);

    console.log(
      "[BAIXATRON] ✅ Adicionados:",
      added,
      "| ⏭️ Pulados:",
      skipped,
      "| 📝 Total histórico:",
      state.doneKeys.size,
    );
    if (items.length === 0 && state.blockedFrames.length > 0) {
      console.warn(
        "[BAIXATRON] 💡 Esta página usa iframe cross-origin. Use __dl.openBlockedFrames() ou o botão [↗] Abrir Iframe(s).",
      );
    }
    return items;
  };

  // ============================================
  // CLICK & DOWNLOAD
  // ============================================
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const resolveLiveElementForItem = (it) => {
    if (it?.el?.isConnected) return it.el;

    const fresh = collect(false).find((candidate) => {
      if (candidate.key !== it.key) return false;

      const sameTitle =
        norm(candidate.titleName || candidate.text) ===
        norm(it.titleName || it.text);
      if (sameTitle) return true;

      return true;
    });
    return fresh?.el || null;
  };

  const ensureItemPageVisible = async (it) => {
    const targetTabMarker = it?.sourceTabMarker;
    if (targetTabMarker) {
      const movedTab = await goToTabMarker(targetTabMarker);
      if (!movedTab && opts.verbose) {
        console.warn(
          "[BAIXATRON] ⚠️ Não foi possível navegar para a aba do item:",
          it?.text || it?.titleName,
        );
      }
    }

    const targetPage = it?.sourcePage;
    if (!Number.isFinite(targetPage)) return;

    const currentPage = getCurrentPageNumber();
    if (Number.isFinite(currentPage) && currentPage === targetPage) return;

    const moved = await goToPageNumber(targetPage);
    if (!moved && opts.verbose) {
      console.warn(
        "[BAIXATRON] ⚠️ Não foi possível navegar para a página do item:",
        it?.text || it?.titleName,
        "| página esperada:",
        targetPage,
      );
    }
  };

  const safeClick = async (it) => {
    await ensureItemPageVisible(it);

    const el = resolveLiveElementForItem(it) || it.el;
    const url = toAbs(it.url);
    const titleFallback = (it.titleName || it.text || "download").trim();

    try {
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center" });
      }
    } catch {}

    await wait(100);

    // Em botões com handler JS (sem href), dispare o clique diretamente.
    if (!url) {
      const liveEl = resolveLiveElementForItem(it) || el;
      if (!liveEl || !liveEl.isConnected) {
        throw new Error(
          "Elemento sem URL não está no DOM atual (possível item de outra página).",
        );
      }

      if (typeof liveEl.click === "function") {
        liveEl.click();
      } else {
        liveEl.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }
      return;
    }

    // Download direto via Fetch + Blob (melhor compatibilidade, sem abrir abas)
    try {
      // Fazer fetch do arquivo
      const response = await fetch(url, {
        credentials: "include",
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = (
        response.headers.get("content-type") || ""
      ).toLowerCase();
      if (/text\/html|application\/json|text\/plain/.test(contentType)) {
        throw new Error(
          `Resposta não-binária (${contentType || "sem content-type"})`,
        );
      }

      // Receber como octet-stream para forçar download (não abrir PDF)
      const blob = await response.blob();
      if (await blobLooksLikeHtml(blob)) {
        throw new Error("Resposta HTML recebida em vez de arquivo binário");
      }

      const downloadBlob = new Blob([blob], {
        type: "application/octet-stream",
      });
      const blobUrl = URL.createObjectURL(downloadBlob);

      // Extrair nome por header/URL e, se faltar, usar titulo da linha.
      let fileName = fileNameFromContentDisposition(
        response.headers.get("content-disposition"),
      );
      if (!fileName) fileName = fileNameFromUrl(response.url || url);
      if (!fileName) fileName = fileNameFromUrl(url);

      fileName = resolveDownloadFileName(it, fileName, titleFallback, el);

      // Capture final filename to use in JSON export (prefer Content-Disposition, then response URL)
      try {
        let finalName = "";
        const cd = response.headers.get("content-disposition");
        if (cd) finalName = fileNameFromContentDisposition(cd) || "";
        if (!finalName) {
          try {
            const respUrl = response.url || url;
            finalName =
              new URL(respUrl, document.baseURI).pathname.split("/").pop() ||
              "";
          } catch {
            finalName = "";
          }
        }
        if (!finalName && fileName) finalName = fileName;
        if (finalName) {
          // store raw final filename (without forced leading slash)
          it.finalFileName = finalName;
        }
      } catch (e) {
        // ignore
      }

      // Criar elemento <a> com blob URL
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      a.style.display = "none"; // Garantir que não seja visível

      // Adicionar ao DOM e clicar
      document.body.appendChild(a);
      a.click();

      // Limpar
      await wait(100);
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.warn(
        "[BAIXATRON] ⚠️ Erro no Fetch, tentando fallback:",
        e.message,
      );

      // Fallback 1: prioriza clique no elemento original para fluxos JS (ex.: wpdm-download)
      try {
        const liveEl = resolveLiveElementForItem(it) || el;
        if (!liveEl || !liveEl.isConnected) throw e;

        if (typeof liveEl.click === "function") {
          liveEl.click();
        } else {
          liveEl.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        }
        return;
      } catch (e1) {
        // segue para fallback por URL
      }

      // Fallback 2: tentar com URL direto (se mesmo domínio)
      try {
        const a = document.createElement("a");
        a.href = url;

        let fileName = fileNameFromUrl(url);

        fileName = resolveDownloadFileName(it, fileName, titleFallback, el);

        a.download = fileName;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();

        await wait(100);
        document.body.removeChild(a);
      } catch (e2) {
        // Fallback 3: abrir URL (último recurso)
        if (url) {
          try {
            window.open(url, "_blank");
          } catch (e3) {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }
  };

  const processLoop = async () => {
    if (!state.running) return;

    while (runningSet.size < opts.concurrency && state.queue.length > 0) {
      const next = pullNext();
      if (!next) break;
      runItem(next);
    }

    if (!state.running) return;

    if (state.queue.length === 0 && runningSet.size === 0) {
      state.running = false;
      updateUI();
      return;
    }

    clearTimeout(state.timer);
    state.timer = setTimeout(processLoop, opts.delayMs);
  };

  const pullNext = () => {
    const originalLength = state.queue.length;
    const skipped = [];

    for (
      let i = 0;
      i < originalLength && state.processed.length < opts.maxClicks;
      i++
    ) {
      const candidate = state.queue.shift();
      if (!candidate) break;

      if (state.selectedKeys.has(candidate.key)) {
        // Recoloca items pulados na fila
        state.queue.unshift(...skipped);
        return candidate;
      }
      skipped.push(candidate);
    }

    // Recoloca todos os items pulados
    state.queue.unshift(...skipped);
    return null;
  };

  const waitForCompletion = async () => {
    if (!opts.waitForDownload) return;
    console.log("[BAIXATRON] ⏳ Aguardando download completar...");
    await wait(opts.waitForDownloadTimeout);
    console.log("[BAIXATRON] ⏱️ Timeout atingido, prosseguindo...");
  };

  const runItem = async (it) => {
    runningSet.add(it.key);
    const itemStartTime = Date.now();
    updateUI();
    console.log("[BAIXATRON] 🎯 Iniciando:", it.text?.slice(0, 60));
    try {
      await safeClick(it);
      console.log("[BAIXATRON] 🖱️ Click executado, aguardando...");
      await waitForCompletion();
      const itemDuration = Date.now() - itemStartTime;
      it.duration = itemDuration;
      state.doneKeys.add(it.key);
      state.processed.push(it);
      console.log("[BAIXATRON] ✅ Download concluído:", it.text?.slice(0, 50));
    } catch (err) {
      it.retries = (it.retries || 0) + 1;
      console.warn(
        `[BAIXATRON] ⚠️ Erro (tentativa ${it.retries}/${opts.maxRetries}):`,
        it.text?.slice(0, 50),
        "-",
        err.message,
      );
      if (it.retries <= opts.maxRetries) {
        console.log("[BAIXATRON] 🔄 Recolocando na fila para retry...");
        state.queue.push(it);
      } else {
        console.error(
          "[BAIXATRON] ❌ Item descartado após max retries:",
          it.text?.slice(0, 50),
        );
        state.errors.push({ key: it.key, text: it.text, err: String(err) });
      }
    } finally {
      runningSet.delete(it.key);
      console.log("[BAIXATRON] ⏱️ Aguardando", opts.delayMs + "ms...");
      await wait(opts.delayMs);
      updateUI();
    }
  };

  // Try to resolve the final filename for an item by requesting headers (Content-Disposition)
  const prefetchFinalFilename = async (it) => {
    if (!it) return null;
    const raw = it?.url || (it?.el && extractDownloadUrl(it.el));
    const url = toAbs(raw);
    if (!url) return null;

    try {
      // Prefer HEAD to avoid downloading body; fallback to GET if HEAD not supported.
      let resp = null;
      try {
        resp = await fetch(url, {
          method: "HEAD",
          credentials: "include",
          redirect: "follow",
        });
      } catch (e) {
        // HEAD might be blocked by CORS or server, fallback to GET
      }

      if (!resp || !resp.ok) {
        resp = await fetch(url, {
          method: "GET",
          credentials: "include",
          redirect: "follow",
        });
      }

      if (!resp) return null;

      // Try Content-Disposition
      const cd = resp.headers.get("content-disposition");
      let name = fileNameFromContentDisposition(cd) || "";
      if (!name) {
        try {
          const resolved = resp.url || url;
          name =
            new URL(resolved, document.baseURI).pathname.split("/").pop() || "";
        } catch {
          name = "";
        }
      }

      if (name) {
        it.finalFileName = name;
        return name;
      }
    } catch (e) {
      // ignore failures (CORS, network)
    }

    return null;
  };

  const prefetchFinalFilenames = async (items = null) => {
    const toPrefetch = Array.isArray(items)
      ? items
      : state.selectedKeys && state.selectedKeys.size
        ? state.queue.filter((it) => state.selectedKeys.has(it.key))
        : state.queue;

    const results = await Promise.all(
      toPrefetch.map(async (it) => {
        try {
          const name = await prefetchFinalFilename(it);
          return { key: it.key, finalFileName: name || null };
        } catch {
          return { key: it.key, finalFileName: null };
        }
      }),
    );
    return results;
  };

  // ============================================
  // API PÚBLICA
  // ============================================
  const start = async () => {
    if (state.running) return;
    if (!state.queue.length) await scan();

    if (state.queue.length === 0) {
      alert("[BAIXATRON] Nenhum arquivo na fila. Execute scan() primeiro.");
      return;
    }

    state.running = true;
    state.startedAt = new Date();
    updateUI();
    processLoop();
  };

  const stop = () => {
    state.running = false;
    clearTimeout(state.timer);
    updateUI();
  };

  const reset = () => {
    state.queue = [];
    state.processed = [];
    state.errors = [];
    state.expandingTable = false;
    state.doneKeys.clear();
    state.queuedKeys.clear();
    state.selectedKeys.clear();
    state.itemIdByKey.clear();
    state.nextItemId = 1;
    state.running = false;
    clearTimeout(state.timer);
    updateUI();
  };

  const clearHistory = () => {
    state.doneKeys.clear();
    state.processed = [];
    state.errors = [];
    console.log("[BAIXATRON] 🗑️ Histórico limpo! Escaneando novamente...");
    updateUI();
    // Escanear automaticamente após limpar histórico
    setTimeout(() => {
      scan();
    }, 100);
  };

  const setOptions = (newOpts) => {
    Object.assign(opts, newOpts || {});
  };

  const selectAll = () => {
    state.queue.forEach((it) => state.selectedKeys.add(it.key));
    updateUI();
  };

  const deselectAll = () => {
    state.selectedKeys.clear();
    updateUI();
  };

  const toggleSelect = (key) => {
    if (state.selectedKeys.has(key)) {
      state.selectedKeys.delete(key);
    } else {
      state.selectedKeys.add(key);
    }
    updateUI();
  };

  const toggleTheme = () => {
    const panel = document.getElementById("__dl-panel");
    if (!panel) return;

    const isLightMode = panel.classList.contains("light-mode");
    if (isLightMode) {
      panel.classList.remove("light-mode");
      localStorage.setItem("__dl-theme", "dark");
      document.getElementById("__dl-theme-toggle").textContent = "🌙";
    } else {
      panel.classList.add("light-mode");
      localStorage.setItem("__dl-theme", "light");
      document.getElementById("__dl-theme-toggle").textContent = "☀️";
    }

    syncItemsModalTheme();
  };

  const openBlockedFrames = () => {
    const frames = (state.blockedFrames || []).filter(
      (src) => src && src !== "(iframe sem src)",
    );
    if (!frames.length) {
      console.warn(
        "[BAIXATRON] Nenhum iframe bloqueado com URL disponível para abrir.",
      );
      return [];
    }

    const opened = [];
    for (const src of frames) {
      try {
        const abs = toAbs(src) || src;
        const win = window.open(abs, "_blank", "noopener,noreferrer");
        if (win) opened.push(abs);
      } catch (err) {
        console.warn(
          "[BAIXATRON] Falha ao abrir iframe:",
          src,
          err?.message || err,
        );
      }
    }

    if (opened.length > 0) {
      console.log("[BAIXATRON] ↗ Iframe(s) aberto(s):", opened.length);
    } else {
      console.warn(
        "[BAIXATRON] O navegador bloqueou a abertura automática. Permita pop-ups e tente novamente.",
      );
    }

    return opened;
  };

  const getEstimatedTime = () => {
    if (!state.running || state.processed.length === 0) return null;

    // Calcular tempo médio por item
    const processedWithTime = state.processed.filter((it) => it.duration);
    if (processedWithTime.length === 0) return null;

    const totalDuration = processedWithTime.reduce(
      (sum, it) => sum + it.duration,
      0,
    );
    const avgDuration = totalDuration / processedWithTime.length;

    // Itens restantes (fila + ativos)
    const remaining = state.queue.length + runningSet.size;
    const estimatedMs = remaining * avgDuration;

    return Math.ceil(estimatedMs / 1000); // retorna em segundos
  };

  const formatTime = (seconds) => {
    if (!seconds || seconds <= 0) return "--:--";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  window.__dl = {
    start,
    stop,
    reset,
    scan,
    clearHistory,
    expandTable,
    applyQueueNameFilter,
    applyQueueTypeFilter,
    openBlockedFrames,
    downloadExtractedJson,
    buildExtractedJsonPayload,
    selectAll,
    deselectAll,
    toggleSelect,
    setOptions,
    opts,
    state,
    toggleTheme,
    prefetchFinalFilename,
    prefetchFinalFilenames,
  };

  // ============================================
  // PAINEL VISUAL - HTML/CSS
  // ============================================
  const CSS = `
      * {
        box-sizing: border-box;
      }

      #__dl-panel {
        position: fixed;
        top: 10px;
        right: 10px;
        width: 450px;
        max-height: 85vh;
        background: #1a1a1a;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: slideIn 0.3s ease;
        color: #ffffff;
      }

      @keyframes slideIn {
        from { transform: translateX(500px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }

      #__dl-header {
        background: #2a2a2a;
        color: #ffffff;
        padding: 14px 16px;
        font-weight: 600;
        font-size: 13px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #333333;
        cursor: move;
        user-select: none;
      }

      #__dl-close {
        background: transparent;
        border: none;
        color: #888888;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 20px;
        transition: all 0.2s;
      }

      #__dl-close:hover {
        color: #ffffff;
        background: #333333;
      }

      #__dl-theme-toggle {
        background: transparent;
        border: none;
        color: #888888;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 16px;
        transition: all 0.2s;
        margin-right: 4px;
      }

      #__dl-theme-toggle:hover {
        color: #ffffff;
        background: #333333;
      }

      /* LIGHT MODE */
      #__dl-panel.light-mode {
        background: #f5f5f5;
        color: #1a1a1a;
      }

      #__dl-panel.light-mode #__dl-header {
        background: #ffffff;
        color: #1a1a1a;
        border-bottom-color: #ddd;
      }

      #__dl-panel.light-mode #__dl-close,
      #__dl-panel.light-mode #__dl-theme-toggle {
        color: #666666;
      }

      #__dl-panel.light-mode #__dl-close:hover,
      #__dl-panel.light-mode #__dl-theme-toggle:hover {
        color: #1a1a1a;
        background: #e8e8e8;
      }

      #__dl-panel.light-mode #__dl-stats {
        background: #ffffff;
        border-bottom-color: #ddd;
      }

      #__dl-panel.light-mode .stat-label {
        color: #666666;
      }

      #__dl-panel.light-mode .stat-value {
        color: #1a1a1a;
      }

      #__dl-panel.light-mode #__dl-progress {
        border-bottom-color: #ddd;
      }

      #__dl-panel.light-mode .progress-bar {
        background: #ddd;
      }

      #__dl-panel.light-mode .progress-fill {
        background: #1a1a1a;
      }

      #__dl-panel.light-mode #__dl-controls {
        border-bottom-color: #ddd;
      }

      #__dl-panel.light-mode .btn {
        border-color: #ddd;
        background: #ffffff;
        color: #1a1a1a;
      }

      #__dl-panel.light-mode .btn:hover:not(:disabled) {
        border-color: #999;
        background: #f0f0f0;
      }

      #__dl-panel.light-mode .btn-primary {
        background: #1a1a1a;
        color: #ffffff;
        border-color: #1a1a1a;
      }

      #__dl-panel.light-mode .btn-primary:hover:not(:disabled) {
        background: #333333;
        border-color: #333333;
      }

      #__dl-panel.light-mode #__dl-list {
        background: #f5f5f5;
      }

      #__dl-panel.light-mode .download-item {
        background: #ffffff;
        border-color: #ddd;
        color: #1a1a1a;
      }

      #__dl-panel.light-mode .download-item:hover {
        background: #f9f9f9;
        border-color: #999;
      }

      #__dl-panel.light-mode .download-item.done {
        background: #f0f8f0;
        border-color: #4CAF50;
      }

      #__dl-panel.light-mode .download-item.processing {
        background: #fff9f0;
        border-color: #ff9800;
      }

      #__dl-panel.light-mode .download-checkbox {
        accent-color: #1a1a1a;
      }

      #__dl-panel.light-mode .download-name {
        color: #333333;
      }

      #__dl-panel.light-mode .download-icon {
        color: #666666;
      }

      #__dl-panel.light-mode .download-type {
        background: #e9ecef;
        border-color: #ced4da;
        color: #495057;
      }

      #__dl-panel.light-mode .speed-control {
        border-top-color: #ddd;
      }

      #__dl-panel.light-mode .speed-label {
        color: #666666;
      }

      #__dl-panel.light-mode input[type="range"] {
        background: #ddd;
      }

      #__dl-panel.light-mode input[type="range"]::-webkit-slider-thumb {
        background: #1a1a1a;
      }

      #__dl-panel.light-mode input[type="range"]::-moz-range-thumb {
        background: #1a1a1a;
      }

      #__dl-panel.light-mode #__dl-list::-webkit-scrollbar-track {
        background: #f5f5f5;
      }

      #__dl-panel.light-mode #__dl-list::-webkit-scrollbar-thumb {
        background: #bbb;
      }

      #__dl-panel.light-mode #__dl-list::-webkit-scrollbar-thumb:hover {
        background: #999;
      }

      #__dl-panel.light-mode #__dl-warning {
        background: #fff3cd !important;
        color: #856404 !important;
        border-left-color: #ffc107 !important;
      }

      #__dl-warning {
        cursor: pointer;
        transition: all 0.3s ease;
      }

      #__dl-warning:hover {
        opacity: 0.8;
      }

      #__dl-warning.hidden {
        display: none !important;
      }

      #__dl-stats {
        background: #242424;
        padding: 12px;
        font-size: 11px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
        border-bottom: 1px solid #333333;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .stat-label {
        color: #888888;
        font-weight: 500;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .stat-value {
        color: #ffffff;
        font-weight: 700;
        font-size: 16px;
      }

      #__dl-progress {
        padding: 12px;
        border-bottom: 1px solid #333333;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background: #333333;
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: #ffffff;
        transition: width 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 4px;
      }

      #__dl-progress-text {
        font-size: 9px;
        color: #000000;
        font-weight: 600;
        display: none;
      }

      #__dl-controls {
        padding: 12px;
        display: flex;
        gap: 6px;
        border-bottom: 1px solid #333333;
        flex-wrap: wrap;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        flex: 1 1 120px;
        min-width: 120px;
        max-width: 100%;
        padding: 10px 12px;
        border: 1px solid #333333;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        background: #2a2a2a;
        color: #ffffff;
        white-space: normal;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .btn:hover:not(:disabled) {
        border-color: #555555;
        background: #333333;
      }

      .btn-primary {
        background: #ffffff;
        color: #000000;
        border-color: #ffffff;
      }

      .btn-primary:hover:not(:disabled) {
        background: #f0f0f0;
        border-color: #f0f0f0;
      }

      .btn-danger {
        background: #dc3545;
        color: #ffffff;
        border-color: #dc3545;
      }

      .btn-danger:hover:not(:disabled) {
        background: #c82333;
        border-color: #c82333;
      }

      .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      #__dl-list {
        flex: 1;
        overflow-y: auto;
        padding: 6px;
      }

      .download-item {
        display: flex;
        align-items: center;
        padding: 8px;
        border-radius: 4px;
        margin-bottom: 4px;
        background: #242424;
        border: 1px solid #333333;
        transition: all 0.2s;
        gap: 8px;
      }

      .download-item:hover {
        background: #2a2a2a;
        border-color: #444444;
      }

      .download-item.done {
        background: #1a3a1a;
        border-color: #4CAF50;
      }

      .download-item.processing {
        background: #3a2a1a;
        border-color: #ff9800;
      }

      .download-checkbox {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: #ffffff;
      }

      .download-name {
        flex: 1;
        font-size: 11px;
        color: #cccccc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .download-item.done .download-name {
        color: #4CAF50;
      }

      .download-item.processing .download-name {
        color: #ff9800;
      }

      .download-icon {
        font-size: 11px;
        color: #888888;
        min-width: 12px;
        text-align: center;
      }

      .download-type {
        min-width: 40px;
        text-align: center;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 10px;
        background: #1f2937;
        border: 1px solid #374151;
        color: #d1d5db;
      }

      .download-item.done .download-icon {
        color: #4CAF50;
      }

      .download-item.processing .download-icon {
        color: #ff9800;
      }

      .speed-control {
        padding: 12px;
        border-top: 1px solid #333333;
        font-size: 11px;
      }

      .speed-label {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        color: #888888;
        font-weight: 500;
      }

      input[type="range"] {
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: #333333;
        outline: none;
        -webkit-appearance: none;
        appearance: none;
      }

      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ffffff;
        cursor: pointer;
        transition: all 0.2s;
      }

      input[type="range"]::-webkit-slider-thumb:hover {
        width: 14px;
        height: 14px;
      }

      input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ffffff;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }

      input[type="range"]::-moz-range-thumb:hover {
        width: 14px;
        height: 14px;
      }

      #__dl-list::-webkit-scrollbar {
        width: 6px;
      }

      #__dl-list::-webkit-scrollbar-track {
        background: #1a1a1a;
      }

      #__dl-list::-webkit-scrollbar-thumb {
        background: #444444;
        border-radius: 3px;
      }

      #__dl-list::-webkit-scrollbar-thumb:hover {
        background: #555555;
      }

      #__dl-list-summary {
        padding: 10px 12px;
        border-bottom: 1px solid #333333;
        color: #aaaaaa;
        font-size: 11px;
      }

      #__dl-panel.light-mode #__dl-list-summary {
        border-bottom-color: #ddd;
        color: #666666;
        background: #fafafa;
      }

      #__dl-items-modal {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      #__dl-items-modal.hidden {
        display: none;
      }

      #__dl-items-modal .modal-card {
        width: min(920px, 100%);
        max-height: 88vh;
        background: #1a1a1a;
        color: #ffffff;
        border: 1px solid #333333;
        border-radius: 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      #__dl-items-modal .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid #333333;
        font-size: 13px;
        font-weight: 600;
      }

      #__dl-items-modal .modal-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
      }

      #__dl-filter-input {
        width: 100%;
        min-height: 70px;
        resize: vertical;
        border-radius: 6px;
        border: 1px solid #3a3a3a;
        background: #101010;
        color: #f0f0f0;
        padding: 8px;
        font-size: 12px;
      }

      #__dl-filter-help {
        color: #999999;
        font-size: 10px;
      }

      #__dl-modal-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      #__dl-modal-summary {
        font-size: 11px;
        color: #bbbbbb;
      }

      #__dl-modal-list {
        min-height: 160px;
        max-height: 46vh;
        overflow-y: auto;
        padding-right: 4px;
      }

      #__dl-modal-list .download-item {
        margin-bottom: 6px;
      }

      .download-id {
        min-width: 62px;
        font-size: 10px;
        color: #9ec5fe;
        font-weight: 600;
      }

      #__dl-items-modal.light-mode .modal-card {
        background: #ffffff;
        color: #1a1a1a;
        border-color: #dddddd;
      }

      #__dl-items-modal.light-mode .modal-header {
        border-bottom-color: #dddddd;
      }

      #__dl-items-modal.light-mode #__dl-filter-input {
        background: #ffffff;
        color: #1a1a1a;
        border-color: #cccccc;
      }

      #__dl-items-modal.light-mode #__dl-filter-help,
      #__dl-items-modal.light-mode #__dl-modal-summary {
        color: #666666;
      }

      #__dl-items-modal.light-mode .download-id {
        color: #0d6efd;
      }

      @media (max-width: 600px) {
        #__dl-panel {
          width: calc(100% - 20px);
          right: 10px;
          left: 10px;
          max-height: 80vh;
        }

        #__dl-controls {
          padding: 8px;
          gap: 4px;
        }

        .btn {
          flex: 1 1 48%;
          min-width: 0;
          padding: 8px 10px;
          font-size: 10px;
        }

        #__dl-items-modal {
          padding: 8px;
        }

        #__dl-items-modal .modal-card {
          max-height: 92vh;
        }

        #__dl-modal-list {
          max-height: 52vh;
        }
      }
    `;

  const syncItemsModalTheme = () => {
    const panel = document.getElementById("__dl-panel");
    const modal = document.getElementById("__dl-items-modal");
    if (!panel || !modal) return;
    modal.classList.toggle(
      "light-mode",
      panel.classList.contains("light-mode"),
    );
  };

  const renderItemsModalList = () => {
    const listEl = document.getElementById("__dl-modal-list");
    const summaryEl = document.getElementById("__dl-modal-summary");
    if (!listEl || !summaryEl) return;

    summaryEl.textContent = `Itens na fila: ${state.queue.length} | Selecionados: ${state.selectedKeys.size}`;
    listEl.innerHTML = "";

    if (state.queue.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "12px";
      empty.style.fontSize = "12px";
      empty.style.opacity = "0.8";
      empty.textContent =
        "Nenhum item na fila. Execute [⊙] Escanear para carregar downloads.";
      listEl.appendChild(empty);
      return;
    }

    state.queue.forEach((it, idx) => {
      const isSelected = state.selectedKeys.has(it.key);
      const isProcessing = state.running && idx === 0;
      const isDone = state.doneKeys.has(it.key);
      const displayId = String(it.itemId || idx + 1).padStart(4, "0");
      const itemType =
        normalizeFileTypeToken(it.fileType) ||
        inferFileTypeFromUrl(it.url) ||
        inferFileTypeFromElement(it.el, it.url) ||
        "n/a";
      it.fileType = itemType;

      const item = document.createElement("div");
      item.className = "download-item";
      if (isDone) item.classList.add("done");
      if (isProcessing) item.classList.add("processing");

      const itemLabel =
        it.titleName || it.displayText || it.text || "(sem nome)";

      item.innerHTML = `
          <input type="checkbox" class="download-checkbox" ${isSelected ? "checked" : ""}>
          <span class="download-id">ID ${displayId}</span>
          <span class="download-type">${itemType}</span>
          <span class="download-name" title="${it.text || ""}">${itemLabel}</span>
          <span class="download-icon">${isDone ? "[✓]" : isProcessing ? "[~]" : "[ ]"}</span>
        `;

      const checkbox = item.querySelector(".download-checkbox");
      if (checkbox) {
        checkbox.onchange = () => toggleSelect(it.key);
      }

      listEl.appendChild(item);
    });
  };

  const closeItemsModal = () => {
    const modal = document.getElementById("__dl-items-modal");
    if (!modal) return;
    modal.classList.add("hidden");
  };

  const openItemsModal = () => {
    const modal = document.getElementById("__dl-items-modal");
    if (!modal) return;
    syncItemsModalTheme();
    renderItemsModalList();
    modal.classList.remove("hidden");
  };

  const createItemsModal = () => {
    const existing = document.getElementById("__dl-items-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "__dl-items-modal";
    modal.className = "hidden";
    modal.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Itens e filtros do Baixatron">
          <div class="modal-header">
            <span>📋 Itens da Fila e Filtros</span>
            <button class="btn" id="btn-modal-close" style="flex:0 0 auto; min-width:40px; padding:6px 10px;">✕</button>
          </div>
          <div class="modal-body">
            <textarea id="__dl-filter-input" placeholder="Digite nomes, IDs, faixas de ID ou tipos (ex.: pdf, csv, xml)..."></textarea>
            <div id="__dl-filter-help">Separadores aceitos: quebra de linha, virgula, ponto e virgula e barra vertical. Para nome/ID: use [Manter/Remover Nomes]. Para tipo: use [Manter/Remover Tipos] com pdf,csv,doc,xml,txt etc.</div>
            <div id="__dl-modal-actions">
              <button class="btn btn-secondary" id="btn-modal-keep">[✓] Manter Nomes</button>
              <button class="btn btn-secondary" id="btn-modal-remove">[✂] Remover Nomes</button>
              <button class="btn btn-secondary" id="btn-modal-keep-type">[✓] Manter Tipos</button>
              <button class="btn btn-secondary" id="btn-modal-remove-type">[✂] Remover Tipos</button>
              <button class="btn btn-secondary" id="btn-modal-select-all">[+] Selecionar Todos</button>
              <button class="btn btn-secondary" id="btn-modal-deselect-all">[-] Desmarcar Todos</button>
              <button class="btn btn-secondary" id="btn-modal-clear-filter">[⌫] Limpar Campo</button>
            </div>
            <div id="__dl-modal-summary"></div>
            <div id="__dl-modal-list"></div>
          </div>
        </div>
      `;

    document.body.appendChild(modal);
    syncItemsModalTheme();

    const filterInput = modal.querySelector("#__dl-filter-input");

    modal.querySelector("#btn-modal-close").onclick = () => closeItemsModal();
    modal.querySelector("#btn-modal-clear-filter").onclick = () => {
      if (filterInput) filterInput.value = "";
    };
    modal.querySelector("#btn-modal-select-all").onclick = () => selectAll();
    modal.querySelector("#btn-modal-deselect-all").onclick = () =>
      deselectAll();
    modal.querySelector("#btn-modal-keep").onclick = () => {
      applyQueueNameFilter("keep", filterInput?.value || "");
    };
    modal.querySelector("#btn-modal-remove").onclick = () => {
      applyQueueNameFilter("remove", filterInput?.value || "");
    };
    modal.querySelector("#btn-modal-keep-type").onclick = () => {
      applyQueueTypeFilter("keep", filterInput?.value || "");
    };
    modal.querySelector("#btn-modal-remove-type").onclick = () => {
      applyQueueTypeFilter("remove", filterInput?.value || "");
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeItemsModal();
      }
    });
  };

  window.__dl.openItemsModal = openItemsModal;

  // ============================================
  // RENDERIZAR PAINEL
  // ============================================
  const createPanel = () => {
    const existing = document.getElementById("__dl-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "__dl-panel";
    panel.innerHTML = `
        <div id="__dl-header">
          <span>👾 BAIXATRON 📡</span>
          <div style="display: flex; gap: 4px;">
            <button id="__dl-theme-toggle" title="Alternar tema">🌙</button>
            <button id="__dl-close">✕</button>
          </div>
        </div>

        <div id="__dl-warning" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 0; font-size: 11px; color: #856404; display: flex; gap: 8px; align-items: flex-start;">
          <span style="font-size: 16px; flex-shrink: 0;">⚠️</span>
          <div style="flex: 1;">
            <strong>Aviso de Segurança:</strong>
            <p style="margin: 4px 0 0 0;"><strong>O navegador pode pedir confirmação para downloads.</strong> Opções:</p>
            <ul style="margin: 4px 0 0 0; padding-left: 20px;">
              <li>Se aparecer caixa: marque <strong>"Sempre fazer isso"</strong> (nem todos navegadores mostram)</li>
              <li>Senão: confirme cada download ou configure preferências do navegador</li>
              <li>Aumente o delay entre downloads se necessário</li>
            </ul>
            <p style="margin: 4px 0 0 0; font-size: 10px; opacity: 0.8;">Clique aqui para fechar este aviso.</p>
          </div>
        </div>

        <div id="__dl-stats">
          <div class="stat-item">
            <span class="stat-label">Fila</span>
            <span class="stat-value" id="stat-queue">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Ativos</span>
            <span class="stat-value" id="stat-active">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Processados</span>
            <span class="stat-value" id="stat-processed">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Selecionados</span>
            <span class="stat-value" id="stat-selected">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Erros</span>
            <span class="stat-value" id="stat-errors">0</span>
          </div>
        </div>

        <div id="__dl-progress">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 11px; font-weight: 600;" id="progress-percent">0%</span>
            <span style="font-size: 11px; color: #888;" id="progress-time">--:--</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="__dl-progress-fill" style="width: 0%">
              <span id="__dl-progress-text"></span>
            </div>
          </div>
        </div>

        <div id="__dl-controls">
          <button class="btn btn-primary" id="btn-scan">[⊙] Escanear</button>
          <button class="btn btn-secondary" id="btn-expand-table">[⇵] Tabela+Páginas</button>
          <button class="btn btn-secondary" id="btn-open-iframes">[↗] Abrir Iframe(s)</button>
          <button class="btn btn-secondary" id="btn-open-items-modal">[📋] Itens e Filtros</button>
          <button class="btn btn-secondary" id="btn-export-json">[⭳] JSON</button>
          <button class="btn btn-primary" id="btn-start">[▶] Iniciar</button>
          <button class="btn btn-secondary" id="btn-stop" disabled>[⏸] Pausar</button>
          <button class="btn btn-secondary" id="btn-select-all">[+] Todos</button>
          <button class="btn btn-secondary" id="btn-deselect-all">[-] Nenhum</button>
          <button class="btn btn-secondary" id="btn-clear-history">[🗑️] Limpar Histórico</button>
          <button class="btn btn-danger" id="btn-reset">[↻] Reset Total</button>
        </div>

        <div id="__dl-list-summary">Use [📋] Itens e Filtros para ver a lista com IDs e aplicar filtros.</div>

        <div class="speed-control">
          <div class="speed-label">
            <span>Velocidade</span>
            <span id="speed-value">800ms</span>
          </div>
          <input type="range" id="speed-slider" min="200" max="3000" step="100" value="800">
        </div>
      `;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    document.body.appendChild(panel);

    document.getElementById("__dl-close").onclick = () => {
      panel.remove();
      const modal = document.getElementById("__dl-items-modal");
      if (modal) modal.remove();
    };
    document.getElementById("__dl-theme-toggle").onclick = () => toggleTheme();
    document.getElementById("__dl-warning").onclick = () => {
      document.getElementById("__dl-warning").classList.add("hidden");
      localStorage.setItem("__dl-warning-closed", "true");
    };
    document.getElementById("btn-scan").onclick = () => {
      scan();
    };
    document.getElementById("btn-expand-table").onclick = () => {
      expandTable();
    };
    document.getElementById("btn-open-iframes").onclick = () => {
      openBlockedFrames();
    };
    document.getElementById("btn-open-items-modal").onclick = () =>
      openItemsModal();
    document.getElementById("btn-export-json").onclick = () => {
      downloadExtractedJson();
    };
    document.getElementById("btn-start").onclick = () => start();
    document.getElementById("btn-stop").onclick = () => stop();
    document.getElementById("btn-select-all").onclick = () => selectAll();
    document.getElementById("btn-deselect-all").onclick = () => deselectAll();
    document.getElementById("btn-clear-history").onclick = () => {
      if (
        confirm(
          "Limpar histórico de downloads? Isso permitirá escanear novamente todos os arquivos.",
        )
      )
        clearHistory();
    };
    document.getElementById("btn-reset").onclick = () => {
      if (confirm("Resetar TUDO (fila + histórico)?")) reset();
    };

    document.getElementById("speed-slider").onchange = (e) => {
      const value = parseInt(e.target.value);
      opts.delayMs = value;
      document.getElementById("speed-value").textContent = value + "ms";
    };

    enableDrag(panel, document.getElementById("__dl-header"));

    // Verificar se aviso foi fechado antes
    if (localStorage.getItem("__dl-warning-closed") === "true") {
      document.getElementById("__dl-warning").classList.add("hidden");
    }

    // Aplicar tema salvo
    const savedTheme = localStorage.getItem("__dl-theme") || "dark";
    if (savedTheme === "light") {
      panel.classList.add("light-mode");
      document.getElementById("__dl-theme-toggle").textContent = "☀️";
    } else {
      document.getElementById("__dl-theme-toggle").textContent = "🌙";
    }

    createItemsModal();

    updateUI();
  };

  // ============================================
  // ARRASTAR PAINEL
  // ============================================
  const enableDrag = (panel, handle) => {
    if (!panel || !handle) return;

    const dragState = { active: false, offsetX: 0, offsetY: 0 };

    const onMove = (e) => {
      if (!dragState.active) return;
      const x = e.clientX - dragState.offsetX;
      const y = e.clientY - dragState.offsetY;
      panel.style.right = "";
      panel.style.left =
        Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, x)) + "px";
      panel.style.top =
        Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y)) +
        "px";
    };

    const onUp = () => {
      dragState.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    handle.addEventListener("mousedown", (e) => {
      dragState.active = true;
      dragState.offsetX = e.clientX - panel.getBoundingClientRect().left;
      dragState.offsetY = e.clientY - panel.getBoundingClientRect().top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  };

  // ============================================
  // ATUALIZAR PAINEL
  // ============================================
  const updateUI = () => {
    const panel = document.getElementById("__dl-panel");
    if (!panel) return;

    document.getElementById("stat-queue").textContent = state.queue.length;
    document.getElementById("stat-active").textContent = runningSet.size;
    document.getElementById("stat-processed").textContent =
      state.processed.length;
    document.getElementById("stat-selected").textContent =
      state.selectedKeys.size;
    document.getElementById("stat-errors").textContent = state.errors.length;

    const total = state.processed.length + state.queue.length + runningSet.size;
    const percent =
      total > 0 ? Math.round((state.processed.length / total) * 100) : 0;
    const progressFill = document.getElementById("__dl-progress-fill");
    progressFill.style.width = percent + "%";
    document.getElementById("__dl-progress-text").textContent = percent + "%";

    // Atualizar porcentagem e tempo estimado
    const percentEl = document.getElementById("progress-percent");
    const timeEl = document.getElementById("progress-time");
    if (percentEl) percentEl.textContent = percent + "%";
    if (timeEl) {
      const estimatedSeconds = getEstimatedTime();
      if (estimatedSeconds && state.running) {
        timeEl.textContent = "⏱️ " + formatTime(estimatedSeconds);
      } else if (state.running) {
        timeEl.textContent = "⏱️ calculando...";
      } else {
        timeEl.textContent = "--:--";
      }
    }

    document.getElementById("btn-start").disabled =
      state.running || state.queue.length === 0;
    document.getElementById("btn-stop").disabled = !state.running;
    document.getElementById("btn-scan").disabled = state.running;

    const modalBtn = document.getElementById("btn-open-items-modal");
    if (modalBtn) modalBtn.disabled = false;

    const expandBtn = document.getElementById("btn-expand-table");
    if (expandBtn) {
      expandBtn.disabled = state.running || state.expandingTable;
      expandBtn.textContent = state.expandingTable
        ? "[...] Expandindo..."
        : "[⇵] Tabela+Páginas";
    }

    const openIframesBtn = document.getElementById("btn-open-iframes");
    if (openIframesBtn) {
      const totalBlocked = state.blockedFrames.filter(
        (src) => src && src !== "(iframe sem src)",
      ).length;
      openIframesBtn.disabled = totalBlocked === 0;
      openIframesBtn.textContent =
        totalBlocked > 0
          ? `[↗] Abrir Iframe(s) (${totalBlocked})`
          : "[↗] Abrir Iframe(s)";
    }

    const listSummary = document.getElementById("__dl-list-summary");
    if (listSummary) {
      listSummary.textContent = `Fila atual: ${state.queue.length} item(ns) | Selecionados: ${state.selectedKeys.size}. Abra [📋] Itens e Filtros para gerenciar.`;
    }

    renderItemsModalList();
  };

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  console.clear();
  console.log(
    "%c👾 BAIXATRON v3.1 ATIVADO 📡",
    "color: #00ff00; font-size: 14px; font-weight: bold",
  );
  console.log(
    "%cO alien invasor de downloads está pronto!",
    "color: #666; font-size: 12px",
  );
  console.log(
    "%cComandos disponíveis: __dl.scan(), __dl.expandTable(), __dl.applyQueueNameFilter(), __dl.applyQueueTypeFilter(), __dl.downloadExtractedJson(), __dl.openBlockedFrames(), __dl.start(), __dl.stop(), __dl.reset()",
    "color: #666; font-size: 11px",
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel);
  } else {
    createPanel();
  }
})();