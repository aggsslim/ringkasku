/**
 * Firebase configuration for Ringkasku.
 *
 * Values are read from Vite environment variables (VITE_FIREBASE_*) so real
 * project values can be dropped into a local `.env` file — see `.env.example`
 * — without any code changes. No credentials are hard-coded here.
 *
 * Firebase web config values are public client identifiers: they identify the
 * project, while access is controlled by Firebase App Check and API key
 * restrictions in the Google Cloud console.
 */

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

/** Names of the env variables that must be present for Firebase to start. */
const REQUIRED_KEYS: Array<[keyof typeof firebaseConfig, string]> = [
  ["apiKey", "VITE_FIREBASE_API_KEY"],
  ["projectId", "VITE_FIREBASE_PROJECT_ID"],
  ["appId", "VITE_FIREBASE_APP_ID"],
];

export const missingFirebaseKeys: string[] = REQUIRED_KEYS.filter(
  ([field]) => !firebaseConfig[field],
).map(([, envName]) => envName);

/** True when the minimum config needed to initialize Firebase is present. */
export const isFirebaseConfigured = missingFirebaseKeys.length === 0;
