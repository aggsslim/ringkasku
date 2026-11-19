# Ringkasku

**An offline-first Indonesian text summarizer powered by Firebase AI Logic hybrid inference.**

Paste a long Indonesian text — a news article, lecture notes, a journal abstract, field notes — and Ringkasku summarizes it. The twist is *where* the summary is computed: Ringkasku tries **Gemini Nano on the device first** (offline, private, free, via Chrome's Prompt API through Firebase AI Logic) and hands the work to a **cloud-hosted Gemini model** only when the on-device model is unavailable or the text is too long. A visible badge on every result shows which engine produced it — the hybrid behaviour is the product, not a hidden detail.

Built for the **#BuildHybridAI 2026** hackathon (Firebase AI Logic), Web/Chrome category.

**Live demo:** https://aggsslim.github.io/ringkasku/ (hosted on GitHub Pages; on-device inference needs Chrome desktop 139+ with Gemini Nano, otherwise summaries route to the cloud).

## Who it is for

Indonesian students and field researchers often work where the internet is weak or expensive — campus Wi-Fi, rural areas, buses. They still need to digest long Indonesian texts, and sending everything to the cloud costs data, money, and privacy. Ringkasku gives them a summarizer that works with no connection at all when the device supports it, and degrades gracefully to the cloud when it doesn't.

## Features

- **Three summary styles** (UI in Indonesian): *Ringkas* (2–3 sentences), *Sedang* (one paragraph), *Poin-poin* (bullet points).
- **Length-based routing**: short texts stay on-device; long texts are routed to the cloud. The character threshold comes from **Firebase Remote Config**, so the routing rule can change without a redeploy.
- **All four Firebase AI Logic inference modes exposed** in the UI: automatic routing, `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`.
- **Engine badge**: every summary is labelled "Di perangkat · Gemini Nano" or "Cloud · Gemini", taken from the SDK response's `inferenceSource`.
- **History in localStorage**, with one-click export of any summary as `.txt` or `.md`.
- **Indonesian-first UI**; no backend of our own — a fully static Vite + TypeScript app.

## How Firebase AI Logic is used

The core is `src/summarize.ts`. In short:

1. The app initializes Firebase (`src/firebase.ts`): the Firebase app, **App Check**, the **AI Logic** service (`getAI` with `GoogleAIBackend`), and **Remote Config**.
2. For each request it creates a hybrid model:

   ```ts
   const model = getGenerativeModel(ai, {
     mode: inferenceMode, // e.g. InferenceMode.PREFER_ON_DEVICE
     inCloudParams: { model: "gemini-2.5-flash-lite" },
     onDeviceParams: { createOptions: { /* Indonesian/English text I/O */ } },
   });
   await model.initializeDeviceModel(onDownloadProgress); // user-gesture gated
   const result = await model.generateContent(prompt);
   console.log(result.response.inferenceSource); // "on_device" | "in_cloud"
   ```

3. On-device inference runs through Chrome's Prompt API (Chrome desktop 139+, Gemini Nano). Cloud inference uses the Gemini Developer API through Firebase AI Logic. Text inference is used within the free usage limits — no paid service is required.

Other Firebase products used for real, not decoration:

- **App Check** — enforced for AI Logic; protects the Gemini API from abuse (see below).
- **Remote Config** — the `cloud_threshold_chars` parameter (default `1200`) drives length-based routing.

## Setup

Prerequisites: Node.js 20+, a Firebase project with AI Logic enabled (console → AI Services → AI Logic → Get started, Gemini Developer API provider), and Chrome desktop 139+ if you want the on-device path.

```bash
npm install
cp .env.example .env   # then fill in your project's VITE_FIREBASE_* values
npm run dev            # http://localhost:5173
```

The Firebase values live in `.env` (gitignored); `.env.example` documents every variable. If `.env` is missing, the app still builds and renders — it shows a "Konfigurasi Firebase belum diisi" (Firebase configuration not filled in) banner and disables summarization instead of crashing.

### App Check: safelist the debug token (local development)

AI Logic enforces Firebase App Check. For local development the app uses the documented debug-provider pattern: in dev builds, `src/firebase.ts` sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` **before** initializing App Check. To make local requests pass:

1. Run `npm run dev` and open the app in Chrome.
2. Open DevTools → Console and find the line `AppCheck debug token: "..."`. Copy the token.
3. In the Firebase console go to **Security → App Check → Apps**, open your web app's overflow menu, choose **Manage debug tokens**, and register the token.
4. Reload the app — AI Logic requests from localhost are now accepted.

For production builds, set `VITE_FIREBASE_APPCHECK_SITE_KEY` to your reCAPTCHA Enterprise site key in `.env` and App Check initializes with the real provider instead.

## Build & deploy

```bash
npm run build     # type-checks (tsc) and builds to dist/
npm run preview   # serve the production build locally
npm run deploy    # build with base /ringkasku/ and publish dist/ to GitHub Pages
```

`dist/` is a static site — host it on Firebase Hosting, GitHub Pages, or any static host.

## Project layout

```
src/
  firebase-config.ts  Env-driven Firebase config (VITE_FIREBASE_*) + "is configured" check
  firebase.ts         App init, App Check (debug provider in dev), AI Logic, Remote Config threshold
  summarize.ts        Hybrid summarization: routing, prompts, inferenceSource reporting
  main.ts             UI wiring, history (localStorage), .txt/.md export
  style.css           Vanilla CSS, no framework
index.html            Indonesian UI shell
```

## Notes & limitations

- On-device inference requires Chrome desktop 139+ with the Prompt API available; on other browsers the hybrid modes fall back to the cloud model automatically (except `ONLY_ON_DEVICE`, which surfaces an error by design).
- The first on-device request may download Gemini Nano; the UI shows download progress.
- On-device inference supports single-turn text generation only — which is exactly what summarization needs.

## License

Apache-2.0 — see [LICENSE](LICENSE).
