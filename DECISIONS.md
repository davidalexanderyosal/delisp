# Decisions

Choices the spec left open, and the reasoning. Newest last.

## Phase 1

**Monorepo scope.** `apps/api`, `packages/schema` and `content/` are not in the
tree yet. Phase 1 has no backend and one hard-coded exercise, so empty
placeholder packages would only add install and CI weight. They arrive with the
phases that need them.

**`bandRatio` is in decibels.** The spec says "energy 5–8 kHz ÷ energy 1–4 kHz
(log scale)". It is computed as `10·log10(E_high / E_low)`, clamped to ±40 dB, so
0 dB means the two bands carry equal energy and the sign reads naturally: a clear
/s/ is positive, a th-like one strongly negative.

**Centroid is measured over 300 Hz – 11 kHz, not the full spectrum.** Room rumble
and voicing fundamentals below 300 Hz would drag the centroid of a fricative
down, and mic self-noise above 11 kHz would push it up; neither carries
information about /s/ placement. Centroid and spread are magnitude-weighted, band
energies are power-weighted.

**`zcr` is normalised to crossings per sample (0–1),** computed after DC removal.
The absolute rate in Hz would be sample-rate dependent, and every threshold in
the app is a comparison rather than a physical quantity.

**Fricative gate threshold is `zcr ≥ 0.10`, not 0.15.** At 0.15 a frontal,
th-like attempt with its energy near 3 kHz falls *below* the gate, so it is
discarded as "no /s/ heard" instead of being scored badly — exactly backwards for
an app whose job is to catch that error. Vowels sit below 0.06, so 0.10 still
separates cleanly. This was caught by a unit test that expected a half-good
utterance to score near 50% and got 79%.

**The noise floor is the 95th percentile of the silent frames,** not the mean: a
fan should not be averaged away, and one cough should not set the floor for the
session. It is clamped to [0.0008, 0.05]; above the ceiling the app refuses the
calibration and asks for a quieter room rather than handing back a gate no /s/
can clear.

**`sDurationMs` is the longest *contiguous* run of fricative frames,** not the
total count. A false start followed by the real attempt should report the
attempt's length, not the sum of both.

**The target zone comes from the spec's reference constants, not from the user's
baseline.** Spec §3.3 step 3 makes the reference-clip step optional and says to
fall back to default constants, which is what Phase 1 does (no TTS assets are
bundled yet). This matters more than it looks: calibrating the target to the
user's own sustained /s/ would aim the drill at the lisp it is meant to correct.
The baseline is still recorded, as the thing progress is measured against.

**Trial pass threshold is 60% of fricative frames in zone** (`DRILL.passScore`),
with a minimum of 4 fricative frames for a trial to count as heard at all. The
spec fixes the level-0 advance criterion ("80% of trials in zone over the last
20") but not what makes one trial a hit; 60% tolerates the onset and offset of a
real /s/, which are never in zone.

**The AudioWorklet is bundled from TypeScript into `public/worklets/`, not
hand-written.** `vite.worklet.config.ts` builds `src/worklet/*.ts` into one
self-contained IIFE. Worklets cannot reliably use `import` on iOS Safari, and the
alternative — a hand-maintained copy of the FFT living in `public/` — would be
code that the unit tests do not cover. The generated file is gitignored and built
by `pnpm dev` / `pnpm build`.

**Frames are computed at ~47 Hz but posted in batches every 50 ms.** The spec asks
for ~20 posts/s. Dropping frames to hit that rate would corrupt `sDurationMs` and
the zone hit rate, both of which count frames, so every frame is kept and the
batch is what is throttled.

**The gauge reads the latest frame under `requestAnimationFrame` from a ref.**
Putting 20 updates/s through React state would re-render the drill screen 20×/s
for a needle that only needs to move at display rate.

**Hash routing.** No server rewrite rules, and the phone's back button works
inside an installed PWA.

**Hold-to-record, capped at 5 s.** One thumb, no aiming, and a pointer that gets
stuck cannot run the capture forever. Anything under 400 ms is discarded rather
than scored.

**Feedback fading (spec §3.8) is only partly implemented.** The
knowledge-of-performance → knowledge-of-results shift is in: the coaching line
drops away above 80% rolling accuracy. The rest of the schedule (gauge hidden
during recording, scores on every 2nd/3rd trial) belongs with the Phase 2 drill
engine, and `settings.feedback_rate` is already in the data model for it. The
gauge *is* hidden during the self-rating step, which is the spec's own
requirement that the user commits before the score is revealed.

**No `MediaRecorder` in Phase 1.** The spec runs it in parallel with the worklet,
but audio blobs only have a consumer once R2 and Whisper exist in Phase 3.
Nothing is stored that could not be replayed from the features.

**/z/ is not implemented.** It enters at level 2 (Phase 2); Phase 1 is level 0
only.

**Icons are generated, not drawn.** `apps/web/scripts/make-icons.mjs` renders the
app's own gauge to PNG through `node:zlib` — no image dependency, and the output
is committed so a normal build never runs it.

**Deploy is guarded on secrets.** The Cloudflare Pages job checks for
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in a step rather than a job-level
`if` (the `secrets` context is not available there), so a clone without
credentials gets a skipped deploy instead of a red build.

## Phase 2

**Content lives in YAML and is compiled into the bundle.** `content/exercises.yaml`
is the source of truth, per spec §6; `pnpm content:build` generates
`apps/web/src/content/exercises.generated.ts` from it, validating ids, levels,
positions and minimal pairs on the way through. The app ships the curriculum in
its bundle rather than fetching it: there is no backend in Phase 2, and the
service worker would have to precache it anyway. Phase 3 seeds D1 from the same
file.

**Levels 5–8 are content-complete but not playable.** Their scoring depends on
which word was actually heard, which needs the Whisper endpoint. The exercises
are written and the level definitions carry `scoring: 'asr'`, so Phase 3 turns
them on rather than building them.

**Warm-up trials are scored into no progression window.** The warm-up is
sustained /s/ from level 0 whatever level is being drilled, so counting it toward
the current level's advance criterion would promote on a different exercise. Made
explicit in `progressionTarget()` and unit-tested, because it is the kind of rule
that breaks silently.

**Advance requires a *full* rolling window.** 85% of six trials is not 85% over
the last forty. Without this, a short lucky streak promotes.

**Blocked practice for the first window's worth of trials at a level, random
after.** The spec says "first half"/"second half" of a level without defining the
boundary; a full rolling window is the point at which the level can first be
assessed, which is the most defensible reading available.

**A failed re-test drops back to the *shortest* interval, not the previous one.**
If a level lapsed, the schedule's assumption about how secure it was is wrong, so
it should come round again tomorrow rather than in a fortnight. Re-tests are 10
trials, matching the number the spec reinserts after a failure.

**Voicing is measured over the frication, not over everything audible.** The
first implementation counted every frame above the gate, which in a word like
"sun" is mostly vowel — so every word read as voiced. It now counts only frames
where the 5–8 kHz band leads the 1–4 kHz band, which isolates the fricative
without needing word boundaries.

**Voicing is detected from the voice bar (80–400 Hz), not from `zcr` or the 1–4
kHz band.** `zcr` follows the loudest component of the whole frame, so for a /z/
whose voicing outweighs its frication it collapses toward the fundamental and
reads as a vowel. The 1–4 kHz band sits above the fundamental and below the
frication, and is quiet for /s/ and /z/ alike. The check is a *margin*
(voice bar vs frication energy) rather than an absolute level, so it holds at any
recording volume.

**An /s/ prompt fails if it comes out voiced, not just if the placement is off.**
The spec only asks for a voicing check on /z/, but the check is symmetric and a
voiced /s/ is a different sound, so reporting placement feedback on it would be
misleading. A voicing error is reported whatever the fading schedule says, for
the same reason.

**The lateral threshold is a spectral spread of 1800 Hz.** The first value, 2200,
was set by eye and in practice never fired — a uniform 6 kHz-wide band has a
spread of only ~1790 Hz. Caught by a test that expected a broad, peakless
spectrum to classify as lateral and got `postalveolar`.

**The diagnostic abstains rather than guessing.** A clear /s/ has no lisp pattern
to report, and a /ʃ/-like centroid says the sound drifted backwards rather than
which pattern caused it — both return a null vote. With the minimal-pair test
still to come in Phase 3, two signals can tie, which reports `mixed`; that is the
spec's own tie-breaking rule.

**Feedback fading is now fully implemented** (spec §3.8): live gauge below 70%
accuracy, hidden during recording from 70%, scored every 2nd trial from 80% and
every 3rd from 85%, with a block summary in between and the knowledge-of-
performance coaching line dropping away at 80%. `settings.feedback_rate` is kept
in step for Phase 3 sync.

## Phase 3 (in progress)

**Access is verified in the Worker, not assumed.** Cloudflare Access terminates
authentication at the edge, but a Worker that simply trusts the
`Cf-Access-Jwt-Assertion` header trusts anything that can reach its route. The
Worker checks the RS256 signature against the team's published keys and — the
part that actually matters — that the `aud` claim names *this* application, so a
token minted for another app on the same team cannot be replayed here. Written
against WebCrypto rather than a JWT library: it is one signature check and a
handful of claims.

**An empty `ACCESS_AUD` disables verification.** The binding does not exist under
`wrangler dev` or in tests, and refusing to start would make the API
undevelopable. The README says plainly not to deploy it that way.

**`alg` is checked against an allow-list of one.** `alg: "none"` and symmetric
algorithms are the two classic JWT verification bypasses; RS256 is the only thing
Access issues, so anything else is rejected before a key is even fetched. Both
cases are unit-tested against tokens this test suite actually forges.

**`POST /api/trials` is idempotent.** The client computes features offline and
flushes on reconnect, so a partly-failed flush *will* be retried with the same
ids. Inserts use `ON CONFLICT DO NOTHING` and the session's `trial_count` is
recomputed from the rows rather than incremented, so a retry cannot inflate it.

**Test bindings are declared in `vitest.config.ts`, not read from
`wrangler.toml`.** The Workers AI binding is a proxy to a remote service and
cannot be instantiated in the isolated test runtime — loading the real config
makes workerd fail to start. Everything else runs against genuine D1 and R2.

**Migrations live in `packages/schema` and are pointed at from
`apps/api/wrangler.toml`.** One schema definition, one set of migrations, used by
both the Worker and the test runner.

**The seed is generated SQL, not a script that talks to D1.** `content/seed.mjs`
emits an upsert file from the same YAML the web app compiles from, so the
curriculum has exactly one source of truth and seeding is a reviewable artifact
rather than an opaque command.

**Audio streams through the Worker, not a presigned PUT.** Spec §9's first open
question. Presigning R2 from a Worker means implementing SigV4 by hand and
publishing a CORS policy on the bucket; the clips are seconds long and well
inside the Worker request limit, so the simpler path costs nothing that matters.

**A baseline is stored before it is transcribed.** A weekly free-speech baseline
cannot be recorded again — losing one to a Workers AI outage would be the worst
failure this app has. The upload succeeds and returns 201 with a null transcript
if transcription fails; the clip is safe in R2 either way.

**The transcript matcher consults the declared minimal pair first.** The
sibilant skeleton works on spelling, so it catches sink/think, pass/path and
mouse/mouth but not sue/shoe or seat/sheet, where the vowel is spelled
differently. Those are exactly the pairs the content already declares, so the
certain check runs before the inferred one. A CMUdict phoneme comparison is the
upgrade and belongs with the Phase 4 phoneme work.

**`carriesS` is separate from `hasSibilant`.** The skeleton deliberately
collapses θ and ʃ because those are the *error* forms — but that means a word
like "with" looks sibilant-bearing. Dropping "with" is a missed word, not a
lisp, so the "was an /s/ lost" test ignores the th/sh digraphs. Caught by a test
that expected a dropped "with" to read as a different word and got a
substitution.

**Word sequences are aligned before being compared.** A single dropped word would
otherwise shift every later comparison and report a whole sentence as substituted.
A sibilant-only difference is a zero-cost match during alignment, since that is
the error being looked for rather than evidence the words do not correspond.

**Whisper's response is parsed defensively.** The shape has changed across model
versions; anything unrecognisable becomes an empty transcript, which the matcher
reports as `nothing-heard` — a wrong answer the user can act on rather than a
crash. Spec §9's second open question — whether `@cf/openai/whisper` is accurate
enough on 2–3 second clips — cannot be answered until this runs against real
Workers AI, so the vocabulary-biased prompt is sent from the start.

**Retention runs on a cron, not inline.** Deleting a thousand expired objects
must never sit in front of a user's request. The R2 delete happens before the
row delete: an object with no row is invisible and would never be cleaned up,
whereas a row with no object is noticed the next time anything reads it.

**Per-test storage isolation is off in the API tests.** The pool's isolation
cannot unwind the R2 bucket's backing store in this environment; each suite
clears what it wrote instead.

**The sync worker pushes sessions before trials, and marks nothing synced until
the server acknowledges it.** Trials carry a foreign key to their session, so the
order is a correctness requirement rather than a preference; a trial whose session
failed to push is held back for the next flush instead of being rejected. Because
nothing is marked early, an interrupted flush retries — which is why the server's
`POST /api/trials` is idempotent.

**A failed trial batch stops the flush rather than continuing.** The remaining
batches are almost certainly going to fail the same way, and retrying them now
would multiply the noise without changing the outcome.

**Charts are hand-rolled SVG.** The spec's "no external UI kits, Tailwind only"
rules out a charting library, and the three views in §3.10 are a line, a
histogram overlay and a stat tile.

**The two-series chart palette is validated, not chosen by eye.** Emerald-600
(#059669) against fuchsia-600 (#c026d3) on the dark card surface separate by
ΔE 17.2 under deuteranopia and 26.6 under tritanopia. The app's own emerald and
rose are status colours (in zone / off), so the chart series deliberately do not
reuse them, and both series carry a legend and direct labels so identity never
rests on colour alone.

**The week-over-week histogram plots share, not count.** Two weeks rarely contain
the same number of trials, and comparing raw counts would read a longer session as
progress.

**The centroid distribution counts only the sustained /s/ prompt.** Centroid
depends on the vowel context around the /s/, so comparing a week of sustained /s/
against a week of words would measure the curriculum rather than the speaker.

**"Not sure" is excluded from self-rating agreement.** It is not a claim that can
be right or wrong; counting it would dilute the number that matters. Over- and
under-confidence are reported separately, because they call for opposite
responses.

**Levels 3–5 are hybrid, not transcription-only.** Spec §3.6 puts them on
"acoustic score + Whisper match", which Phase 2 had simplified to a hard cut at
level 5. Corrected: 0–2 acoustic, 3–5 hybrid, 6–7 transcript-only, 8 baseline.

**A hybrid level falls back to the gauge when transcription does not run.**
Offline, a failed upload, a browser that will not record — all yield "not
scored" rather than a failed trial. Marking a good attempt wrong because the
network was down would teach the opposite of what the drill is for. A
transcript-only level has nothing to fall back to, so it stays locked without a
reachable server and says so.

**A wrong word outranks the gauge in the feedback.** When the transcript comes
back as a different word, reporting the placement percentage first would bury
the thing that actually went wrong.

**The upload and transcription overlap with the self-rating.** The user has to
commit to a rating before the score is revealed anyway, so the network round trip
costs nothing; the result screen waits on it only if it is still in flight.

**The result screen keeps the fading plan that judged the trial.** Committing a
trial changes the rolling accuracy and therefore the schedule, so reading the
live plan when rendering the result described a rule that was not the one
applied — the card claimed "scores every 1 trials" while hiding the score.
Caught by looking at a screenshot.

**The health probe is shared across mounts with a 30-second TTL.** Home, Drill
and Baseline all ask; probing per mount put a request behind every screen change
for an answer that does not change that fast.

**Clips are uploaded on the sampling schedule *or* when the level needs one.**
Spec §4's "every 5th trial plus all failed trials, capped at 20/session" governs
the archive; a level scored by transcription has no score at all without its
clip, so it bypasses the sampling but still respects the cap.
