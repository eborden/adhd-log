> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (new native
> dependency, real networking surface, gated on a product-scope call — same framing as docs
> 20/26/34/38) · Ref: innovation batch, round 4

# Local-network device-to-device sync

## Problem

The app's data lives on exactly one phone. `docs/BUILD.md`'s own "Why not EAS" section and this
app's whole design already commit hard to local-only, no-cloud — a deliberate, correct choice
for a health log. But "local-only" and "single-device-only" are not the same commitment, and
today they're conflated: someone who uses both a phone and a tablet, or who is migrating to a
new phone, has exactly one path — the JSON export/import flow (manual file share, doc 35's
reminder to actually use it). That's a real, if infrequent, friction point this doc explores a
narrower, still fully local answer to: **direct device-to-device transfer over the same local
Wi-Fi network, never touching the internet, never touching a cloud account.**

## Options

### Option A — recommended if built: one-shot local-network backup transfer, not continuous sync

- One device (the source) generates a JSON backup (reusing `buildBackup` unchanged) and
  advertises it on the local network via mDNS/Bonjour service discovery; the other device (the
  destination) discovers it, requests it over a direct local socket connection, and runs it
  through the exact same `restoreBackup` path the manual JSON-import flow already uses.
- **One-shot, user-initiated on both ends** — not a background sync, not a standing connection.
  Both devices must be on the same Wi-Fi network and both must explicitly start the transfer
  (source: "Send backup to nearby device"; destination: "Receive backup from nearby device").
  No pairing state persists after the transfer completes.
- **Same-network only, no internet relay.** If the two devices aren't on the same local network
  (different Wi-Fi, one on cellular), the feature simply doesn't find anything to connect to —
  there is no fallback path through any server, this app's own or a third party's.

### Option B — deferred: continuous two-way sync between a user's own devices

Keeping two devices' data continuously merged (so either can be used interchangeably day to
day) is a materially larger problem — conflict resolution (both devices logged today's check-in
independently), a persistent pairing/trust relationship, and a background networking component
this app has never needed before. Logged as a named follow-on if Option A's one-shot transfer
proves genuinely useful in practice; not designed further here.

### Option C — rejected: any cloud-relay fallback for when devices aren't on the same network

Rejected outright — the entire value of this doc is that it stays inside the "never touches the
internet" commitment doc 35/PLANNING-v0 already lean on. A cloud relay "for when local discovery
fails" would be a second, materially different feature wearing this one's name, and would be
exactly the kind of scope-creep-via-fallback this app's mission guards against.

**A concrete, checkable guardrail, not just a paragraph (panel — scope lens must-fix).** An
earlier draft's "never touches the internet" commitment was prose-only — real, but nothing a
future implementer under scope pressure would necessarily trip over while adding a seemingly
reasonable fallback. The boundary must be a specific, reviewable technical constraint, not an
aspiration: discovery is restricted to mDNS/`.local` link-local service resolution only (no
DNS/hostname resolution of any kind); the transport socket is bound to a link-local or
RFC1918-private address obtained from that discovery step, never an arbitrary host; and the
networking code path contains **no client capable of opening an outbound connection to a
non-local address** — not "configured not to," structurally incapable, so "never touches the
internet" is a property of what the code can do, not a setting someone could flip.

## Non-goals (all options)

- **No account, no pairing code exchanged over the internet, no QR-code-over-a-server pairing
  flow.** Device discovery happens entirely via local-network protocols (mDNS/Bonjour); nothing
  about establishing the connection touches any server this app or a third party operates.
- **No partial/selective transfer.** The whole backup moves, or nothing does — the same
  all-or-nothing shape the existing JSON export already has. No "just send my entries, not my
  profile" granularity, which would be new scope this doc doesn't need.
- **No transfer over Bluetooth or any protocol beyond local Wi-Fi.** Bluetooth device-to-device
  transfer is a materially different native surface (a third platform API to integrate,
  alongside mDNS/Bonjour and the socket transport) for a use case (same-room device pairing)
  Wi-Fi already covers when both devices are on the same network, which is the common real case
  (home Wi-Fi, not two devices with Wi-Fi off in a parking lot).

## Feasibility / cost, stated plainly

- **Local network permission is a real, new, and increasingly friction-heavy ask.** Both iOS
  (`NSLocalNetworkUsageDescription`, plus a Bonjour-services entitlement declaration) and
  Android (nearby-Wi-Fi-devices permission on newer API levels) have tightened local-network
  discovery behind explicit user-facing permission prompts in recent OS versions specifically
  because this exact capability — apps discovering other devices on the network — has been
  abused for cross-app tracking. This app would be asking for a permission that, to a user
  reading the prompt cold, sounds identical to what a tracking SDK asks for; the prompt copy and
  in-app framing carry real weight here that a typical feature doesn't.
- **A genuinely new networking capability, not a config-plugin addition.** Neither platform's
  Expo-ecosystem tooling has a first-party, batteries-included "local device discovery + socket
  transfer" module the way `expo-notifications` covers push. This likely means either a
  community module per platform or hand-rolled native bridges — closer in kind to doc 34's "this
  is a second small feature to build and maintain," though smaller in scope (one transfer flow,
  not a whole second UI surface).
- **No cloud relay means no fallback UX to fall back on** — if discovery fails (different
  subnets, a router that blocks mDNS/multicast traffic — common on public/guest Wi-Fi and some
  mesh-router setups), the honest failure mode is "nothing found," which will sometimes be
  confusing without a clear explanation that this doc's copy needs to own (see UI).
- **A forced native rebuild** once added, per `docs/BUILD.md`'s cost table — comparable to doc
  33's single-purpose-library cost, smaller than doc 26/34's two-native-module/two-target cost.

## Recommendation

**Build only if the existing JSON export/import flow (plus doc 35's reminder to use it) proves
insufficient in practice** — for most users, "export → AirDrop/email/Files-app the JSON →
import on the other device" already solves the same problem with zero new permissions, zero new
native code, and zero new failure modes, just a few more manual taps. This doc's value is real
but narrow (skips the manual file-shuffling, works even without AirDrop/a shared cloud drive
available), and the local-network-permission cost (both the engineering cost and the
now-elevated user-trust cost of that specific permission class) is real enough that this should
be a deliberate, demonstrated-need decision, not a default build. Option A only if greenlit;
Option B stays a named follow-on; Option C stays rejected.

## Design for Option A, if built

### Shared payload (`lib/backup.ts`, unchanged)

No new type. The transferred payload is exactly `buildBackup(...)`'s existing `Backup` object,
serialized the same way the JSON export already does — this doc adds a second **transport** for
an existing artifact, never a new data shape.

### Native plumbing (described, not code-specified — outside the RN-free `lib/` tree)

- **Discovery**: the source device advertises a Bonjour/mDNS service (e.g.
  `_adhdlogsync._tcp`) carrying no data itself, just an announcement "a transfer is available
  here"; the destination device browses for that service type.
- **Transfer**: once discovered, a direct local socket connection (e.g. a local HTTP server on
  an ephemeral port, or a platform-native local-socket API) carries the serialized `Backup` JSON
  from source to destination — no different in kind from how the existing JSON export's file
  gets from one place to another, just over a local socket instead of a share-sheet file.
- **Completion**: the destination runs the received JSON through the exact same
  `importJsonBackup`/`restoreBackup` path (**`lib/export.ts`** for `importJsonBackup` — corrected
  citation, panel — TS lens must-fix: an earlier draft misattributed it to `lib/backup.ts`, which
  owns `buildBackup`/`parseBackup` but not the import-parsing entry point; `restoreBackup` is
  correctly `lib/storage.ts:633-640`) the manual import flow already uses — this doc introduces
  no new parse/validate/persist logic at all, only a new way to get bytes onto the device before
  that existing path runs.

### UI (`app/(tabs)/settings.tsx`, export section)

Two new actions beside the existing Export/Import JSON buttons: "Send backup to nearby device"
(source role) and "Receive backup from nearby device" (destination role). Each opens a minimal
screen showing discovery status ("Looking for a nearby device..." → a found device's name → a
confirm-before-transfer step, since receiving a backup **replaces** the destination's local
data the same way manual JSON import already does and deserves the same explicit confirmation).
**Explicit failure copy, not a silent timeout**: if nothing is found within a reasonable window,
"No nearby device found — make sure both devices are on the same Wi-Fi network, or use Export/
Import instead," naming the existing fallback rather than leaving the user stuck.

**A confirmed device name is not proof of who's on the other end (panel — scope lens must-fix).**
`parseBackup` bounds the received payload's _shape_, not its _content_ — a structurally valid
`Backup` full of someone else's data would still parse cleanly. On shared Wi-Fi (a coffee shop,
a guest network), a hostile device advertising the same mDNS service type could offer a crafted
backup, and the only gate today would be a user confirming a spoofable device name before an
overwrite that replaces their real longitudinal history. Mitigation, using only mechanisms these
Non-goals already permit (no internet-exchanged pairing code): the source device displays a
short numeric code (generated locally, shown on-screen, never transmitted over the network
itself) that the person on the destination device must type in before the transfer proceeds —
a local, in-person "prove you're looking at the same source I am" check, not a remote pairing
flow. This adds one short manual step, only for this feature, only at the moment of an
irreversible local-data overwrite.

### Test plan

The transport/discovery layer is native and not unit-testable under this repo's RN-free
convention — manual on-device verification (two real devices on the same Wi-Fi, confirm a
transfer completes and `restoreBackup` produces the expected data; confirm the "not found"
failure path when devices are deliberately put on different networks) is the test plan for that
layer, matching docs 26/33/34/38's manual-verification posture for their own native integration
points. No new `lib/` pure logic is introduced beyond what already exists (`buildBackup`,
`importJsonBackup`, `restoreBackup`), so there is no new Vitest surface this doc adds.

## Gate compliance

No new persisted type, no `Backup`/`STORAGE_KEYS` change — this doc is entirely a new transport
for an existing artifact. The native discovery/transfer code lives outside this repo's
TypeScript/ESLint/Vitest gates, same posture as docs 26/33/34/38.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds — reuses `buildBackup`/
`importJsonBackup`/`restoreBackup` unchanged. If ever built, should land after confirming the
existing JSON export/import path (plus doc 35's backup reminder) hasn't already resolved the
underlying need on its own.

## Alternatives considered

- **A QR code carrying the full backup (chunked across multiple codes), avoiding networking
  entirely:** rejected — this is exactly the alternative doc 33 already named and rejected for
  its own, much-smaller portal digest; a full backup is far too large for even a chunked
  QR-code approach to be pleasant, and this doc's local-network transport is the more natural
  fit for a payload this size.
- **Piggybacking on an existing OS same-account sync mechanism (iCloud/Google) instead of
  peer-to-peer local transfer:** rejected — both are cloud accounts, which is precisely the
  local-only commitment this app has held throughout; a peer-to-peer local transfer with no
  account requirement is the only option that doesn't compromise that commitment.
- **Bluetooth instead of/alongside Wi-Fi:** rejected for v1 — see Non-goals; adds a third native
  API surface for a use case local Wi-Fi already covers in the common case.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical), approve-with-changes (strict-TS,
scope). Must-fixes applied above.

- **Clinical — approve.** Purely a new transport for the existing `buildBackup`/`restoreBackup`
  artifact — no new captured data, no aggregation, nothing that could imply interpretation. The
  one clinical-adjacent risk is data loss (a clobbered day degrades the multi-week trend the app
  exists to build), and the doc already gives receiving the same explicit confirm step as manual
  import. No must-fix — whether "replace, not merge" needs stronger copy is a data-model/scope
  call, addressed below, not a clinical one.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ `importJsonBackup`
  was misattributed to `lib/backup.ts` (which owns `buildBackup`/`parseBackup`); it actually lives
  in `lib/export.ts` — corrected. No new persisted type, no `Backup`/`STORAGE_KEYS` change — the
  native transport code lives outside the TS/ESLint/Vitest gates, same posture as docs 26/33/34/38.
- **Mobile UX / friction — no verdict received.** The UX lens agent did not deliver findings for
  this round despite three explicit re-requests (a recurring pattern already noted in this
  project's memory). Not treated as blocking: this is a P3 decision doc explicitly recommending
  against building without demonstrated need, so the UI design here is provisional pending that
  decision, same as docs 26/34/38's own posture.
- **Data-model / migration + privacy + scope — approve-with-changes.** Confirmed this stays
  inside the local-only commitment in spirit: a second transport for an existing artifact, no new
  data shape, `restoreBackup` reused unchanged, data moving only on explicit dual-user action.
  _Must-fixes (applied):_ (1) "no cloud relay" was prose-only and not something a future
  implementer would necessarily trip over — added a concrete, structural guardrail (link-local-
  only discovery/binding, no outbound-capable client) so the boundary is a property of the code,
  not an aspiration; (2) a confirmed device name is spoofable and `parseBackup` bounds shape, not
  content, so a hostile device on shared Wi-Fi could offer a crafted backup that overwrites a
  user's real history — added a locally-displayed, manually-typed numeric confirmation code as an
  in-person trust check, using only mechanisms the Non-goals already permit. This is the first
  doc in the whole pending set to add an ambient, network-reachable listener to a health app, and
  these two fixes are what keep "local-only" from being purely rhetorical rather than enforced.
