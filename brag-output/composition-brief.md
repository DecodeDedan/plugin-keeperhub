# Hyperframes Composition Brief: plugin-keeperhub demo

## Objective
A 105-second recorded demonstration of plugin-keeperhub: an ElizaOS agent asked in plain English
to move money, stopped at a human approval gate, then broadcasting the reviewed plan and
returning a receipt that resolves on a public explorer.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080, 105.0 seconds

## Source material
All product footage is a recording. Nothing is recreated in the composition.

- `assets/video/a-ask.mp4` … `f-receipt.mp4` — one ElizaOS session at localhost:3000, recorded
  frame by frame through Chrome DevTools screencast while the real UI was driven
- `assets/video/h1-ask.mp4`, `h2-wait.mp4`, `assets/images/refusal.png` — a second session, where
  the model returns an unparsable address and the plugin refuses before any call
- `assets/video/g-site.mp4` — the published landing page, recorded the same way
- `assets/images/etherscan.png` — the transaction page at 2x
- `docs/run.json` — the values shown on the two record cards

### Values that must stay exact
    transaction  0x14c5929f9d39527345fbfb9e7852f85cfcd84313853a6cd68fcdd75a8fdf2bc6
    block        11718633
    gas used     47705
    task id      27fe82a5-3fc8-4759-96dd-9d40a193ba4c
    derived key  3bd84fee005066247352615c0ed5538ce6775251044138c1e0f4ffa34ef9c50c
    gas estimate 21227

## Creative direction
- Tone: polished. The product is a safety mechanism; the film should feel controlled.
- Footage sits inside a light window frame carrying the real URL or process name, so a viewer
  always knows which surface they are looking at.
- Captions are short and sit below the frame. They label what is happening; they do not
  restate the narration.
- The only added motion is a slow vertical drift across the explorer screenshot and fades on
  the record cards. Recordings are never re-timed except for the two labelled 8x waits.

## Avoid
- Re-typing terminal output as animated text. If it is not in the recording, it does not appear.
- Unlabelled speed changes.
- Dark styling on the composition's own scenes: the ElizaOS client is dark because that is how
  it renders, and the contrast with the light frames is the honest look of a real capture.

## Visual identity
Matches the landing page exactly: `#eef1ea` ledger ground with the ruled background, `#fdfdfb`
cards, `#18211d` ink, `#b0810f` for the gate, `#15683a` for verified. IBM Plex Sans and IBM
Plex Mono, embedded as woff2 in `assets/fonts/` so renders do not depend on a font CDN.

## Audio
- No narration. A single music bed at 0.40 for the full 105 seconds, no SFX.
- Captions carry the commentary; the two longest shots swap caption once on a crossfade so no
  line has to hold for twelve seconds.
