# Titration Log Examples — Internet-Sourced Reference Collection

> **Purpose.** 100 real, internet-sourced examples of how people (and clinicians) record
> medication **titration** — adjusting a dose in steps over time. This is research input
> for `adhd-log`'s schema and export design: it shows what a "titration log" actually
> looks like in the wild, across medication classes, so the app's trend/export surfaces
> model real usage rather than a guess.
>
> **What counts as an example.** A record of _dose change over time_ — dates or weeks, the
> dose at each step, and (ideally) notes on effects/side effects. Sources range from
> patient-authored logs (forums, blogs, reader reviews, case reports) to canonical clinical
> titration schedules (FDA labels, NICE/NHS, SmPCs, pharmacy references).
>
> **Not medical advice.** Collected verbatim/paraphrased from public sources for design
> reference only. Doses and schedules are as reported by their sources and are not endorsed.

## How this was gathered

Assembled from parallel web research across eight medication classes (July 2026). 111
candidate examples were found; the 100 below are the strongest, after dropping title-only
snippets, same-thread near-duplicates, and entries that were dose _ranges_ rather than
dose-over-time logs. Every entry cites a real, live URL. Provenance caveats from the search
pass: Reddit, HealthUnlocked, and Drugs.com block automated fetching, so some patient-forum
entries were captured via search-engine page extraction rather than direct fetch — content
is genuine but per-reviewer wording may be paraphrased. Case reports, FDA-label PDFs, and
personal blogs were read directly.

## Count by class

| #   | Class                                                                             | Examples |
| --- | --------------------------------------------------------------------------------- | -------- |
| 1   | ADHD stimulants (methylphenidate, amphetamine, lisdexamfetamine)                  | 1–12     |
| 2   | ADHD non-stimulants (atomoxetine, guanfacine, clonidine, viloxazine, bupropion)   | 13–25    |
| 3   | Psychiatric (SSRIs, SNRIs, lamotrigine, bupropion, mirtazapine, antipsychotics)   | 26–37    |
| 4   | Thyroid (levothyroxine, liothyronine, NDT, methimazole, carbimazole)              | 38–48    |
| 5   | Diabetes & GLP-1 (insulin, semaglutide, tirzepatide, dulaglutide, liraglutide)    | 49–61    |
| 6   | Neuro / pain / migraine (gabapentin, pregabalin, topiramate, amitriptyline, etc.) | 62–73    |
| 7   | Cardiovascular / hormone / steroid (antihypertensives, TRT, prednisone tapers)    | 74–84    |
| 8   | Canonical clinical schedules (FDA labels, NICE/NHS, manufacturer PIs)             | 85–100   |

## Design takeaways for `adhd-log`

Patterns that recur across all 100 examples, most relevant to the app's schema/trend/export:

- **Dose is a sequence of dated steps, not a single value.** Nearly every log is
  "dose → dose → dose" with a date or week at each transition. The unit of data is a _dose
  change event_, and the useful view is the timeline of them.
- **Effect onset lags dose changes by weeks.** Non-stimulants, SSRIs, lamotrigine, and
  thyroid meds repeatedly show "took 6–8 weeks to feel it" — validating this app's core
  thesis that the signal is the _trend_, not a single day.
- **Side effects spike right after each step, then settle.** "Nausea returns on the
  step-up, eases in 1–2 weeks" (GLP-1s), "dizziness at each increase" (oxcarbazepine),
  "anxiety for the first days" (stimulants). A trend surface should align side-effect notes
  to dose-change events.
- **Down-titrations and holds are as common as increases.** Many logs end with a _reduction_
  because a dose was too high. The model must represent decreases and plateaus, not just an
  escalation ladder.
- **External anchors matter.** Thyroid/diabetes/TRT logs pin doses to lab values (TSH, FPG,
  Total T); psychiatric/ADHD logs pin to subjective ratings and functional notes. Free-text
  notes per entry are essential.
- **A titration is judged over its whole arc.** People narrate the journey ("Wk1… Wk3…
  sweet spot at… backed off to…"), which is exactly what a provider-facing PDF export
  should reproduce.

---

## 1. ADHD stimulants

**1. Methylphenidate (Xaggitin) + Vyvanse — adult self-titration diary, personal Substack**

- Source: https://alexdavidwright.substack.com/p/daily-notes-23-june-2023-medicine
- Log: Xaggitin (MPH) 18mg → 32mg → 64mg ("sweet spot") → 72mg, then switched to Vyvanse 30mg (3 days in at time of writing). Narrative titration, no calendar dates.
- Tracks effects: yes — 18mg "loosening of the muscles"; 64mg big deficit reduction but mild chest tightness; 72mg better focus but anxiety returned ("tight chest, tight mind"); Vyvanse "my chest is open."

**2. Methylphenidate (Ritalin/Concerta) — adult high-dose case report, PMC**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC3407707/
- Log: childhood 10mg → 20mg Ritalin SR; adult Ritalin 60mg (age 22) → 200mg/day → 240mg → 270mg → final 378mg extended-release Concerta.
- Tracks effects: yes — symptoms "improved dramatically" at 378mg; GAF 43→68; plasma levels stayed in reference range; 24-month follow-up stable.

**3. Concerta — adult, ADDitude reader review (Connzy113)**

- Source: https://www.additudemag.com/reviews/medication/concerta/
- Log: 5–15mg Ritalin as teen → Concerta 18mg → 36mg → 54mg (ages 14–16); resumed at 27: "started off at 18mg then 36mg and now on 54mg."
- Tracks effects: yes — describes effectiveness across the escalation.

**4. Vyvanse — adult, ADDitude reader review (30→60 titration)**

- Source: https://www.additudemag.com/reviews/medication/vyvanse/
- Log: started 30mg, titrated up 10mg monthly to 60mg weekdays / 50mg weekends; tried 70mg.
- Tracks effects: yes — "very anxious on the first 2 days," "after about a week i settled in"; 70mg "made me massively drowsy."

**5. Vyvanse — adult, ADDitude reader review (10→20→30 titration)**

- Source: https://www.additudemag.com/reviews/medication/vyvanse/
- Log: "started at 10mg, 20mg then 30mg."
- Tracks effects: yes — at 30mg: insomnia, upper stomach pain, chronic constipation; after a 2-week break effects didn't return strongly.

**6. Adderall XR — adult, ADDitude reader review (hi_im_roman)**

- Source: https://www.additudemag.com/reviews/medication/adderall-xr/
- Log: "I was given a 10mg dose which was increased to 20, 25, and finally to 30."
- Tracks effects: yes — improved grades, reduced appetite, minimal headaches that subsided over time.

**7. Adderall XR — adult, ADDitude reader review (5wheel)**

- Source: https://www.additudemag.com/reviews/medication/adderall-xr/
- Log: 10mg (ineffective) → 20mg (still ineffective) → 30mg.
- Tracks effects: yes — 30mg finally produced desired focus, only side effect a possible sinus headache.

**8. Vyvanse (lisdexamfetamine) — adult, WebMD review (Leigh)**

- Source: https://reviews.webmd.com/drugs/drugreview-lisdexamfetamine-vyvanse
- Log: "I started at 30mg and went up to 50mg since this is the normal progression, but found that dose too high (I was a bit jittery). So now I'm back at 30mg."
- Tracks effects: yes — 50mg caused jitteriness, prompting reduction back to 30mg.

**9. Concerta — adult, personal weekly blog ("2023 – Week 48")**

- Source: https://www.goodreads.com/author_blog_posts/24304597-2023---week-48?tab=book
- Log: switched from Vyvanse to Concerta, started at the lowest dose (Wednesday of Week 48); weekly-diary format documenting the first week on the starting dose.
- Tracks effects: yes — "milder" than Vyvanse, mood "level rather than euphoria," "bursts of energy and focus... like a sine wave," starting to eat more normally.

**10. Vyvanse — adult self-titration, HealthUnlocked (CHADD Adult ADHD forum)**

- Source: https://healthunlocked.com/adult-adhd/posts/150150417/vyvanse-titration-and-career-thoughts-tangent
- Log: 30mg for 2–3 weeks → 40mg (2×20mg), best results → landed at 50mg as stable dose.
- Tracks effects: yes — 40mg "great energy and motivation," colleagues noticed improved demeanor; settled at 50mg.

**11. Vyvanse — adult, HealthUnlocked (CHADD Adult ADHD forum)**

- Source: https://healthunlocked.com/adult-adhd/posts/148883365/3-weeks-on-vyvanse-and-still-worse-mood-than-before-taking-it-is-there-still-a-possibility-of-improving
- Log: first 2 weeks on 30mg, then 1 week on 50mg (3 weeks total).
- Tracks effects: yes — helped focus but reports mood worse than before starting; asking whether it will improve.

**12. Concerta — Drugs.com user reviews (methylphenidate)**

- Source: https://www.drugs.com/comments/methylphenidate/concerta-for-attention-deficit-disorder.html
- Log: multiple reviewers document 18mg → 36mg progressions; e.g. "on Concerta 2 weeks and just gone up to 36mg"; a 15yo 18mg (losing ~5 lb/week) → 36mg.
- Tracks effects: yes — focus improvement at 36mg for some; appetite/weight loss; "felt worse" at 36mg for the teen.

## 2. ADHD non-stimulants

**13. Atomoxetine — adolescent ADHD + comorbid cerebral palsy, case report (BJPsych Open)**

- Source: https://www.cambridge.org/core/journals/bjpsych-open/article/atomoxetine-as-an-alternative-therapy-for-adolescent-adhd-with-comorbid-cerebral-palsy-a-case-report/6C58FE31DE6663B92A78696F6373C2D4
- Log: started 20 mg/day (deliberately low) for one month → 30 mg/day. Discontinued after 5 months total.
- Tracks effects: yes — no meaningful attention improvement; escalating anxiety developed before discontinuation.

**14. Clonidine — 7-year-old with ASD + ADHD + Tourette's, case 1 of 3 (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11037466/
- Log: clonidine 0.025 mg/day + atomoxetine 25 mg → up to clonidine 0.1 mg/day (2 divided doses) + atomoxetine 40 mg/day.
- Tracks effects: yes — at 2 months: Yale Global Tic Severity motor −32%, vocal −50%; only mild sedation.

**15. Clonidine — 15-year-old with ADHD + intellectual disability + ASD, case 2 (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11037466/
- Log: clonidine 0.05 mg/day (haloperidol tapered off concurrently) → 0.3 mg/day at the 6-week mark.
- Tracks effects: yes — CPRS scores down ~40–45% at 2 months; sleep improved; mild sedation tolerated.

**16. Clonidine — 14-year-old with ASD + ADHD + intellectual disability, case 3 (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11037466/
- Log: clonidine 0.1 mg/day → 0.4 mg/day.
- Tracks effects: yes — CPRS-Combined −64% (50→18); chosen because prior treatments caused weight gain.

**17. Guanfacine (+ methylphenidate/atomoxetine) — 15-year-old, multi-year day-by-day case report (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC10646415/
- Log: Day 96 MPH 18 mg/day (headache, HTN, tachycardia) → Day 187 atomoxetine 50 mg/day (BP ~140/100) → Day 292 guanfacine 3 mg/day → Day 1076 added MP 18 mg → Day 1139 seizure, lamotrigine added → Day 1503 stable on MP 18 mg + guanfacine 4 mg + lamotrigine 250 mg.
- Tracks effects: yes — effects/side effects logged at every step; all assessment scales normalized.

**18. Guanfacine — 15-year-old with treatment-resistant tic disorder, case report (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC9480197/
- Log: guanfacine titrated up to 5 mg/day while pimozide reduced from 4 mg to 1 mg.
- Tracks effects: yes — reduced tic frequency/intensity, calmer, "hardly any side effects."

**19. Bupropion SR — open-label trial, adults with ADHD + substance use disorder (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC3322541/
- Log: start 100 mg SR each morning → +100 mg SR weekly (twice-daily) → 200 mg SR twice daily by week 4; assessed at 6 weeks.
- Tracks effects: yes — ~43% reduction in ADHD Rating Scale; side effects appetite loss, insomnia, GI, irritability; 4 withdrew.

**20. Atomoxetine — adult titration strategies, critical-appraisal review (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC4694693/
- Log: "fast" 40 mg/day ×3 days → 80 mg/day vs "slow" 40 mg/day ×7 days → 80 mg/day; some trials 60 → 120 mg/day.
- Tracks effects: yes — median time to 25% improvement 3.7 weeks; remission median 14.3 weeks; response improves out to 52 weeks.

**21. Clonidine ER — Korean cohort of children/adolescents with ADHD ± Tourette's, retrospective (PMC)**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5795037/
- Log: mean dose 0.13 ± 0.05 mg/day over 12 weeks; CGI at baseline, 4 weeks, 12 weeks.
- Tracks effects: yes — ADHD and tic symptoms improved (p<0.001); somnolence 31%, dizziness 17%; one hypotension episode during 0.2→0.3 titration.

**22. Atomoxetine (Strattera) — aggregated patient reviews (Drugs.com, 554 reviews)**

- Source: https://www.drugs.com/comments/atomoxetine/strattera.html
- Log: slow self/provider titration — ~1 month at 20 mg then 40 mg then up; one held 10 mg for 6–8 weeks before +10 mg increments; another settled at 60 mg.
- Tracks effects: yes — full effect ~6–8 weeks; early nausea, stomach pain, sweating, lightheadedness.

**23. Viloxazine (Qelbree) — aggregated patient reviews (Drugs.com)**

- Source: https://www.drugs.com/comments/viloxazine/?page=2
- Log: one adult 50 mg → up to 600 mg/day (no benefit, worsened depression); a 12-year-old reached 400 mg with straight-A results. Standard adult pattern: 200 mg start, +200 mg weekly to max 600 mg.
- Tracks effects: yes — harms range from decreased appetite to manic/suicidal episodes in one reviewer.

**24. Clonidine — patient reviews for ADHD (Drugs.com)**

- Source: https://www.drugs.com/comments/clonidine/for-attention-deficit-disorder.html
- Log: 0.1 mg at bedtime for a week → 0.1 mg twice daily for a week → 0.1 mg AM + 0.2 mg night for a week → 0.2 mg twice daily ongoing.
- Tracks effects: yes — main side effect tiredness, which resolved.

**25. Atomoxetine (Strattera) — patient thread "What dose worked for you?" (HealthUnlocked, CHADD Adult ADHD)**

- Source: https://healthunlocked.com/adult-adhd/posts/149004770/what-strattera-dose-worked-for-you-and-what-changes-did-you-notice
- Log: respondents titrate over weeks and need ~6–8 weeks to feel their best, several settling around 60 mg.
- Tracks effects: yes — one fell asleep constantly for the first 2–4 weeks, then normalized after ~4 weeks.

## 3. Psychiatric (antidepressants, mood stabilizers, antipsychotics)

**26. Duloxetine (Cymbalta) — 30mg → 60mg → back to 30mg**

- Source: https://www.mentalhealthforum.net/forum/threads/duloxetine-aka-cymbalta-experiences.38654/
- Log: 30mg for 1 week ("dense brain fog each morning") → 60mg ("intense head rushes... anxiety ramping up for hours") → back to 30mg (anxiety eased over ~24h).
- Tracks effects: yes

**27. Sertraline (Zoloft) — 50 → 100 → 150mg journeys (multi-poster thread)**

- Source: https://community.patient.info/t/increase-in-sertraline-from-50mg-to-100mg/764164
- Log (OP): 50mg for 1 year → 100mg for 4 weeks ("70% better," then plateaued). (Richard): sertraline 100mg → "6 weeks to start feeling a lift, another 6 weeks to where I thought yes I can feel this working" → 100mg for 3 years → 150mg for 2 weeks.
- Tracks effects: yes

**28. Sertraline (Zoloft) — 100 → 125 → 150mg step-up with worsening anxiety**

- Source: https://community.patient.info/t/increased-dose-to-150mg-and-feel-worse/703564
- Log: 100mg for a month+ ("slow improvements") → 125mg ("heightened anxiety, moody, drowsy") → 150mg (by day 7 more low/anxious, "crippling" by day 9–10). Others: "took 6 weeks for side effects to go."
- Tracks effects: yes

**29. Venlafaxine (Effexor) — 75mg → 112.5mg after switching from mirtazapine**

- Source: https://community.patient.info/t/5-weeks-on-venlafaxine-after-switching/
- Log: 75mg for ~5–6 weeks after a 10-day washout off mirtazapine → 112.5mg, 6 days in ("nausea is awful," "mornings are hell... by evening I feel ok").
- Tracks effects: yes

**30. Venlafaxine (Effexor) — 225 → 300mg, exhaustion and dissociation**

- Source: https://community.patient.info/t/increased-dose-to-300mgs/679387
- Log: 225mg for ~10 weeks ("slight improvement but not enough to function") → 300mg (exhaustion, dissociation, muscle tension, irritability).
- Tracks effects: yes

**31. Fluoxetine (Prozac) — day-by-day log of 20mg → 40mg increase**

- Source: https://community.patient.info/t/fluoxetine-increase-from-20mg-to-40mg-day-by-day-update/804133
- Log: on 20mg for 10 months → 40mg. Day 1 calm; Day 2 rumination; Day 12 "side effects kicked in — nausea, tiredness, headache"; Day 25 "side effects lasted one week and gone... feeling like it's working"; ~Week 5 "morning anxiety gone, mood getting better."
- Tracks effects: yes

**32. Mirtazapine — 15mg for 2 weeks then up to 30mg**

- Source: https://www.nomorepanic.co.uk/showthread.php?123747-Mirtazapine-increase-from-15mg-to-30mg
- Log: 15mg for 2 weeks (sleep improved, vivid dreams, sleepy) → 30mg (sedation eased). Posters: "6–8 weeks before a noticeable change in mood."
- Tracks effects: yes — dry mouth (resolved), dry eyes (persistent), weight-gain risk.

**33. Lamotrigine (Lamictal) — bipolar, "up to 150mg felt like Tic Tacs"**

- Source: https://www.mentalhealthforum.net/forum/threads/my-experience-with-lamotrigine.520116/
- Log: "up to 150mg per day I may as well have been taking Tic Tacs"; above 150mg increased apathy/anhedonia. Another: initial itching (resolved with Benadryl); "with each dose increase I'd get a depression lift for about a week."
- Tracks effects: yes

**34. Lamotrigine (Lamictal) — slow titration, 6-week update at 75 → 100mg**

- Source: https://community.patient.info/t/been-given-lamotrigine-so-scared-of-taking-it/479884
- Log: prescribed 56× 25mg tablets, "starting low and slowly increase." 6-week update: "up to 75mg, due to increase to 100mg tonight," only side effect occasional itchy skin.
- Tracks effects: yes

**35. Escitalopram (Lexapro) — thread of several titration schedules**

- Source: https://community.patient.info/t/escitalopram-how-long-positive-experiences-please/635542
- Log: OP — 10mg wk1 → 20mg wks 2–3 ("increased anxiety and fatigue" at 3 weeks). Sensitive poster: "5mg then 7.5 then at 12 days up to 10mg," improvement by day 16. Another: "2.5 for 1 week then 5.0 for 2 weeks and 7.5 for about 2 weeks." Consensus: "4–6 weeks to kick in."
- Tracks effects: yes

**36. Aripiprazole (Abilify) — akathisia across 5mg / 10mg / 30mg**

- Source: https://www.mentalhealthforum.net/forum/threads/abilify-induced-akathisia.681770/
- Log: OP on 5mg with severe akathisia. One poster on 10mg ~1 year: akathisia "only lasted a couple of weeks." Another started 30mg, reduced to depot ≈20mg oral.
- Tracks effects: yes

**37. Bupropion (Wellbutrin) — 150mg → 300mg XL, persistent insomnia**

- Source: https://www.mentalhealthforum.net/forum/threads/wellbutrin-bupropion-150-mg-every-other-day.369234/
- Log: 150mg → 300mg XL daily (insomnia "unable to work through after a month or longer") → back to 150mg XL daily → 150mg XL every-other-day (citing long half-life), which "lessened it quite a bit."
- Tracks effects: yes

## 4. Thyroid

**38. Methimazole (Tapazole) — Graves', dose lowered after going hypothyroid**

- Source: https://www.drugs.com/comments/methimazole/for-hyperthyroidism.html
- Log: started 20 mg/day. After ~9 months, T4 normal but TSH rose to almost 16 (overshot hypothyroid) → lowered to 10 mg.
- Tracks effects: yes

**39. Methimazole — Graves', conflicting doctor doses, settled low**

- Source: https://www.drugs.com/comments/methimazole/for-hyperthyroidism.html
- Log: given three recommendations (30 / 5 / 10 mg/day); stayed on 5 mg. Within 10 days Free T4 within range.
- Tracks effects: yes

**40. Methimazole — Graves' patient on methimazole + propranolol**

- Source: https://www.drugs.com/comments/methimazole/for-hyperthyroidism.html
- Log: 15 mg/day + propranolol; normal T4/T3 by the third blood test → reduced to 10 mg/day.
- Tracks effects: yes

**41. Methimazole — Graves', repeated up/down titration**

- Source: https://www.drugs.com/comments/methimazole/for-hyperthyroidism.html
- Log: started 20 mg/day; reduced to 5 mg/day multiple times but had to increase again (couldn't stay stable at low dose).
- Tracks effects: yes

**42. Liothyronine (T3) added to levothyroxine (T4) — HealthUnlocked Thyroid UK**

- Source: https://healthunlocked.com/thyroiduk/posts/144387034/my-experience-so-far-of-adding-liothyronine-t3-to-levothyroxine-t4
- Log: on levo alone had palpitations. Added liothyronine 5 mcg (improved mood/clarity/energy within hours) → increased T3 up to 25 mcg.
- Tracks effects: yes

**43. Levothyroxine → liothyronine (T4 to T3) switch — HealthUnlocked Thyroid UK**

- Source: https://healthunlocked.com/thyroiduk/posts/130772174/changed-from-levothyroxine-to-liothyronine.-t4-to-t3.
- Log: feels much better on 10 mcg liothyronine + 75 mcg levothyroxine than on prior 125 mcg levo alone. Thread notes starting T3 low, splitting into 3–4 daily doses, 2–3 week hormone rise.
- Tracks effects: yes

**44. NDT / Armour Thyroid — Inspire ThyCA community, week-one update**

- Source: https://www.inspire.com/groups/thyca-thyroid-cancer-survivors-association/discussion/week-one-on-armour-update/
- Log: started 2 grains Armour split 2×/day (FT4 was 1.1); felt sluggish/"placebo-like" on split dosing, more alertness taking both at once.
- Tracks effects: yes

**45. Levothyroxine titration (newly diagnosed) — HealthUnlocked Thyroid UK**

- Source: https://healthunlocked.com/thyroiduk/posts/144117071/thyroid-hormones-worse-after-9-weeks-on-levo
- Log: high TSH / low FT4, started levo; labs "worse" at 9 weeks. Guidance: increase levothyroxine by 25 mcg every 6 weeks, retesting, until optimized.
- Tracks effects: yes

**46. Levothyroxine long-term titration — Mayo Clinic Connect**

- Source: https://connect.mayoclinic.org/discussion/i-have-been-on-levothyroxine-for-about-17-years-and-in-the/
- Log: 17 years on levothyroxine; TSH drifted below normal on same/lower T4 dose. Responder targets TSH ~1.8–2.3 where they feel best.
- Tracks effects: partial (labs-focused, some symptom notes)

**47. Carbimazole — Graves', dose-sensitivity and adjustments — HealthUnlocked Thyroid UK**

- Source: https://healthunlocked.com/thyroiduk/posts/145615223/graves-carbimazole-dosage
- Log: started carbimazole 20 mg; significant fluctuations requiring dosage adjustments (20 mg moderate; some start 40–60 mg, titrated down as T3/T4 normalize).
- Tracks effects: yes

**48. Carbimazole — block-and-replace vs titration — HealthUnlocked Thyroid UK**

- Source: https://healthunlocked.com/thyroiduk/posts/135474959/block-and-replace-vs.-titration
- Log: titration = start a dose that makes you euthyroid then step down; block-and-replace = carbimazole 40–60 mg fully suppressing thyroid + levothyroxine ~100 µg. Median time to euthyroid ~45 days (B&R) vs ~65 days (titration).
- Tracks effects: yes (side-effect/blood-test burden discussed)

## 5. Diabetes & GLP-1

**49. Ozempic (semaglutide) — week-by-week T2D dose-escalation with side-effect notes**

- Source: https://pillo.care/blog/ozempic-dosing-schedule-week-by-week
- Log: Wks 1–4: 0.25 mg/wk (possible nausea first 48h, 0–3 lb loss). Wks 5–8: 0.5 mg/wk (nausea may return, settles in 1–2 wks). Wk 9+: 1 mg/wk maintenance. Optional max 2 mg/wk.
- Tracks effects: yes

**50. Mounjaro (tirzepatide) — full T2D titration 2.5 → 15 mg with HbA1c/weight/nausea data**

- Source: https://www.glp1clinics.org/mounjaro/dosing
- Log: Wk 1–4: 2.5 mg; Wk 5–8: 5 mg; Wk 9–12: 7.5 mg; Wk 13–16: 10 mg; Wk 17–20: 12.5 mg; Wk 21+: 15 mg. +2.5 mg every ≥4 wks. Nausea up to 22%, peaks after each increase (settles by wk 3).
- Tracks effects: yes

**51. Ozempic — 8-week weight-loss roadmap with per-fortnight dose, weight %, side-effect stage**

- Source: https://www.bodyspec.com/blog/post/8week_ozempic_weightloss_roadmap
- Log: Wk 0–2: 0.25 mg, ~1% BW, nausea/early fullness. Wk 3–4: 0.25 mg, GI peaks. Wk 5–6: 0.5 mg, GI improves. Wk 7–8: 0.5 mg, some early plateau. Total ~3–5% BW over 8 wks.
- Tracks effects: yes

**52. Wegovy (semaglutide) — obesity dose-escalation schedule (label/Drugs.com)**

- Source: https://www.drugs.com/dosage/wegovy.html
- Log: Wk 1–4: 0.25 mg/wk; Wk 5–8: 0.5 mg; Wk 9–12: 1 mg; Wk 13–16: 1.7 mg; Wk 17+: 2.4 mg maintenance. If tolerated ≥4 wks, may increase to 7.2 mg/wk.
- Tracks effects: yes — stepwise escalation specifically to reduce GI reactions.

**53. Liraglutide (Saxenda / Victoza) — daily titration with weekly notes**

- Source: https://trimrx.com/blog/liraglutide-dosing-guide/
- Log (Saxenda): Wk 1: 0.6 mg/day; Wk 2–3: 1.2 → 1.8 mg (+0.6/wk, side effects peak); Wk 4: 2.4 mg; Wk 5+: 3.0 mg maintenance. Victoza: 0.6 → 1.2 → optional 1.8 mg.
- Tracks effects: yes

**54. Trulicity (dulaglutide) — weekly titration 0.75 → 4.5 mg with A1c/nausea per dose**

- Source: https://pandameds.com/blog/trulicity-dosing-schedule/
- Log: Wk 1–4: 0.75 mg/wk (0.7% A1c); Wk 5–8: 1.5 mg (1.3%); Wk 9–12: 3.0 mg (1.6%, nausea 15.6% wks 0–2); Wk 13+: 4.5 mg (1.9%). +1.5 mg steps, ≥4 wks each.
- Tracks effects: yes

**55. Basal + bolus insulin — self-titration adjustment algorithm (T1/T2D)**

- Source: https://diabeteseducatorscalgary.ca/medications/insulin/insulin-adjustments.html
- Log: Basal — raise 1 U/day until in target, or 2 U / 10% every 1–2 days; add bolus once basal >0.5 U/kg. Bolus — meal dose +10–20% steps; ICR from 500/TDD; ISF from 100/TDD. Pattern rules: ≥3 lows/wk → cut the responsible insulin.
- Tracks effects: yes (blood glucose patterns / hypo-hyper)

**56. Basal insulin — named treat-to-target titration algorithms with unit/FPG steps**

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC6528396/
- Log: INSIGHT (Gla-300): +1 U/day while FPG >100. Treat-to-Target/ATLANTUS (weekly): +8/+6/+4/+2 U by FPG band. PREDICTIVE 303 (detemir, every 3 days): −3/hold/+3 U. ADA: start 10 U/day or 0.1–0.2 U/kg.
- Tracks effects: yes (fasting glucose driven)

**57. Zepbound (tirzepatide) — obesity titration 2.5 → 15 mg with side-effect incidence**

- Source: https://www.drugs.com/tirzepatide.html
- Log: Wk 1–4: 2.5 mg/wk; Wk 5–8: 5 mg; Wk 9–12: 7.5 mg; then +2.5 mg every 4 wks to 10/12.5/15 mg max. Nausea 24–30%, diarrhea 18–24%.
- Tracks effects: yes

**58. Basal insulin — ADA primary-care titration incl. 2-0-2 algorithm**

- Source: https://diabetesjournals.org/clinical/article/37/4/368/32741/Practical-Guidance-on-Effective-Basal-Insulin
- Log: 2-0-2 algorithm — +2 U if FPG above target, hold if in range, −2 U if below; every 2–4 days. %-based: +10% for FPG 141–180, +20% for FPG >180.
- Tracks effects: yes (fasting glucose)

**59. Insulin glargine — head-to-head comparison of 3 titration algorithms (insulin-naïve T2D)**

- Source: https://pubmed.ncbi.nlm.nih.gov/23931125/
- Log: Algo 1 = +1 U daily if FPG > target; Algo 2 = +2 U every 3 days; Algo 3 (treat-to-target) = +2–8 U weekly by 2-day mean FPG. Similar control; simpler algos had lower hypoglycemia.
- Tracks effects: yes (fasting glucose, hypoglycemia)

**60. Mounjaro — real patient 10-month log, 2.5 → 15 mg, 455 → 340 lb (personal account)**

- Source: https://www.aol.com/news/felt-addicted-food-mounjaro-helped-090456055.html
- Log: started 2.5 mg, escalated in 2.5 mg steps over ~10 months to 15 mg; total loss 115 lb (455 → 340 lb). Nausea main side effect during titration.
- Tracks effects: yes (weight, nausea)

**61. Insulin initiation & titration — ADA Diabetes Spectrum practical review**

- Source: https://diabetesjournals.org/spectrum/article/32/2/104/32457/Insulin-Initiation-and-Titration-in-Patients-With
- Log: basal start 10 U/day or 0.1–0.2 U/kg; titrate to fasting target (fixed +2 U every 3 days, or FPG-tiered); intensify with prandial insulin (add one meal, +4 U or 10% of basal) as basal exceeds ~0.5 U/kg.
- Tracks effects: yes (fasting + postprandial glucose)

## 6. Neuro / pain / migraine

**62. Pregabalin (Lyrica) — diabetic/peripheral neuropathy, patient "Caz1204"**

- Source: https://www.diabetes.co.uk/forum/threads/pregabalin-gabapentin-side-effects-neuropathy.198581/
- Log: started 100mg, held 4 weeks → "20% improvement in the feet." Raised to 150mg → constant ache in arms/shoulders, reduced shoulder mobility → switched to gabapentin.
- Tracks effects: yes

**63. Nortriptyline — chronic pain / daily headache (patient comments)**

- Source: https://headacheandmigrainenews.com/nortriptyline-for-chronic-pain/
- Log: "started 25mg and over the years increased until I now take 50mg"; another 10mg → 20mg → 40mg; "10mg for one week and after to 20mg." Note: may take three months to judge.
- Tracks effects: yes — headaches gone within days; side effects weight gain, drowsiness, dry mouth.

**64. Nortriptyline — migraine/headache titration schedule (NHS patient handout)**

- Source: https://www.torbayandsouthdevon.nhs.uk/uploads/25737.pdf
- Log: start 10mg at night; after 7–14 nights → 20mg; then +10mg every 7–14 nights up to lowest effective dose (~75mg).
- Tracks effects: yes — dry mouth, drowsiness (usually eases), constipation.

**65. Topiramate (Topamax) — migraine prevention (Drugs.com reviews)**

- Source: https://www.drugs.com/comments/topiramate/for-migraine-prophylaxis.html
- Log: 25mg wk1, 50mg wk2, 75mg wk3, 100mg wk4. One reviewer's migraines "all but stopped" (1–2/week → 1–2/year).
- Tracks effects: yes — tingling fingers/toes, weight loss (one lost 35 lb); another had memory loss/confusion at higher doses.

**66. Amitriptyline — migraine prevention (Drugs.com reviews)**

- Source: https://www.drugs.com/comments/amitriptyline/for-migraine-prophylaxis.html
- Log: one took 10mg for 5 months, migraines returned → 20–25mg (dry mouth, disturbed sleep first few weeks, then settled). Another at 25mg had fogginess → dropped back to 10mg, kept relief without side effects.
- Tracks effects: yes

**67. Gabapentin — restless legs syndrome (HealthUnlocked, RLS-UK)**

- Source: https://healthunlocked.com/rlsuk/posts/151653361/gabapentin-dosage
- Log: start 300mg at night; allow ~3 weeks to be fully effective, then +100mg every couple of days to the dose that works; most reach 600–1200mg.
- Tracks effects: yes

**68. Pregabalin (Lyrica) — fibromyalgia (HealthUnlocked, Fibromyalgia Action UK)**

- Source: https://healthunlocked.com/fibromyalgia-action-uk/posts/139714968/lyrica-pregablin
- Log: started 75mg three times a day, escalated over ~10 years to ~350mg/day; another settled at 150mg morning and evening.
- Tracks effects: yes — weight gain, appetite increase, fluid retention, memory issues (often settle after 2–3 months).

**69. Topiramate — migraine (patient.info medicine page + patient reports)**

- Source: https://patient.info/medicine/topiramate-to-prevent-migraine-topamax
- Log: begin 25mg/day for 1–2 weeks, then step up weekly. Paresthesia very common (~49% in trials), most pronounced in initial weeks; mild effects usually ease within a few weeks.
- Tracks effects: yes

**70. Levetiracetam (Keppra) — epilepsy (Drugs.com reviews)**

- Source: https://www.drugs.com/comments/levetiracetam/keppra-for-epilepsy.html
- Log: typical start 500mg twice daily, +500mg every 2 weeks. Reviewers describe "Keppra rage" in the first ~4 weeks that calms after 4–6 weeks.
- Tracks effects: yes — mood swings, anger, weight gain early on; some fade after 2–3 months.

**71. Oxcarbazepine (Trileptal) — epilepsy (Drugs.com reviews)**

- Source: https://www.drugs.com/comments/oxcarbazepine/for-epilepsy.html
- Log: started 300mg twice daily; ~2 months ago → 600mg twice daily. About a week of dizziness both when first starting and again at each increase.
- Tracks effects: yes — off-balance, tongue numbness, memory issues long-term.

**72. Gabapentin — neuropathic pain (Drugs.com reviews + dosing)**

- Source: https://www.drugs.com/comments/gabapentin/
- Log: standard ramp — 300mg day 1, 300mg BID day 2, 300mg TID day 3, then titrate up. Dizziness/sedation week 1, improving by ~2 weeks; full benefit at 2–4 weeks.
- Tracks effects: yes — mixed efficacy (one at 600mg TID got no relief; others ~80% reduction in flares).

**73. Topiramate — migraine prevention (clinic blog with titration regimen)**

- Source: https://www.miamihpc.com/post/topiramate-in-migraine-prevention-are-the-side-effects-worth-it
- Log: start 25mg once daily, +25mg weekly until target; rarely exceed 100mg/day. Strategy: if side effects appear at a step, drop back temporarily then retry.
- Tracks effects: yes — early tingling, "Dopamax" cognitive fog at higher doses, weight loss.

## 7. Cardiovascular / hormone / steroid

**74. Amlodipine — 10mg → 5mg to resolve side effects ("Monika")**

- Source: https://community.patient.info/t/reduction-from-10mg-to-5mg-amlodipine/601740
- Log: on 10mg with water retention, ankle swelling, hip/knee aching. Reduced to 5mg (July 2017); by 3 weeks "can defo feel the difference."
- Tracks effects: yes

**75. Amlodipine — 10mg → 5mg while on Benicar 40mg + HCTZ 25mg ("Sean")**

- Source: https://community.patient.info/t/reduction-from-10mg-to-5mg-amlodipine/601740
- Log: reduced 10mg → 5mg; ankle swelling normal within 10 days–2 weeks, hip/knee pain stopped. Overall 40mg Benicar + 25mg HCTZ + 5mg amlodipine, BP controlled.
- Tracks effects: yes

**76. Amlodipine + metoprolol — 5mg → 10mg, second agent added ("Andrew")**

- Source: https://community.patient.info/t/bp-increasing-after-starting-amlodopine/591684
- Log: May 2017 started 5mg amlodipine (baseline ~145/91); by ~30 days readings escalated (151/90, 165/95, 160/135). Doctor doubled to 10mg and added metoprolol 25mg.
- Tracks effects: yes (serial BP readings)

**77. Bisoprolol 1.25mg + Losartan — persistent tachycardia at fixed low dose ("christine20029")**

- Source: https://community.patient.info/t/anyone-getting-palpitations-on-bisoprolol/
- Log: on 1.25mg bisoprolol since Feb 2017 (with losartan). Night HR 136–140 lying down; BP 167/82+. Still symptomatic 9+ months later.
- Tracks effects: yes (HR + BP + symptoms; dose held rather than titrated)

**78. Testosterone cypionate — 200mg/wk → 160mg/wk with Arimidex titration, serial labs**

- Source: https://www.excelmale.com/threads/a-little-help-with-dose-adjustment-based-on-labs-please.16949/
- Log: pre-TRT Total T 195. Wk 0: 200mg/wk split 2×. Wk 6: Total T 1106 (bloating, low libido). Wk 12: cut to 160mg/wk + Arimidex 0.5mg 2×. Wk ~14–15: 160mg/wk + Arimidex 0.25mg EOD → Total T 1137, E2 26; hematocrit ~48%→50%.
- Tracks effects: yes (labs + symptoms)

**79. Sustanon (testosterone) — 75mg/wk → proposed 100mg/wk, trough labs**

- Source: https://www.excelmale.com/threads/advice-on-blood-test-results.27905/
- Log: 0.15mL 2×/wk (~75mg/wk) + hCG 500 IU 2×/wk. Trough (~month 2): Total T 19.8 nmol/L, E2 136 pmol/L, suppressed LH/FSH. Proposed increase to ~100mg/wk; physician resisted.
- Tracks effects: yes (labs)

**80. Testosterone — low-dose daily protocol design from low baseline ("IndyColts18to88")**

- Source: https://www.excelmale.com/threads/advice-on-low-dose-daily-testosterone.22096/
- Log: baseline Total T 269, SHBG 23. Considering 10–12mg cyp daily subQ. Advised: start 50mg every 3.5 days, re-check labs at 6 weeks; alt start 15mg daily subQ targeting Total T 500–700, 4–6 wks between changes.
- Tracks effects: yes (labs, dose-response plan)

**81. Levothyroxine — 100mcg → 125mcg → back to 100mcg over years, by TSH ("nh_user_248")**

- Source: https://community.patient.info/t/adjusting-to-new-dose-of-levothyroxine/26617
- Log: stable on 100mcg for years. Aug 2009 TSH 31.0 → 125mcg; after 10 days felt more hypo. Oct 2009 (8 wks post) TSH 0.33, bordering hyperactive. By May 2013 settled back to 100mcg.
- Tracks effects: yes (TSH + symptoms)

**82. Prednisone — PMR, 16.5mg with failed drop to 15mg (steroid-withdrawal flare)**

- Source: https://community.patient.info/t/prednisone-taper/679039
- Log: 16.5mg ×3 weeks, fairly pain-free. Dropped to 15mg for 2 days → severe pain next morning → back to 16.5mg ("shoulder feels Much better!"). New plan: 16mg ×1 week, then 15.5mg.
- Tracks effects: yes

**83. Prednisolone — PMR/GCA, stuck at 5mg, flare on drop to 4.5mg ("Carol")**

- Source: https://community.patient.info/t/tapering-dose/527197
- Log: ~4 years on prednisolone, reducing by ½mg. Flared 5mg→4.5mg, held at 5mg. Feb 2017: held 5mg for 2 months then very slowly to 4.5mg → bad headaches around left eye (GCA) → had to go back up.
- Tracks effects: yes

**84. Prednisolone — DSNS ("Dead Slow Nearly Stop") 0.5mg-step taper**

- Source: https://community.patient.info/t/tapering-off-prednisolone-at-5mg/719643
- Log: "tapered off 5mg reducing by .5mg using DSNS, currently on 3mg tapering to 2.5mg." ~6-week taper cycle then hold ~1 month; ~1mg reduction every 20 weeks. Emphasis on 0.5mg-or-smaller drops with long holds.
- Tracks effects: partial (method/timeline; flare-avoidance rationale)

## 8. Canonical clinical titration schedules

**85. Lamotrigine — FDA LAMICTAL label, standard titration (no interacting drugs)**

- Source: https://www.accessdata.fda.gov/drugsatfda_docs/label/2014/020241Orig1s052,020764Orig1s045,022251Orig1s016Lbl.pdf
- Log: 25mg/day wk1–2, 50mg/day wk3–4, then +50mg/day every 1–2 wk to target 225–375mg/day (divided). With valproate: 25mg every other day wk1–2, 25mg/day wk3–4, then +25–50mg every 1–2 wk.
- Tracks effects: yes — titration slowed to reduce risk of serious rash (SJS).

**86. Atomoxetine (Strattera) — FDA-label ADHD titration**

- Source: https://www.drugs.com/dosage/strattera.html
- Log: adults/>70kg start 40mg/day, after ≥3 days → 80mg/day; after 2–4 more weeks may go to max 100mg/day. Weight-based: 0.5 mg/kg/day → target 1.2 mg/kg/day.
- Tracks effects: yes — titrate to max benefit with min adverse effects; follow-up 2–4 wk.

**87. Gabapentin (Neurontin) — FDA-label neuropathic pain 3-day titration**

- Source: https://www.drugs.com/dosage/gabapentin.html
- Log: Day 1: 300mg once; Day 2: 300mg BID (600mg); Day 3: 300mg TID (900mg); then titrate up to 1800mg/day as needed.
- Tracks effects: yes — gradual increase to minimize side effects.

**88. Metformin — FDA-label type 2 diabetes titration**

- Source: https://www.drugs.com/dosage/metformin.html
- Log: start 500mg once/twice daily with meals; +500mg/week (or +850mg every 2 wk) to target 1500–2000mg/day; max 2550mg (IR).
- Tracks effects: yes — slow titration with food to minimize GI effects.

**89. Pregabalin (Lyrica) — Pfizer prescribing information**

- Source: https://labeling.pfizer.com/showlabeling.aspx?id=561
- Log: start 75mg BID (150mg/day); may increase to 300mg/day within 1 week; if needed after 2–3 wk, up to 450mg then max 600mg/day.
- Tracks effects: yes — up-titration by efficacy/tolerability; taper over ≥1 wk on discontinuation.

**90. Guanfacine ER (Intuniv) — FDA label, ADHD**

- Source: https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/022037s018lbl.pdf
- Log: start 1mg/day, adjust by ≤1mg/week; target 0.05–0.12 mg/kg/day; max 4mg/day (6–12), 7mg/day (13–17).
- Tracks effects: yes — monitor for sedation/hypotension; increments capped at 1mg/wk.

**91. Venlafaxine ER (Effexor XR) — FDA-label depression/anxiety**

- Source: https://www.drugs.com/dosage/effexor-xr.html
- Log: start 37.5–75mg/day; +75mg steps at intervals ≥4 days (≈weekly) up to 225mg/day (outpatient max).
- Tracks effects: yes — dose increases spaced to allow adjustment.

**92. Clozapine — Teva prescribing information (treatment-resistant schizophrenia)**

- Source: https://www.tevaclozapine.com/globalassets/clozapine/clozapinepi.pdf
- Log: start 12.5mg once/twice on day 1; +25–50mg/day to 300–450mg/day by end of week 2; then +50–100mg no more than once/twice weekly.
- Tracks effects: yes — mandatory ANC monitoring; slow to limit sedation, seizures, orthostasis, myocarditis.

**93. Topiramate (Topamax) — FDA-label migraine prophylaxis**

- Source: https://www.drugs.com/dosage/topamax.html
- Log: wk1 25mg PM; wk2 25mg AM + 25mg PM; wk3 25mg AM + 50mg PM; wk4 50mg BID (100mg/day target); may go to max 200mg/day in 25mg weekly steps.
- Tracks effects: yes — gradual titration to reduce side effects.

**94. Levothyroxine — hypothyroidism dose titration (ATA guideline-based)**

- Source: https://www.drugs.com/dosage/levothyroxine.html
- Log: adjust in 12.5–25 mcg increments (12.5 mcg cap if age ≥65 or cardiac); recheck TSH 6–8 wk after each change; repeat until in range.
- Tracks effects: yes — titration driven by TSH monitoring.

**95. Prazosin — NHS Highland guideline, PTSD-related nightmares**

- Source: https://www.rightdecisions.scot.nhs.uk/tam-treatments-and-medicines-nhs-highland/adult-therapeutic-guidelines/mental-health/prazosin-for-ptsd-related-nightmares-guidelines/
- Log: 1mg at bedtime days 1–3; 2mg days 4–7; 4mg wk2; 6mg wk3; up to ~10–15mg by wk4+, titrate by 1–2mg every few days.
- Tracks effects: yes — always start 1mg to avoid first-dose hypotension; monitor BP with each increase.

**96. Buprenorphine/naloxone (Suboxone) — FDA label, induction**

- Source: https://www.accessdata.fda.gov/drugsatfda_docs/label/2021/022410s042lbl.pdf
- Log: Day 1 start 2/0.5 or 4/1 mg, +2–4mg buprenorphine at ~2h intervals up to 8/2 mg; Day 2 single dose up to 16/4 mg; maintenance target 16/4 mg/day.
- Tracks effects: yes — first dose only when moderate withdrawal appears (≥6h after last opioid).

**97. Carbamazepine (Tegretol) — epilepsy titration (StatPearls)**

- Source: https://www.ncbi.nlm.nih.gov/books/NBK482455/
- Log: start 200mg BID (400mg/day); +200mg/day weekly (TID–QID) to target 800–1200mg/day; max 1200mg/day (>15y).
- Tracks effects: yes — gradual titration limits dizziness/ataxia/diplopia; CBC/LFTs, HLA-B*15:02 screening.

**98. Sacubitril/valsartan (Entresto) — AAFP review, HFrEF**

- Source: https://www.aafp.org/afp/2016/1015/p611
- Log: start 49/51mg BID (or 24/26mg BID if ACEi/ARB-naive or hypotension risk); double dose every 2–4 wk to target 97/103mg BID.
- Tracks effects: yes — lower start / slower up-titration for hypotension risk.

**99. Quetiapine ER (Seroquel XR) — FDA-label bipolar**

- Source: https://www.drugs.com/dosage/quetiapine.html
- Log: bipolar mania — Day 1 300mg, Day 2 600mg, target 400–800mg/day. Bipolar depression — Day 1 50mg, Day 2 100mg, Day 3 200mg, Day 4 300mg (max).
- Tracks effects: partial — schedule fixed by day; monitor for sedation/orthostasis; slower in elderly/hepatic impairment.

**100. Bupropion XL (Wellbutrin XL) — FDA-label MDD titration**

- Source: https://www.drugs.com/dosage/wellbutrin-xl.html
- Log: 150mg once daily AM for 4 days, then → target 300mg once daily AM; max 450mg/day. (SAD: 150mg ×7 days then 300mg.)
- Tracks effects: yes — increase gradually specifically to minimize seizure risk.
