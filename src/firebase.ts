/**
 * Firebase service initialization for Ringkasku.
 *
 * Sets up, in order:
 *  1. The Firebase app (from the env-driven config in `firebase-config.ts`).
 *  2. Firebase App Check — AI Logic enforces App Check, so local development
 *     uses the debug provider pattern: in dev builds we set
 *     `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before initializing App
 *     Check. The SDK then prints a debug token in the browser console which
 *     must be safelisted once in the Firebase console
 *     (Security > App Check > Apps > Manage debug tokens). See README.
 *  3. Firebase AI Logic (`getAI` with the Gemini Developer API backend) —
 *     the hybrid inference service used by `summarize.ts`.
 *  4. Firebase Remote Config — supplies the character threshold that routes
 *     long texts to the cloud model, so the rule can change without a
 *     redeploy. Falls back to a sane local default when offline/unavailable.
 *
 * Everything degrades gracefully: when the env config is missing, callers get
 * `null` and the UI shows a "configuration not filled in yet" state instead
 * of crashing.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import {
  fetchAndActivate,
  getNumber,
  getRemoteConfig,
  type RemoteConfig,
} from "firebase/remote-config";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config";

/** Default character count above which texts are routed to the cloud model. */
export const DEFAULT_CLOUD_THRESHOLD_CHARS = 1200;

/** Remote Config key for the routing threshold. */
const THRESHOLD_KEY = "cloud_threshold_chars";

export interface FirebaseServices {
  app: FirebaseApp;
  ai: AI;
  /** Reads the routing threshold from Remote Config (cached after first fetch). */
  getCloudThresholdChars: () => Promise<number>;
}

let services: FirebaseServices | null = null;

function initAppCheck(app: FirebaseApp): void {
  try {
    if (import.meta.env.DEV) {
      // Debug provider pattern (documented by Firebase for local development
      // when App Check is enforced): setting this flag before initializing
      // App Check makes the SDK use a debug token, printed in the console,
      // which must be safelisted in the Firebase console once.
      (
        self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }
      ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as
      | string
      | undefined;

    if (siteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } else if (import.meta.env.DEV) {
      // No site key in dev: the debug token flow above is what actually
      // authenticates local requests once the token is safelisted, so a
      // placeholder provider is enough to initialize App Check.
      initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: () =>
            Promise.resolve({
              token: "ringkasku-dev-placeholder",
              expireTimeMillis: Date.now() + 60 * 60 * 1000,
            }),
        }),
        isTokenAutoRefreshEnabled: true,
      });
    } else {
      console.warn(
        "[ringkasku] VITE_FIREBASE_APPCHECK_SITE_KEY is not set; " +
          "App Check was not initialized, so AI Logic calls may be rejected.",
      );
    }
  } catch (error) {
    // App Check is best-effort at startup: AI calls surface real errors later.
    console.warn("[ringkasku] App Check initialization failed:", error);
  }
}

function createThresholdReader(app: FirebaseApp): () => Promise<number> {
  let remoteConfig: RemoteConfig | null = null;
  let cached: Promise<number> | null = null;

  return () => {
    if (!cached) {
      cached = (async () => {
        try {
          remoteConfig = getRemoteConfig(app);
          remoteConfig.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
          remoteConfig.defaultConfig = {
            [THRESHOLD_KEY]: DEFAULT_CLOUD_THRESHOLD_CHARS,
          };
          await fetchAndActivate(remoteConfig);
          const value = getNumber(remoteConfig, THRESHOLD_KEY);
          return value > 0 ? value : DEFAULT_CLOUD_THRESHOLD_CHARS;
        } catch (error) {
          console.warn(
            "[ringkasku] Remote Config unavailable, using default threshold:",
            error,
          );
          return DEFAULT_CLOUD_THRESHOLD_CHARS;
        }
      })();
    }
    return cached;
  };
}

/**
 * Returns the initialized Firebase services, or `null` when the env config
 * has not been filled in yet.
 */
export function getFirebaseServices(): FirebaseServices | null {
  if (!isFirebaseConfigured) return null;
  if (services) return services;

  const app = initializeApp(firebaseConfig);
  initAppCheck(app);
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  services = { app, ai, getCloudThresholdChars: createThresholdReader(app) };
  return services;
}
