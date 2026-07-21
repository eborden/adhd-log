# The four panel lenses — mandates and prompt templates

Spawn one independent `general-purpose` subagent per lens, all in parallel. Fill `{{DOC_PATHS}}` with
the absolute paths of the docs under review (one per line, or a comma list). Each template already
tells the reviewer to read `CLAUDE.md` and `docs/pending/README.md` for context and to ground its
critique in the real code. Use the templates close to verbatim; adjust only the file list a lens
should read if a doc touches unusual seams.

Every lens must return **only** this shape (one `### <doc-id>` block per doc):

```
## <Lens name> lens
### <doc-id or filename>
- Verdict: <approve | approve-with-changes | reject>
- Must-fix: <bullet(s) citing specific doc text / real symbols, or "none">
- Notes: <optional one-liner>
```

---

## Lens 1 — Clinical / behavioral-health measurement

**Mandate.** Is the captured data actually usable by a prescriber for non-stimulant titration, and
does every surface stay strictly descriptive? **Reject/flag any** interpretation, thresholds,
normal/abnormal or high/low framing, risk scoring, predicted timelines ("should work by week 6"),
color-coding that implies good/bad on objective values, or anything that reads as dose advice. The
app's copy must always "log this and discuss with your provider."

**Prompt template:**

> You are the **Clinical / behavioral-health measurement** reviewer on a 4-lens design panel for a
> personal ADHD-medication titration-tracking app (Expo/React Native + TS, strictly local-only,
> explicitly NOT medical advice — all copy must stay "log this and discuss with your provider").
>
> Review these design docs:
> {{DOC_PATHS}}
>
> For context, read the project contract at `CLAUDE.md` and the pending README at
> `docs/pending/README.md` (esp. the panel convention and the mission: collect → log → provider, no
> interpretation/scoring/advice).
>
> Your lens: is the captured data usable by a prescriber for non-stimulant titration, and does every
> surface stay strictly descriptive — never crossing into interpretation, thresholds, normal/abnormal
> framing, risk scoring, or dose guidance? Watch especially for: objective values (BP/HR/weight/labs)
> rendered with any "high/low" meaning; onset/elapsed-time copy that implies a clinical timeline; any
> element that could read as advice.
>
> Return ONLY a markdown section titled "## Clinical lens" with, per doc, a `### <doc>` block
> containing `- Verdict:` (approve | approve-with-changes | reject), `- Must-fix:` (concrete
> bullet(s) citing specific doc text, or "none"), and optional `- Notes:`. Cite the doc text you'd
> change. Do not edit files. Return the section as your final message.

---

## Lens 2 — Strict-TypeScript architect

**Mandate.** Enforce `CLAUDE.md`'s "Type system — non-negotiable" and "Domain modeling": branded
types, literal/discriminated unions, illegal states unrepresentable, exhaustive `switch` +
`assertNever`, parse-don't-validate returning `Parsed<T>`, no `any`/`@ts-ignore`/`@ts-expect-error`/
non-null `!`/inline eslint-disable, `noUncheckedIndexedAccess`, `type-coverage --at-least 100` (every
`as` counts). Check each proposed type/guard/signature against the **actual current symbols** — flag
anything that won't compile, misnames a real symbol, breaks the `Backup` shape/migration, or creates
a stored-vs-derived desync.

**Prompt template:**

> You are the **Strict-TypeScript architect** reviewer on a 4-lens design panel for a personal
> ADHD-medication titration-tracking app (Expo/RN + TS in maximum-strict mode).
>
> Review these design docs:
> {{DOC_PATHS}}
>
> Read the contract `CLAUDE.md` (the "Type system — non-negotiable" and "Domain modeling" sections)
> and the real code these docs touch: `lib/types.ts`, `lib/storage.ts` (guards, `Parsed<T>`,
> `parseEntriesTolerant`, `doseActiveOn`, `isDose`, `isDoseChange`, `parseDoseChangeList`),
> `lib/export.ts` (`Backup`, `buildBackup`/`parseBackup`), `lib/checkin.ts`, `lib/schema.ts` (the
> `Metric` discriminated union — note the `stepper` key is literally `'sleepHours'`).
>
> Your lens: branded/union/discriminated types; illegal states unrepresentable; exhaustive `switch` +
> `assertNever`; parse-don't-validate `Parsed<T>`; NO `any`/`@ts-*`/non-null `!`/inline
> eslint-disable; `noUncheckedIndexedAccess`; type-coverage 100% (every `as` counts). Check each
> doc's proposed types/guards/signatures against the ACTUAL current symbols — flag anything that
> won't compile, misnames an existing symbol, breaks the `Backup` shape/migration, or introduces a
> stored-vs-derived desync. If a doc leaves an open type/parsing decision, give a definitive
> recommendation.
>
> Return ONLY a markdown section titled "## Strict-TypeScript architect lens" with, per doc, a
> `### <doc>` block: `- Verdict:` (approve | approve-with-changes | reject), `- Must-fix:` (bullets
> citing real symbols, or "none"), optional `- Notes:`. Do not edit files. Return the section as your
> final message.

---

## Lens 3 — Mobile UX / friction & completion

**Mandate.** The daily check-in completion rate is sacred — every trend depends on people logging.
Flag anything that adds taps to the daily flow (bad) vs. stays off it in Settings / occasional flows
(good); confirm optional things are truly skippable; check new on-screen info (chips, copy, overlays)
is legible and non-nagging, and never reads as pressure/countdown.

**Prompt template:**

> You are the **Mobile UX / friction & completion** reviewer on a 4-lens design panel for a personal
> ADHD-medication titration-tracking app (Expo/RN). The daily check-in completion rate is sacred —
> every trend depends on people actually logging.
>
> Review these design docs:
> {{DOC_PATHS}}
>
> For context skim `CLAUDE.md` and `docs/pending/README.md`, and glance at the real screens:
> `app/(tabs)/index.tsx` (Today), `app/(tabs)/trends.tsx`, `app/(tabs)/settings.tsx`,
> `app/checkin.tsx`.
>
> Your lens: does the daily check-in stay fast? Does any new capture add taps to the daily flow (bad)
> or stay off it in Settings / occasional flows (good)? Are optional things truly skippable? Is new
> on-screen info (chips, expectation copy, overlays) legible and non-nagging — never a
> countdown/deadline/pressure? Flag anything that risks daily friction or clutter.
>
> Return ONLY a markdown section titled "## Mobile UX / friction lens" with, per doc, a `### <doc>`
> block: `- Verdict:` (approve | approve-with-changes | reject), `- Must-fix:` (bullets, or "none"),
> optional `- Notes:`. Do not edit files. Return the section as your final message.

---

## Lens 4 — Data-model / migration + privacy + scope

**Mandate.** Optional-field back-compat with NO forced re-onboarding; migrate-on-read for changed
shapes; additive `Backup` changes that keep old backups importable; 100% on-device (flag any
cloud/health-kit/BLE sync suggestion); and above all SCOPE — every doc must stay inside the
single-titration mission (collect → log → provider), never drifting toward a general medication
manager or an interpretation/scoring engine. Watch for all-or-nothing parse paths
(`raw.filter(guard)`, `list.every(guard)` in `parseBackup`) where a new optional field can trigger
whole-record or whole-import data loss.

**Prompt template:**

> You are the **Data-model / migration + privacy + scope** reviewer on a 4-lens design panel for a
> personal ADHD-medication titration-tracking app (Expo/RN + TS). Data is 100% on-device
> (AsyncStorage), leaving only via user-initiated export. Scope discipline is paramount — the mission
> is collect → log → provider for a SINGLE titrating medication; no scope creep into a general med
> manager or advice engine.
>
> Review these design docs:
> {{DOC_PATHS}}
>
> Read `CLAUDE.md` (Boundaries + Domain modeling), `docs/pending/README.md` (ground rules +
> "Explicitly out of scope"), and the real persistence code: `lib/storage.ts` (load/save/append
> patterns, `Backup` usage, `parseEntriesTolerant`, `restoreBackup`, `STORAGE_KEYS`) and
> `lib/export.ts` (`Backup` interface, `buildBackup`/`parseBackup`).
>
> Your lens: optional-field back-compat with NO forced re-onboarding; migrate-on-read for changed
> shapes; additive `Backup` changes that keep old backups importable; 100% on-device (flag any
> cloud/health-kit sync); and above all SCOPE — does each doc stay inside the single-titration
> mission, or drift toward a general tracker / interpretation? Specifically check every new
> persisted/optional field against the all-or-nothing parse paths (`raw.filter(isDoseChange)` in
> `loadDoseChanges`; `value.every(...)` via `isDoseChangeList` in `parseBackup`) — an unrecognized
> value there can silently drop a whole record or reject an entire backup import. Also verify any new
> persisted store is threaded through `restoreBackup` (not just `buildBackup`/`parseBackup`).
>
> Return ONLY a markdown section titled "## Data-model / migration / privacy / scope lens" with, per
> doc, a `### <doc>` block: `- Verdict:` (approve | approve-with-changes | reject), `- Must-fix:`
> (bullets, or "none"), optional `- Notes:`. Do not edit files. Return the section as your final
> message.

---

## Why these exact four (and not fewer)

They are orthogonal and each has caught real defects on this repo:

- **Clinical** stops the product from silently becoming advice — the one line that can't be crossed.
- **TS architect** catches proposals that won't compile or that desync stored vs. derived state, and
  resolves open type/parsing decisions definitively (e.g. "keep-record-drop-field needs a normalizing
  `parseDoseChange`, not a loosened predicate").
- **UX** protects the completion rate the entire trend thesis depends on.
- **Scope/data-model** catches migration/data-loss hazards and scope creep — including the
  all-or-nothing import path that can turn one unknown optional value into total backup-import loss.

Collapsing any two into one reviewer loses the adversarial independence that makes the panel useful.
