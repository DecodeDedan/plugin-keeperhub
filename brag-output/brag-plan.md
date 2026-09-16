# Brag Plan: plugin-keeperhub — the 90 second demo

## What this is
A recorded demonstration, not a dramatisation. Every frame of product footage in this video
is a screen recording of software actually running: the ElizaOS client at localhost:3000 with
plugin-keeperhub loaded, the published landing page, and Etherscan. No terminal output is
re-typed, re-enacted or rebuilt in the composition.

## The angle
Show the whole loop, in order, without cutting away from the part that is usually hidden: the
moment after the agent has decided and before anything is irreversible. The proof is that the
transaction at the end exists on a public chain and can be checked by anyone watching.

## What was captured, and how

| Source | Method | Length |
|---|---|---|
| ElizaOS session | Chrome DevTools screencast, frame by frame with arrival timestamps, driven through the real UI | 79.5s, 3660 frames |
| Landing page | same, against the published URL | 16.0s, 102 frames |
| Etherscan | page screenshot at 2x | still |

The session ran once, start to finish: the request was typed into the chat, KEEPERHUB_SIMULATE
returned a dry run, `confirm` was typed, and KEEPERHUB_CONFIRM broadcast it. The model was
Ollama qwen2.5:14b running locally; KeeperHub was production, chain 11155111.

Broadcast: `0x14c5929f9d39527345fbfb9e7852f85cfcd84313853a6cd68fcdd75a8fdf2bc6`
Receipt: success, block 11718633, gas used 47705, read from a public Sepolia node rather than
from KeeperHub.

## Honest editing
Two waits are sped up 8x, both labelled on screen while they run: 25 seconds of the local model
composing, and 32 seconds between approval and the receipt. Nothing else is time-shifted, and
no footage is reordered. The speed-up is the only manipulation in the video.

## Format: landscape 1920x1080
## Duration: 90.0 seconds
## Tone: polished. A demo, narrated plainly, with the product doing the talking.

## Storyboard

| # | Time | Duration | Content | Source |
|---|---|---|---|---|
| 1 | 0.0-6.0 | 6.0s | Logo, wordmark, "One agent, one transfer, recorded start to finish." | composition |
| 2 | 6.0-10.7 | 4.7s | The request typed into the ElizaOS chat | footage, 1.5x |
| 3 | 10.7-13.9 | 3.2s | The local model composing, labelled 8x | footage, 8x |
| 4 | 13.9-19.9 | 6.0s | KEEPERHUB_SIMULATE returns the exact plan | footage, real time |
| 5 | 19.9-28.4 | 8.5s | "Nothing has moved." held alone | composition |
| 6 | 28.4-30.4 | 2.0s | `confirm` typed by a human | footage, real time |
| 7 | 30.4-34.5 | 4.1s | KEEPERHUB_CONFIRM replaying the stored payload, labelled 8x | footage, 8x |
| 8 | 34.5-40.4 | 5.9s | The receipt: execution id, transaction hash | footage, real time |
| 9 | 40.4-48.4 | 8.0s | Task id, derived key and stored args from a dry run at capture time | docs/run.json |
| 10 | 48.4-60.4 | 12.0s | Etherscan: success, block, internal transfer of 0.001 ETH | screenshot, slow drift |
| 11 | 60.4-71.1 | 10.7s | The landing page running the same gate | footage, 1.2x |
| 12 | 71.1-79.5 | 8.4s | Where each value on that page comes from | docs/run.json |
| 13 | 79.5-90.0 | 10.5s | npm install, "The agent proposes. You approve.", ElizaOS x KeeperHub | composition |

## Voiceover script

1. (0.6s) This is an ElizaOS agent with a wallet, a real one, on Ethereum Sepolia. Watch what happens when I ask it to move money.
2. (9.0s) The request is plain English. The plugin does not sign anything. It asks KeeperHub to dry run the transfer against the real chain, and broadcasts nothing.
3. (18.3s) Here is what comes back. The exact plan. The amount, the recipient, the chain, the gas estimate. And the line that matters: nothing has moved.
4. (27.6s) The model has already done its work, before anything could move value. From here it contributes nothing at all.
5. (34.2s) I approve. KeeperHub replays the stored payload byte for byte, under a key derived from the plan itself, so a retry can never execute the transfer twice.
6. (48.9s) That is a real transaction hash. On Etherscan: success, block eleven seven one eight six three three, one thousandth of an ether transferred.
7. (61.0s) The website runs the same gate, and it does not fake it either.
8. (71.6s) Every line there is replayed from a capture file, and the receipt is checked against a public node, not against the service making the claim.
9. (80.3s) Install it with npm. Your agent proposes, you approve, and KeeperHub executes exactly what you read.

Voice: generated locally, one WAV per line, in `composition/assets/voice/`. Scene durations were
set from the measured length of each line rather than the other way round.

## Audio
- Narration at full level, one track per line.
- Music bed at 0.06 throughout, low enough to sit under speech without ducking automation.
- No SFX: the footage is the evidence and stingers would only decorate it.

## Readability check
- Every caption is 4 to 9 words and holds for the length of its scene, at least 2 seconds.
- Scene 9 and 12 hold monospace records for 8 seconds each, the longest holds in the film.
- The plan block in scene 4 is on screen for 6 seconds at real speed, unedited.
