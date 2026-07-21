---
name: design-panel-review
description: Runs this repo's 4-lens design-review panel over one or more design docs, then applies the must-fixes. Use when a new docs/pending/ plan has been drafted (or an existing one substantially revised) and needs the same clinical / strict-TypeScript / mobile-UX / data-model-scope review that docs 06–20 went through before landing, or whenever the user asks to "run the panel", "panel-review" a design, or add the `## Panel review` section to a plan.
---

# Design Panel Review

## Overview

`docs/pending/` design docs in this repo are not landed until each has been run through a
**four-lens expert panel** and its must-fixes applied — see the "How the docs were produced" section
of `docs/pending/README.md`. This skill reproduces that process reliably: it spawns four independent
reviewers (one per lens), each grounded in the repo's real symbols and the `CLAUDE.md` contract,
collects their per-doc verdicts and must-fixes, folds the must-fixes back into the docs, and records
a `## Panel review` section in each. It exists so the review is consistent, adversarial, and
repo-specific every time — not re-improvised.

## When to use

- A new plan has been drafted for `docs/pending/` (e.g. distilled from research or a feature idea)
  and needs review before it can land.
- An existing plan was substantially rescoped and its `## Panel review` section is stale.
- The user says "run the panel", "panel-review these docs", "get the four lenses on this", or asks
  for the `## Panel review` section.

Do **not** use it for a code diff review — that is `/code-review`. This reviews _design docs_.

## The four lenses

The panel is always these four, no more, no less. Full mandates and ready-to-use prompt templates
are in **`references/lenses.md`** — read that file before spawning, and use its prompt templates
verbatim (they encode each lens's must-fix triggers and are tuned to `CLAUDE.md`):

1. **Clinical / behavioral-health measurement** — is the captured data usable by a prescriber for
   non-stimulant titration, and does every surface stay strictly descriptive (no interpretation,
   thresholds, normal/abnormal framing, risk scoring, or dose advice)?
2. **Strict-TypeScript architect** — branded/union/discriminated types, illegal states
   unrepresentable, exhaustive `switch` + `assertNever`, parse-don't-validate `Parsed<T>`, no
   `any`/`@ts-*`/non-null `!`/inline eslint-disable, `noUncheckedIndexedAccess`, 100% type-coverage;
   every proposed type/guard/signature checked against the _actual_ current symbols.
3. **Mobile UX / friction & completion** — does the daily check-in stay fast? Optional things truly
   skippable, nothing new forced onto the daily flow, no clutter/nag on Today or Trends.
4. **Data-model / migration + privacy + scope** — optional-field back-compat with no forced
   re-onboarding, migrate-on-read, additive `Backup` changes that keep old backups importable, 100%
   on-device, and above all no scope creep beyond the single-titration mission.

## Workflow

### 1. Identify the target docs and read the ground rules

Confirm which `docs/pending/*.md` files are under review. Read `docs/pending/README.md` (the panel
convention, ground rules, and "Explicitly out of scope" list) and `CLAUDE.md` (the non-negotiables
the lenses enforce) so the review is anchored to current contracts.

### 2. Spawn the four lenses as independent reviewers

Read `references/lenses.md` and spawn **four subagents in parallel** (one message, four
`Agent`/general-purpose calls so they run concurrently), one per lens, each using that lens's prompt
template with the target doc paths filled in. Key requirements:

- **Independence.** Each reviewer sees only its own lens mandate — do not have one agent cover
  multiple lenses, and do not summarize other lenses to it. Divergent, adversarial verdicts are the
  point.
- **Grounded, not vibes.** Each prompt directs the reviewer to read the actual repo files the doc
  touches (`lib/types.ts`, `lib/storage.ts`, `lib/export.ts`, `lib/schema.ts`, the relevant `app/`
  screens) and to flag anything that misnames a real symbol, won't compile, or breaks migration —
  not just react to the prose.
- **Fixed output shape.** Each returns a markdown section with, per doc: `Verdict:` (approve /
  approve-with-changes / reject), `Must-fix:` (concrete bullets citing real doc text or symbols, or
  "none"), and optional `Notes:`. The template enforces this so results collate cleanly.

Background subagents notify on completion. If a reviewer signals idle without delivering its section,
re-request it (its content, exact format) before proceeding — never synthesize a lens's verdict.

### 3. Collate and apply must-fixes

Once all four are in, consolidate the must-fixes per doc (when multiple lenses flag the same issue,
that raises its priority and confidence). Then **edit each doc** to apply every must-fix, annotating
the change with which lens required it (e.g. "(panel — TS + scope lenses)") so the rationale
survives. Where lenses disagree, resolve explicitly in the doc and say why. Treat a `reject` as
blocking: rework the doc and re-run at least that lens.

### 4. Record the `## Panel review` section

Append (or replace) a `## Panel review` section at the end of each doc, in the house format:

```markdown
## Panel review

Run through the 4-lens panel (YYYY-MM-DD): <one-line roll-up of verdicts>. Must-fixes applied above.

- **Clinical — <verdict>.** <what it approved / the must-fix applied, past tense>.
- **Strict-TypeScript architect — <verdict>.** <…>.
- **Mobile UX / friction — <verdict>.** <…>.
- **Data-model / migration + privacy + scope — <verdict>.** <…>.
```

Each bullet states the verdict and, for approve-with-changes, the must-fix that was applied (past
tense — the fix is already in the doc above). This mirrors docs 06–20.

### 5. Bookkeeping and gates

- If new docs were added, extend the `docs/pending/README.md` index table and the shared number line
  (per the `docs-pending-tracks` memory — new docs continue the numbering, they don't restart it).
- **Run `prettier --write` on every touched markdown file before committing** — husky's lint-staged
  `prettier --check` blocks the commit otherwise (this is a known repeat gotcha in this repo).
- Commit the docs; the panel review is part of the doc's landing, not a separate deliverable.

## Scaling the panel

Four lenses is the default and matches the repo's established convention. The number of _docs_ per
run is flexible — each reviewer can assess several docs in one pass (returning one section per doc).
For a large batch, still keep it to the four lenses; do not add reviewers per doc. If a design
exercise raises a genuinely new concern none of the four cover (rare), add a fifth lens deliberately
and note it in the doc's panel section — but the four above are the standing set.
