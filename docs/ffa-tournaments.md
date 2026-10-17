# FFA tournament rooms

New normal-items FFA (`race_ffa`) tournaments with 16, 32 or 64 players use one
signup message and separate eight-player games. The selected size must fill
before starting. Existing events already running on the old single-room flow
keep that flow; this change does not migrate them mid-round.

The signup message keeps the original roster and becomes the round overview,
with game-room links and the number of confirmed games. Rooms come from the
normal `lobby-room-N` pool. Match numbers in the bracket are independent of the
physical channel number. There is no extra hub channel.

## Draw and bracket

The opening draw sorts each player's highest **current** rating across all modes
(1200 if no finite rating exists), then snakes the sorted list across the games.
Equal ratings sort by Discord ID for a repeatable draw. The draw and ratings are
saved once; later rounds use finishing places, without reseeding by MMR.

For 64 → 32, each column below is a destination quarterfinal; each value is the
finishing place taken from that source match:

| Source match | QF1 | QF2 | QF3 | QF4 |
| --- | --- | --- | --- | --- |
| 1 | 1 | 2 | 3 | 4 |
| 2 | 2 | 1 | 4 | 3 |
| 3 | 2 | 1 | 4 | 3 |
| 4 | 1 | 2 | 3 | 4 |
| 5 | 3 | 4 | 1 | 2 |
| 6 | 4 | 3 | 2 | 1 |
| 7 | 3 | 4 | 1 | 2 |
| 8 | 4 | 3 | 2 | 1 |

For 32 → 16, QF1 and QF3 send places 1/4 to SF1 and 2/3 to SF2.
QF2 and QF4 send places 2/3 to SF1 and 1/4 to SF2.
Both semifinals send their top four to the final. A 32- or 16-player event starts
at the corresponding stage, with the same opening seeded draw.

## Scoring and finishing

Each game has its own volunteer scorekeeper and uses High IQ Scoring, with
`!l score`, corrections, backup recovery and scorekeeper handoff as in ordinary
games. New rounds start with fresh scoring records and new scorekeeper prompts.
Every game in a round receives the same generated track list and tournament
settings. A round's track list stays fixed.

In each game room, its scorekeeper, the tournament creator or staff confirms
the finish with `!l advance @p1 @p2 @p3 @p4`. The mentions confirm the four
qualifiers; their order does not establish finishing positions. Positions come
from the saved High IQ scores. Every configured race must be saved, with no
unfinished correction or recovery. A tie affecting qualifying positions pauses
advancement until the organizer tie rule is implemented; no automatic
tiebreaker is invented.

The bot waits for every game in the round to be confirmed, then creates the next
round automatically. Opening a correction or changing a confirmed game's saved
scores withdraws that confirmation while the round is still active.

In the final room, use `!l end` or `!l advance @winner`, with the same scoring and
permission checks. Every ranked game in every round gets its own optional
results-submission prompt. Submission does not block advancement. Old prompts
remain usable after room reuse or bot restart, including after the event ends;
completed game records are retained separately from the signup lobby.

## Restart, cleanup and permissions

The parent lobby saves the draw, round, groups and tracks. Each game separately
saves its roster, room assignment, scores, scorekeeper, confirmation and
submission references. Startup resumes managed events. Partial preparation can
be retried by the creator or staff with `!l advance <tournament-id>`. Retries
retain the saved draw and game assignments.

Staff can cancel the whole event by deleting its original signup message. This
closes game controls and releases every room owned by the event. A confirmed
missing signup message on startup also cancels it; a temporary fetch failure
retains the event. Failed permission cleanup leaves affected rooms reserved
for a later retry. Already completed game records remain available.

Room setup preserves existing role overwrites and removes temporary member
overwrites, then grants chat access to that game's players and the event
creator. Existing configured Staff access is preserved. This assumes the normal
ranked-room roles already give other verified members read access without chat
access. The code does not audit or change those server roles; administrator
permissions can override channel restrictions.

There is no scorekeeper timeout in this flow. The existing temporary global
signup-expiration disable from commit `0c108b7` is unchanged and still needs to
be reverted or replaced when the test ends. Permanent tournament-only
expiration policy, manual table imports, qualifying tie rules and new duo
bracketing remain deferred.

## Verification

Run `node --test tests/ffa-tournament.test.js` for mocked bracket, room,
permission, scoring, restart and submission checks. Run `node --test` for the
full regression suite. These tests do not start a bot or contact Discord or
MongoDB. A deployment still needs testing in the intended Discord environment.
