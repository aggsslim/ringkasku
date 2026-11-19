/**
 * Hybrid summarization with Firebase AI Logic.
 *
 * Ringkasku's core idea: try the on-device model (Gemini Nano, via Chrome's
 * Prompt API through Firebase AI Logic) first — it is offline, private and
 * free — and let Firebase AI Logic fall back to a cloud-hosted Gemini model
 * when the device model is unavailable or the text is too long.
 *
 * Routing:
 *  - In "auto" mode the app decides by length: texts up to the Remote Config
 *    threshold use PREFER_ON_DEVICE; longer texts go ONLY_IN_CLOUD.
 *  - The user can also force any of the four Firebase AI Logic inference
 *    modes (PREFER_ON_DEVICE / ONLY_ON_DEVICE / PREFER_IN_CLOUD /
 *    ONLY_IN_CLOUD) from the UI.
 *
 * Every response reports `inferenceSource` ("on_device" | "in_cloud"), which
 * the UI turns into a visible badge — the hybrid behaviour is the product,
 * not a hidden detail.
 */

import {
  getGenerativeModel,
  InferenceMode,
  type AI,
  type InferenceSource,
} from "firebase/ai";

/** Cloud model used whenever inference runs in the cloud. */
export const CLOUD_MODEL_NAME = "gemini-3.5-flash-lite";

/** The three summary styles offered in the UI. */
export type SummaryMode = "ringkas" | "sedang" | "poin";

/** Routing choices exposed in the UI; "auto" is length-based routing. */
export type RoutingChoice =
  | "auto"
  | "prefer_on_device"
  | "only_on_device"
  | "prefer_in_cloud"
  | "only_in_cloud";

/** Which engine actually produced a summary, as reported by the SDK. */
export type EngineUsed = InferenceSource | "unknown";

export interface SummarizeOptions {
  text: string;
  mode: SummaryMode;
  routing: RoutingChoice;
  /** Character threshold from Remote Config used by "auto" routing. */
  cloudThresholdChars: number;
  /** Called with 0..1 while the on-device model downloads (first use). */
  onDownloadProgress?: (progress: number) => void;
}

export interface SummarizeResult {
  summary: string;
  /** Engine reported by the SDK response (`inferenceSource`). */
  engine: EngineUsed;
  /** The Firebase AI Logic inference mode that was requested. */
  inferenceMode: InferenceMode;
  /** True when "auto" routing sent the text to the cloud because of length. */
  routedByLength: boolean;
}

const MODE_INSTRUCTIONS: Record<SummaryMode, string> = {
  ringkas:
    "Ringkas teks berikut dalam Bahasa Indonesia menjadi 2 sampai 3 kalimat " +
    "yang padat. Pertahankan gagasan utama dan fakta terpentingnya.",
  sedang:
    "Ringkas teks berikut dalam Bahasa Indonesia menjadi satu paragraf " +
    "utuh, kira-kira sepertiga panjang teks asli. Pertahankan alur gagasan " +
    "dan fakta terpentingnya.",
  poin:
    "Ringkas teks berikut dalam Bahasa Indonesia menjadi daftar poin-poin " +
    "(3 sampai 7 poin). Tulis setiap poin pada baris baru yang diawali " +
    "dengan '- '. Pertahankan fakta terpenting dari setiap bagian teks.",
};

function buildPrompt(mode: SummaryMode, text: string): string {
  return (
    `${MODE_INSTRUCTIONS[mode]} ` +
    "Tulis hanya ringkasannya saja, tanpa kalimat pembuka seperti " +
    '"Berikut ringkasannya".\n\nTeks:\n"""\n' +
    text +
    '\n"""'
  );
}

function resolveRouting(
  routing: RoutingChoice,
  textLength: number,
  cloudThresholdChars: number,
): { inferenceMode: InferenceMode; routedByLength: boolean } {
  switch (routing) {
    case "prefer_on_device":
      return { inferenceMode: InferenceMode.PREFER_ON_DEVICE, routedByLength: false };
    case "only_on_device":
      return { inferenceMode: InferenceMode.ONLY_ON_DEVICE, routedByLength: false };
    case "prefer_in_cloud":
      return { inferenceMode: InferenceMode.PREFER_IN_CLOUD, routedByLength: false };
    case "only_in_cloud":
      return { inferenceMode: InferenceMode.ONLY_IN_CLOUD, routedByLength: false };
    case "auto":
    default:
      return textLength > cloudThresholdChars
        ? { inferenceMode: InferenceMode.ONLY_IN_CLOUD, routedByLength: true }
        : { inferenceMode: InferenceMode.PREFER_ON_DEVICE, routedByLength: false };
  }
}

/**
 * Summarizes `text` through Firebase AI Logic hybrid inference.
 *
 * Throws whatever the SDK throws (for example when ONLY_ON_DEVICE is
 * requested but Gemini Nano is unavailable, or when App Check rejects the
 * request); the UI translates errors into friendly Indonesian messages.
 */
export async function summarizeText(
  ai: AI,
  options: SummarizeOptions,
): Promise<SummarizeResult> {
  const { inferenceMode, routedByLength } = resolveRouting(
    options.routing,
    options.text.length,
    options.cloudThresholdChars,
  );

  const model = getGenerativeModel(ai, {
    mode: inferenceMode,
    inCloudParams: { model: CLOUD_MODEL_NAME },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["id", "en"] }],
        expectedOutputs: [{ type: "text", languages: ["id"] }],
      },
    },
  });

  // The on-device model must be initialized from a user interaction (our
  // caller is the summarize button's click handler) before the first prompt.
  // Skipped for cloud-only requests so we never trigger a model download
  // that would not be used.
  if (inferenceMode !== InferenceMode.ONLY_IN_CLOUD) {
    await model.initializeDeviceModel(options.onDownloadProgress);
  }

  const result = await model.generateContent(
    buildPrompt(options.mode, options.text),
  );

  const engine: EngineUsed = result.response.inferenceSource ?? "unknown";

  return {
    summary: result.response.text().trim(),
    engine,
    inferenceMode,
    routedByLength,
  };
}
