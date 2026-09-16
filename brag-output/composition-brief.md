# Hyperframes Composition Brief: plugin-keeperhub

## Objective
A 22.8-second launch film for plugin-keeperhub, an ElizaOS plugin that makes an AI agent dry run
every onchain transfer and wait for human approval before any value moves.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080
- Duration: 22.8 seconds

## Source Material
- Project root: `/Users/okwared/Softwares/Hackathons/Dora/plugin-keeperhub`
- Primary files read: `README.md`, `src/actions.ts`, `src/render.ts`, `DEMO.md`
- Product name: plugin-keeperhub
- Strongest claim: a simulate action has no code path that broadcasts; confirm has no code
  path that constructs arguments
- Key visual moment to recreate: the dry-run plan block exactly as the plugin prints it,
  monospace, with its aligned label column

### Copy that must appear verbatim
Every line below is real output or real data from a live run against production KeeperHub.
Do not paraphrase, re-align, or "improve" any of it.

    send 0.05 ETH to 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

    Dry run complete. This is the exact plan that would execute:
      move         0.001 (native token)
      to           0x67f10576d6333FFA439EB1d4293BB6C9f019F138
      chain        11155111
      gas estimate 21227

    Nothing has moved.

    confirm

    transaction  0x5b537ffae10324d3b9e620c5b9647f51f24787b23b293d5097b75c5d3d5a048b
    receipt      success, verified

## Creative Direction
- Tone preset: polished
- Creative direction: a calm security film about the one second that matters
- Interpretation: restraint is the point. Slow reveals, long holds, no kinetic text, no hype.
  The product is a safety mechanism; the film should feel controlled rather than loud.
- Angle: show the one second that does not exist in any other agent -- after the agent has
  decided, before anything is irreversible. Every frame of terminal output is real and the
  transaction hash resolves on Etherscan. The brag is a receipt, not a claim.
- Hook: a transfer command types itself, then the line "An agent just decided where your money
  goes."
- Outro: plugin-keeperhub / The agent proposes. You approve. / ElizaOS x KeeperHub

### Avoid
- Generic SaaS language. No "streamline", no "seamless", no "empower".
- Abstract filler: no floating particles, no glowing orbs, no generic blockchain cubes.
- Dark terminal styling. This is deliberately a light piece -- the subject is clarity.
- Purple, violet, magenta, or neon gradient accents.
- Kinetic typography on any line the viewer must actually read.
- Re-aligning the plan block. Its column alignment is the product.

## Visual Identity
Matches the README mermaid diagrams so documentation and film read as one system.

- Background: `#fbfbfa`
- Surface / terminal card: `#ffffff`, 1px border `#e6e6e3`, soft shadow, generous padding
- Text: `#1f2328`
- Muted text: `#57606a`
- Accent, verified: `#1a7f45`
- Accent, the gate: `#b8860b`
- Accent, refusal: `#b42318`
- Display font: Inter or system grotesque, weight 500, generous letter-spacing
- Body / terminal font: JetBrains Mono, SF Mono, or system monospace
- Visual references: the plan block's aligned label column; the green verified receipt

## Storyboard
`brag-output/brag-plan.md` is the creative contract. Scene summary:

1. **The command** — 3.7s — terminal types the transfer request; overlay lands: "An agent just
   decided where your money goes."
2. **The stakes** — 4.2s — full-bleed: "Right 99% of the time is a treasury drained on the
   hundredth transfer."
3. **The plan** — 5.8s — the real dry-run block types in line by line, then settles and holds
   at least 2s fully readable.
4. **The gate** — 2.3s — "Nothing has moved." alone, large, centered, still.
5. **The approval** — 2.2s — `confirm` types; receipt appears beneath with `success, verified`
   in the verified green.
5b. **The page** — 3.0s — the landing page in a browser frame, URL bar reading
   `decodededan.github.io/plugin-keeperhub`, cropped to the hero. Caption: "The same gate,
   playable in your browser." The capture is taken from the live URL
   (`assets/images/site.png`), never redrawn in the composition.
6. **The mark** — 1.8s — plugin-keeperhub / The agent proposes. You approve. / ElizaOS x
   KeeperHub.

## Readability contract
Scene 3's plan block and scene 4's line are the two moments the whole film exists for. If
timing has to give anywhere, it gives everywhere else first. The plan block holds a minimum of
2 seconds fully settled. "Nothing has moved." holds a minimum of 1.5 seconds.

## Audio
- Audio role: sparse professional accents over a low bed
- Audio arc: fades in under the hook, sits low and steady through the stakes, lifts slightly
  as the plan block lands, drops back for "Nothing has moved.", a single soft confirmation at
  the receipt, then fades to silence under the outro.
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`, low volume bed throughout
- Music cues: 114.84 BPM. Strong cues at 4.23s, 6.34s, 10.54s, 12.65s. Land the plan block
  reveal near 10.54s and "Nothing has moved." near 12.65s. Beat grid ~0.52s apart for
  sequencing the four plan lines.
- SFX: keyboard keypresses under the two typed commands only; one quiet interface click at the
  approval; one soft confirmation tone at the verified receipt. Nothing else.
- Restraint rule: no riser, no whoosh, no stinger over text the viewer must parse. If a cue
  would pull the eye off the plan block, cut it.
