# Cue Player

A mobile-first web app for choreographers and musicians who practice to recorded music. Import a song, mark the spots you keep returning to, and jump straight to them instead of scrubbing through a file browser.

Cue Player runs entirely in the browser. There is no server, no account, and your audio files never leave your device.

## Features

- **Named cues.** Tap *Add cue* to mark the playhead. Cue names sit above the waveform; tap one to move there, drag it to adjust the time, or hold it to rename.
- **Scrubbable waveform.** Drag anywhere on the wave to seek. Arrow keys nudge by 0.1 s, or 1 s with Shift.
- **Play through or stop at cue.** Choose whether playback continues past the next cue or pauses there. When it pauses, pressing *Play* again replays that phrase from its opening cue.
- **Loop the current phrase.** Turn on *Loop* to repeat the section between the cue behind the playhead and the next one.
- **Speed without pitch change.** A slider from 0.5× to 1.5× with 0.5×, 0.75×, 1×, 1.25×, and 1.5× quick settings. Pitch is preserved.
- **Cue taps respect play state.** If the track is playing, tapping a cue keeps it playing from there. If it is paused, the playhead moves and stays paused.
- **Works with the iPhone silent switch.** Playback uses the media channel, so the ring/silent switch does not mute it. Media volume still needs to be up.
- **Screen stays awake** while music plays.
- **Installable.** Add it to your home screen and it opens full-screen like a native app, and it loads offline.

## How your data is stored

Cue Player never copies or uploads your audio. Each song is identified by a SHA-256 hash of the file bytes, and only that hash plus your cues, speed, and settings are stored in the browser's `localStorage`. Reopening the same file, even from a different folder or device, re-attaches its cues.

Because browsers can evict site data, the library screen has **Export backup** and **Import backup**. The backup is a small JSON file. Importing merges by file hash and keeps whichever copy of a piece was updated most recently.

After a page reload you will be asked to attach the audio file again; the cues are already there.

## Using the app

1. Open the app and tap **Import audio**.
2. Play the track and tap **Add cue** at each spot you want to return to.
3. Hold a cue name to give it a meaningful label such as "Chorus" or "Bar 33".
4. Tap cues to jump between them. Use **Loop** to drill a phrase, **Stop at cue** to hear one phrase at a time, and the speed slider to slow it down.
5. On the library screen, tap **Export backup** now and then to keep a copy of your cues.

## Browser support

Any recent Chrome, Edge, Safari, or Firefox. On iOS 16.4 or later the silent switch is bypassed; on older iOS versions media volume and the silent switch both apply. Speed change without pitch shift depends on the browser's `preservesPitch` support, which all current major browsers provide.

## Development

Requirements: Node 20 or newer.

```sh
npm install
npm run dev
```

Other scripts:

```sh
npm run check    # type-check Svelte and TypeScript
npm run build    # production build in build/
npm run preview  # serve the production build locally
```

## Deployment

The app is a static single-page site built with `@sveltejs/adapter-static` and an `index.html` fallback. Upload the contents of `build/` to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, an S3 bucket, or a plain web server). The host must serve `index.html` for unknown paths so deep links like `/player/<id>` load. Serve over HTTPS so the service worker, file picker, and wake lock are available.

## Project layout

```
src/
  routes/
    +page.svelte             Library: import audio, rename, delete, backup
    player/[id]/+page.svelte Player: waveform, cues, transport
  lib/
    audio/
      engine.ts              HTMLAudioElement wrapper: seek, loop, stop-at-cue, rate, wake lock
      peaks.ts               Decodes audio and reduces it to waveform peaks
      peaks.worker.ts        Worker that does the reduction off the main thread
    components/
      Waveform.svelte        Canvas waveform, playhead, cue ticks, loop shading
      CueLane.svelte         Tappable, draggable, renamable cue labels
      CueList.svelte         Secondary list view of cues
      Transport.svelte       Play, previous/next cue, speed, loop, end behavior
    cues/
      phrase.ts              Finds the phrase (cue-to-cue span) around a time
      layout.ts              Stacks overlapping cue labels into rows
      names.ts               Default cue names and colors
    storage/
      library.ts             localStorage persistence, backup export and import
      hash.ts                SHA-256 of file bytes
      session.ts             Holds the attached File for the current session
  service-worker.ts          Caches the app shell for offline use
static/
  manifest.webmanifest       PWA manifest and icons
```

## Tech

Svelte 5 and SvelteKit, TypeScript, Vite. Playback uses `HTMLAudioElement` with `preservesPitch`; the Web Audio API is used only to decode the file for the waveform.
