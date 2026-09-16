# Brag Plan: plugin-keeperhub

## What is this app?
An ElizaOS plugin that stops an AI agent from moving crypto on its own: the agent composes
and dry runs a transfer, a human reads the exact plan, and only then does KeeperHub broadcast
that plan byte for byte.

## The angle
Not "look at our features." The video shows the one second that does not exist in any other
agent: the moment after the agent has decided and before anything is irreversible.

Every frame of terminal output in this video is real, captured from a live run against
production KeeperHub on Ethereum Sepolia. The transaction hash resolves on Etherscan. That is
the brag -- not a claim, a receipt.

## Hook (first 2-3 seconds)
A command types itself on a clean light terminal:

    send 0.05 ETH to 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

Cursor blinks. One line over it: **An agent just decided where your money goes.**

The hook works because everyone watching has already imagined the failure.

## Key moments (the middle)
- **The stakes, in one line.** "Right 99% of the time is a treasury drained on the hundredth
  transfer." No hedging, no SaaS language.
- **The plan block.** The real dry-run output types in: move, to, chain, gas estimate. This is
  the product. It is also the most video-worthy thing the project has, because it is
  monospace, specific, and unmistakably real.
- **"Nothing has moved."** Held alone, full scale. The whole thesis in three words.
- **The approval.** `confirm` types in. Then the receipt: transaction hash, `success, verified`.

## Outro / punchline
    plugin-keeperhub
    The agent proposes. You approve.

Then the pairing: ElizaOS x KeeperHub. Silence.

## User flow worth showing
Entry, key action, result -- the actual three beats of using it:
1. User asks the agent for a transfer in plain English.
2. The agent returns the exact plan and stops. Nothing has moved.
3. User approves; KeeperHub broadcasts and the chain returns a verified receipt.

## Tone
- Preset: polished
- Creative direction: a calm security film about the one second that matters
- Interpretation: restraint is the point. Slow reveals, generous hold on every readable line,
  no kinetic text, no hype. The product is a safety mechanism, so the video should feel
  controlled rather than loud. Confidence through stillness.

## Format: landscape -- 1920x1080
## Duration: 22.8 seconds

## Visual identity (from the project)
Deliberately the same palette as the README mermaid diagrams, so docs and video read as one
system. Light throughout -- a dark terminal would be the obvious choice and the wrong one here,
because the piece is about clarity, not hacker mystique.

- Background: `#fbfbfa` (warm off-white)
- Surface / terminal card: `#ffffff`, border `#e6e6e3`
- Text: `#1f2328`
- Accent, verified/safe: `#1a7f45`
- Accent, the gate: `#b8860b`
- Accent, refusal: `#b42318`
- Display font: a clean grotesque (Inter or system sans), medium weight, generous tracking
- Body/terminal font: monospace (JetBrains Mono, SF Mono, or system mono)
- Strongest visual element: the dry-run plan block in monospace, with its aligned label column

## Share copy (draft)
AI agents are probabilistic. Onchain transfers do not forgive that. plugin-keeperhub makes an
ElizaOS agent dry run every transfer, show you the exact plan, and execute only that -- byte
for byte. Real receipt, Sepolia, verified.

## Audio direction
- Role: sparse professional accents over a low bed
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3` -- the only mood available is
  upbeat corporate, which suits the real emotional beat here (control and relief) better than
  a tense score would
- Music treatment: start at 0.0s, low volume throughout (bed, never lead), gentle fade-in over
  the first 0.5s, fade out across the final 1.5s into the outro silence
- Music cue guidance: cue preset read from `assets/music/cues/...vol-9...md`. Track is
  114.84 BPM. Strong cues in window: 4.23s, 6.34s, 10.54s, 12.65s. Use 6.34s for the plan
  block reveal and 12.65s for "Nothing has moved." Beat grid available at ~0.52s spacing for
  sequencing the four plan lines.
- Audio-reactive treatment: subtle -- at most a light presence lift on the plan block reveal.
  Nothing that pulses or distracts from reading monospace text.
- SFX posture: sparse, motion-matched. Keyboard keypresses under the two typed commands only.
  One quiet interface click at the approval. One soft confirmation tone at the verified
  receipt. Nothing else.
- Audio-coupled moments: the typed command (keypress), the plan block lines landing on the
  beat grid, the `confirm` keystroke, the receipt check.
- Restraint rule: audio must never compete with reading. No riser, no whoosh, no stinger on
  text that the viewer needs to parse. If a cue would pull the eye off the plan block, cut it.

## Storyboard

| # | Time | Duration | Content | Motion | Audio |
|---|---|---|---|---|---|
| 1 | 0.0-3.7s | 3.7s | Terminal types `send 0.05 ETH to 0x1c7D...`; cursor blinks. Overlay: **An agent just decided where your money goes.** | Type-on at ~28 chars/s, then overlay fades up at 2.4s and holds | Music fades in; keypress SFX under typing |
| 2 | 3.7-7.9s | 4.2s | Full-bleed line: **Right 99% of the time is a treasury drained on the hundredth transfer.** | Slow fade up, hold, slow fade out. No movement. | Bed only; strong cue at 4.23s under the fade-up |
| 3 | 7.9-13.7s | 5.8s | The real dry-run plan block types in, line by line: `move / to / chain / gas estimate`. Aligned label column. | Each line lands on a beat (~0.52s apart) starting at the 10.54s cue; block settles and holds ~2s so it is readable | Bed lifts slightly; no SFX over the block |
| 4 | 13.7-16.0s | 2.3s | **Nothing has moved.** Alone, large, centered. | Fade up at the 12.65s strong cue, hold still | Bed drops to make room |
| 5 | 16.0-18.2s | 2.2s | `confirm` types in. Receipt appears: `transaction 0x5b537ffa...` / `receipt success, verified` in green. | Type-on, then receipt fades up beneath | Keypress, one interface click, one soft confirm tone |
| 5b | 18.2-21.2s | 3.0s | The landing page in a browser frame, URL bar reading `decodededan.github.io/plugin-keeperhub`, cropped to the hero where the working terminal sits. Caption: **The same gate, playable in your browser.** | Fade up, then a 1.035x drift over the capture so the page reads as a page, not a slide | Bed only |
| 6 | 21.0-22.8s | 1.8s | **plugin-keeperhub** / The agent proposes. You approve. / ElizaOS x KeeperHub | Crossfade in, hold, music fades to silence | Music fade-out to silence |

Scene durations sum to 22.8s.

## Re-cut note
Scene 5b was added after the landing page shipped. The frame is a real capture of
https://decodededan.github.io/plugin-keeperhub/ taken from the live URL, not a rebuilt mock:
a redrawn page drifts from what the link actually serves. The caption claims only what the
page does -- it replays the same real dry-run output and stops at the same gate, and its own
hint line says nothing there touches a chain.

## Readability check
- Scene 2 sentence: 12 words -> needs ~3.6s. Allocated 4.2s. Passes.
- Scene 3 plan block: 4 short lines, sequenced then held ~2s settled. Passes.
- Scene 4: 3 words -> needs ~0.9s. Allocated 2.3s. Passes, deliberately generous.
- Scene 5b caption: 6 words -> needs ~1.8s. On screen settled from 19.45s to 20.75s, plus
  the browser frame held from 18.3s. Passes.
- Scene 6 tagline: the first draft ran 9 words ("The agent proposes. You approve. KeeperHub
  executes exactly that.") needing ~2.7s against 1.8s allocated, so it failed this check and
  was trimmed to "The agent proposes. You approve." -- 5 words, ~1.5s, fits with headroom. The
  dropped clause is already carried by scene 3 and scene 5, so nothing is lost.
