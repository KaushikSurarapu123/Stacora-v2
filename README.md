# Stacora v2 — A little clarity

A redesigned version of your supplied Stacora app, with corrected recording times, timed symptoms, complete reports, session comparisons, local camera OCR, and the AI chart reader.

## Start here

1. Install Node.js 22 or newer if it is not already installed: https://nodejs.org/
2. Extract the entire ZIP. Keep the files together.
3. Double-click **START-STACORA.cmd** and leave its window open.
4. Open **http://127.0.0.1:3000** in your browser.
5. Choose **Explore an example** for an illustrative report, or **Start a guided test** for the real timed flow.

No packages need installing. The app needs its local server; opening index.html directly is not sufficient. To stop the server, press Ctrl+C in its window. The original supplied attachment and previous app package are preserved separately.

## What changed

- A new overview, step-by-step preparation, large timer, recording panel, report, history, and AI-reader layout.
- Responsive styles for narrow screens, light/dark appearance, keyboard focus, reduced motion, and print.
- Five full minutes of lying down are required before recording the resting baseline and starting the standing phase.
- Manual entries and live camera captures keep their actual record/capture timestamps. Processing delays do not move a live scan into a later slot.
- Scheduled readings at 1, 3, 5, and 10 minutes use a window from the target time through 45 seconds after it. This is an app recording rule, not a clinically validated protocol. Actual times are shown. Extra or missed readings do not backfill earlier slots.
- Missing readings and stopped tests are labeled clearly. No automatic POTS classification is made.
- Readings can be corrected without changing their original capture times. Corrections retain previous values in the downloaded data. Removal has an Undo option that prevents duplicate slots.
- Symptoms can be recorded during either phase, with timestamps included in the report and chart markers.
- Stopped tests keep a partial report in the current tab. Save it explicitly to retain it across browser sessions.
- Full saved reports include readings, optional BP, symptoms, context, and corrections. You can reopen, print, download, or compare two reports. Saving a report again updates it rather than creating a duplicate.
- Unsaved reports remain accessible from Overview/History and trigger an unload/replacement warning. Browser unload warnings depend on browser support; explicitly save valuable records before closing.
- Earlier summary-only records stored by the original version remain visible in History. They cannot be reconstructed into full reports because the original version did not save their raw readings.
- Nearby-care search keeps manual city/ZIP entry and optional location access. Location is sent to Google Maps when you open the search; it is not stored in session reports.

## Camera scanning: the new machine-learning feature

Choose **Try camera scan** for practice. During a test, **Scan pulse** or **Scan BP** fills the recording form after you confirm a reading.

The process is:

**Device display → camera snapshot → user-selected crop → pretrained neural OCR → editable candidates → explicit confirmation → recording form → Save reading.**

Tesseract.js 6.0.1 runs the pretrained Tesseract neural text-recognition engine in the browser. Images are not uploaded to the Stacora server or OpenAI by this scanner. The library, worker, and language model download on first use, so internet access is initially required. This is inference with an existing trained model, not a model newly trained by Stacora.

Your watch or monitor measures pulse/BP; the camera reads its display. A helper can scan while the person taking the test stays still. Glare, small text, segmented displays, and device layouts can defeat OCR. Multiple numeric candidates are not silently treated as a pulse reading. The user must select/check the correct measurement type and values. Manual entry remains available.

Live camera snapshots preserve capture time. Separately scanned BP keeps its own capture timestamp without changing the pulse timestamp. Imported photos have unknown original measurement times: they cannot provide the guided resting baseline or fill scheduled standing slots. Imported standing values are listed as extra records at import time and excluded from the timed chart. **Clear scan and enter manually** lets users return to a fresh manual measurement.

Camera access requires user permission and HTTPS or localhost. The included launcher is a local-computer demo and can use that computer’s webcam. A phone camera requires running the site on that phone from an appropriate HTTPS origin; the loopback-only server is not a public/mobile deployment. Public hosting is a separate setup step.

## Optional cloud AI chart reader

The existing chart reader extracts explicitly labeled chart measurements using the OpenAI Responses API. It requires a server API key and a vision model supporting strict structured outputs.

1. Copy **.env.example** to **.env**.
2. Put your own key in OPENAI_API_KEY and choose a supported model in OPENAI_MODEL.
3. Restart the launcher. It loads .env when that file is present.

Alternatively, in PowerShell in this folder:

```powershell
$env:OPENAI_API_KEY = 'your-key'
$env:OPENAI_MODEL = 'gpt-6-astra'
node server.mjs
```

The default model is gpt-6-astra; your account must have access, or choose another compatible model. API requests are billed to your API account. Keep the key in the server environment or .env, never in HTML/browser code, shared ZIPs, or chat.

The image and optional note are sent to OpenAI only when the user chooses **Read chart with AI**. The app requests store:false, but this is not a blanket promise about provider retention. Numbers must be checked before a summary is made. The key is never served to the browser, and uploaded chart images are not written to disk by this app. No key is required for the guided test, local reports, comparisons, or local camera OCR.

## Verification and remaining checks

Run **npm test** or **node --test** in this folder.

45 automated checks pass across the session model, controller, scanner, chart-reader UI logic, and server request handlers. They cover full/incomplete/stopped tests, missed slots, delayed confirmation, separate BP times, edits, duplicate-safe Undo, unsaved reports, saving/reopening/comparing, mandatory OCR confirmation, camera resource cleanup, stale-image rejection, corrupted storage, missing API setup, and malformed/refused AI responses.

Tests use a simulated document, simulated device/model responses, and in-process HTTP handlers. They do not establish OCR accuracy, clinical validity, or device/browser compatibility.

The browser approval check declined access to the local preview in the build environment. Therefore the final visual layout, print rendering, camera hardware, downloaded OCR engine/model, and live cloud API remain unverified. No paid model request was made. Test these on your actual browser and devices before using a demo publicly. The CSS includes desktop, mobile, dark, reduced-motion, and print layouts, but those layouts were not visually verified.

## Storage and hosting

Reports are saved only when requested, in localStorage under stacora_sessions_v2 on this browser/origin. Other browsers, ports, computers, or clearing site data will not share those reports. Export important records before moving the app. The original stacora_hist summaries are read separately for compatibility.

The server binds to 127.0.0.1, serves an explicit list of public files, and protects the optional AI endpoint with request-size, origin, concurrency, and rate limits. It is a local prototype, not an authenticated public service. Add authentication, user-level usage controls, HTTPS, and deployment/privacy configuration before exposing it publicly. It does not include full offline/PWA installation support.

## Explain the AI honestly

“Stacora uses a pretrained neural text-recognition model to read measurements from device displays. Users verify each result before saving it. An optional vision model can also transcribe labeled heart-rate charts.”

Do not claim a newly trained Stacora model, automatic diagnosis, or a measured accuracy percentage. Evaluate with known display images from different devices, with clear and blurry examples, and record exact digit matches, false readings, correction rates, and failures. The app's timers and arithmetic are ordinary software; the recognition models are the machine-learning components.

## Source documentation

- Tesseract.js: https://github.com/naptha/tesseract.js
- Tesseract neural OCR engine: https://github.com/tesseract-ocr/tesseract
- Camera requirements: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- OpenAI vision: https://developers.openai.com/api/docs/guides/images-vision
- Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
