/**
 * Ringkasku UI wiring.
 *
 * One screen, one job: paste Indonesian text, pick a summary style and a
 * Firebase AI Logic inference mode, get a summary with a badge showing which
 * engine (on-device Gemini Nano or cloud Gemini) produced it. History lives
 * in localStorage; summaries export as .txt / .md.
 */

import "./style.css";
import { isFirebaseConfigured, missingFirebaseKeys } from "./firebase-config";
import {
  DEFAULT_CLOUD_THRESHOLD_CHARS,
  getFirebaseServices,
} from "./firebase";
import {
  summarizeText,
  type EngineUsed,
  type RoutingChoice,
  type SummaryMode,
} from "./summarize";

interface HistoryEntry {
  id: string;
  createdAt: string;
  mode: SummaryMode;
  engine: EngineUsed;
  sourcePreview: string;
  sourceChars: number;
  summary: string;
}

const HISTORY_KEY = "ringkasku:history";
const MAX_HISTORY = 30;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} tidak ditemukan`);
  return node as T;
}

const inputText = el<HTMLTextAreaElement>("input-text");
const charCount = el<HTMLSpanElement>("char-count");
const thresholdInfo = el<HTMLSpanElement>("threshold-info");
const routingSelect = el<HTMLSelectElement>("routing");
const summarizeBtn = el<HTMLButtonElement>("summarize-btn");
const statusLine = el<HTMLParagraphElement>("status");
const errorBox = el<HTMLDivElement>("error-box");
const configWarning = el<HTMLDivElement>("config-warning");
const resultCard = el<HTMLElement>("result-card");
const engineBadge = el<HTMLSpanElement>("engine-badge");
const resultMeta = el<HTMLParagraphElement>("result-meta");
const resultText = el<HTMLDivElement>("result-text");
const historyList = el<HTMLUListElement>("history-list");
const historyEmpty = el<HTMLParagraphElement>("history-empty");

let currentSummary = "";
let currentThreshold = DEFAULT_CLOUD_THRESHOLD_CHARS;

/* ---------------------------------- history --------------------------------- */

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // Storage full/blocked: history is a convenience, never block summarizing.
  }
}

function engineLabel(engine: EngineUsed): string {
  switch (engine) {
    case "on_device":
      return "Di perangkat · Gemini Nano";
    case "in_cloud":
      return "Cloud · Gemini";
    default:
      return "Mesin tidak dilaporkan SDK";
  }
}

function modeLabel(mode: SummaryMode): string {
  return mode === "ringkas" ? "Ringkas" : mode === "sedang" ? "Sedang" : "Poin-poin";
}

function renderHistory(): void {
  const entries = loadHistory();
  historyList.innerHTML = "";
  historyEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement("li");

    const preview = document.createElement("span");
    preview.className = "preview";
    const when = new Date(entry.createdAt).toLocaleString("id-ID");
    preview.textContent =
      `${when} · ${modeLabel(entry.mode)} · ${engineLabel(entry.engine)} — ` +
      entry.summary.slice(0, 90) +
      (entry.summary.length > 90 ? "…" : "");
    preview.title = "Klik untuk menampilkan ringkasan ini";
    preview.addEventListener("click", () => showResult(entry));

    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Hapus";
    del.addEventListener("click", () => {
      saveHistory(loadHistory().filter((e) => e.id !== entry.id));
      renderHistory();
    });

    li.append(preview, del);
    historyList.append(li);
  }
}

/* ---------------------------------- result ---------------------------------- */

function showResult(entry: {
  summary: string;
  engine: EngineUsed;
  mode: SummaryMode;
}): void {
  currentSummary = entry.summary;
  resultText.textContent = entry.summary;
  engineBadge.textContent = engineLabel(entry.engine);
  engineBadge.className =
    "badge" +
    (entry.engine === "on_device"
      ? " badge-device"
      : entry.engine === "in_cloud"
        ? " badge-cloud"
        : "");
  resultMeta.textContent = `Gaya: ${modeLabel(entry.mode)}`;
  resultCard.hidden = false;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/* --------------------------------- summarize -------------------------------- */

function selectedMode(): SummaryMode {
  const checked = document.querySelector<HTMLInputElement>(
    'input[name="mode"]:checked',
  );
  return (checked?.value as SummaryMode) ?? "ringkas";
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let hint = "Ringkasan gagal dibuat.";
  if (/app-check|appcheck|unauthorized/i.test(message)) {
    hint +=
      " Kemungkinan App Check menolak permintaan: untuk pengembangan lokal," +
      " safelist debug token App Check di Firebase console" +
      " (Security > App Check > Apps > Manage debug tokens).";
  } else if (/on-device|on_device|device model|prompt api|not available/i.test(message)) {
    hint +=
      " Model di perangkat (Gemini Nano) tampaknya belum tersedia di" +
      " peramban ini. Coba Chrome desktop versi 139+ atau pilih mode cloud.";
  } else if (/quota|resource-exhausted/i.test(message)) {
    hint += " Kuota API tercapai; coba lagi nanti.";
  }
  return `${hint}\n\nDetail teknis: ${message}`;
}

async function onSummarize(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) {
    errorBox.textContent =
      "Konfigurasi Firebase belum diisi (" +
      missingFirebaseKeys.join(", ") +
      "). Isi file .env terlebih dahulu.";
    errorBox.hidden = false;
    return;
  }

  const text = inputText.value.trim();
  if (text.length < 40) {
    errorBox.textContent =
      "Teks terlalu pendek untuk diringkas (minimal ±40 karakter).";
    errorBox.hidden = false;
    return;
  }

  errorBox.hidden = true;
  summarizeBtn.disabled = true;
  statusLine.textContent = "Menyiapkan model…";

  try {
    const threshold = await services.getCloudThresholdChars();
    currentThreshold = threshold;

    const result = await summarizeText(services.ai, {
      text,
      mode: selectedMode(),
      routing: routingSelect.value as RoutingChoice,
      cloudThresholdChars: threshold,
      onDownloadProgress: (progress) => {
        statusLine.textContent =
          `Mengunduh model Gemini Nano di perangkat… ${Math.round(progress * 100)}%`;
      },
    });

    showResult({ summary: result.summary, engine: result.engine, mode: selectedMode() });
    resultMeta.textContent =
      `Gaya: ${modeLabel(selectedMode())} · Mode inferensi: ${result.inferenceMode}` +
      (result.routedByLength
        ? ` · Teks ${text.length} karakter melebihi ambang ${threshold} (Remote Config), diarahkan ke cloud`
        : "");

    const entry: HistoryEntry = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      mode: selectedMode(),
      engine: result.engine,
      sourcePreview: text.slice(0, 120),
      sourceChars: text.length,
      summary: result.summary,
    };
    saveHistory([entry, ...loadHistory()]);
    renderHistory();
    statusLine.textContent = "Selesai.";
  } catch (error) {
    errorBox.textContent = friendlyError(error);
    errorBox.hidden = false;
    statusLine.textContent = "";
  } finally {
    summarizeBtn.disabled = false;
  }
}

/* ----------------------------------- init ----------------------------------- */

function updateCharCount(): void {
  charCount.textContent = `${inputText.value.length} karakter`;
  thresholdInfo.textContent = isFirebaseConfigured
    ? `Ambang cloud (Remote Config): >${currentThreshold} karakter`
    : "";
}

inputText.addEventListener("input", updateCharCount);
summarizeBtn.addEventListener("click", () => void onSummarize());

el<HTMLButtonElement>("copy-btn").addEventListener("click", () => {
  if (!currentSummary) return;
  void navigator.clipboard.writeText(currentSummary).then(() => {
    statusLine.textContent = "Ringkasan disalin ke papan klip.";
  });
});

el<HTMLButtonElement>("export-txt").addEventListener("click", () => {
  if (currentSummary) {
    download(`ringkasan-${stamp()}.txt`, currentSummary, "text/plain;charset=utf-8");
  }
});

el<HTMLButtonElement>("export-md").addEventListener("click", () => {
  if (currentSummary) {
    download(
      `ringkasan-${stamp()}.md`,
      `# Ringkasan Ringkasku\n\n${currentSummary}\n`,
      "text/markdown;charset=utf-8",
    );
  }
});

el<HTMLButtonElement>("clear-history").addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

if (!isFirebaseConfigured) {
  configWarning.hidden = false;
} else {
  // Warm up the Remote Config threshold so the UI can display it.
  const services = getFirebaseServices();
  if (services) {
    void services.getCloudThresholdChars().then((value) => {
      currentThreshold = value;
      updateCharCount();
    });
  }
}

updateCharCount();
renderHistory();
