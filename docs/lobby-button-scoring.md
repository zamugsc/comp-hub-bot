# Optional High IQ Scoring

The existing startup template and Lorenzi link remain available for manual scoring.
The first eligible human player accepting the scorekeeper checkmark is persisted on
the active lobby. Their announcement offers **Enable High IQ Scoring** for supported
player counts. Activation disables the button with the label **High IQ Scoring enabled**
and pings the scorekeeper with the guide below. Message prose uses **High IQ Scoring**;
button labels use plain text. Tournaments, survival and 1v1 retain manual scoring. Default formats:

| Format | Players | Default races/arenas | Points from first to last |
| --- | --- | --- | --- |
| FFA | 8 | 8 | 9, 8, 7, 5, 4, 3, 2, 1 |
| Duos / Itemless Duos / Insta Duos | 8 | 8 | 8, 7, 6, 5, 4, 3, 2, 1 |
| 3v3 / Insta 3v3 | 6 | 8 | 6, 5, 4, 3, 2, 1 |
| Itemless 3v3 | 6 | 6 | 6, 5, 4, 3, 2, 1 |
| 4v4 / Insta 4v4 | 8 | 10 | 10, 8, 6, 5, 4, 3, 2, 1 |
| Itemless 4v4 | 8 | 8 | 10, 8, 6, 5, 4, 3, 2, 1 |
| Itemless FFA | 4 | 6 | 5, 3, 2, 1 |
| Battle FFA | 4 | 5 | 5, 3, 2, 1 |
| Battle Duos | 4 | 6 | 4, 3, 2, 1 |
| Battle 3v3 | 6 | 6 | 6, 5, 4, 3, 2, 1 |
| Battle 4v4 | 8 | 8 | 8, 7, 6, 5, 4, 3, 2, 1 |

FFA, Itemless FFA and Battle FFA use the same scaling for the actual started roster:

| Players | Points from first to last |
| --- | --- |
| 4 | 5, 3, 2, 1 |
| 5 | 6, 5, 3, 2, 1 |
| 6 | 7, 6, 5, 3, 2, 1 |
| 7 | 8, 7, 6, 4, 3, 2, 1 |
| 8 | 9, 8, 7, 5, 4, 3, 2, 1 |

All Duos formats (normal, Itemless, Insta and Battle) use balanced N-to-1 points
for complete rosters of 4, 6 or 8 players. 3v3 and 4v4 retain their configured
six- and eight-player scoring. The scorer supports these known point maps without
changing which sizes the existing lobby creation and start commands permit.

Existing lobby defaults are unchanged. The panel uses the actual saved race/arena
count and ordered map list, including a custom count when configured.

Only that scorekeeper can activate the system, use `!l score` to open an entry, press entry controls,
edit past races or restore a backup. Staff privileges do not bypass this restriction.
Anyone can read `!l score help` wherever normal bot commands are allowed, without
an active lobby or scorekeeper. It shows the High IQ Scoring Guide without reading
or changing lobby state. The configured Staff role appears as a mention with
notifications disabled.
All panels and results remain public to members with existing room read access;
successful button presses are acknowledged silently and rejection messages are private. No channel permissions
or server roles are changed by scoring.

For supported button-scoring formats, the current scorekeeper can use
`!l change scorekeeper @player` in the lobby room to invite one other human lobby
player to take over. Only that player can press
**Accept scorekeeper duty**, within 60 seconds. The original scorekeeper retains
control until acceptance; a timeout disables the request and leaves ownership
unchanged.

Other lobby players can use the same command to nominate another human lobby player
or themselves when the current scorekeeper is unavailable. A nomination starts a
120-second **✅** reaction vote. Nominating another player requires
`ceil((player count - 1) * 0.75)` other voters, including the nominee. The requester
is already counted by issuing the command. Self-nomination requires one fewer
other voter. For four players these requirements are three and two other voters;
for eight players they are six and five. Only distinct lobby players' checkmarks
count; bot reactions, outsiders and the requester's own reaction are excluded.
Withdrawn votes do not count. The vote stays open until both the threshold and
the nominee's approval are satisfied, or 120 seconds expire.

Staff recognized by the existing `isStaff()` check can immediately assign any human
lobby player, even when the staff member is not a participant. The command still
runs in that lobby's room. Staff assignments cancel pending handoffs and votes;
other players cannot replace a pending request. There is one pending request per
lobby. Ownership, roster, room assignment and the deadline are checked again before
applying a vote. A timeout or cancellation leaves ownership unchanged.

All transfer routes preserve the existing panel, unfinished selections, editing,
recovery and submission rights without changing scores or enabling High IQ Scoring
automatically. Requests are temporary in memory; there is no additional database
state or restart recovery. Server roles and channel permissions are unchanged.

## Race entry

After activation, the bot pings the scorekeeper with a short guide covering entry,
saving, the next race and editing previous races. It points to `!l score help` and
mentions the configured Staff role without notifying that role. The built-in help
guide covers scoring, editing, ties, penalties and scorekeeper handoffs. `!l score` opens
the next race (or battle round) with its saved map name and stationary player buttons,
two per row. Selected players are disabled and also rejected as duplicates by the handler.
Battle titles include the announced arena and game mode, for example
**Battle 1/5 — Skull Rock — Balanced LKD**. The ordered mode list is saved with
the arena list; Last Kart Driving is abbreviated to LKD for display. Resuming or
correcting a round retains that round's assigned mode. For older active lobbies,
the bot can recover one unambiguous matching schedule from its pinned start message.
If the schedule is missing or ambiguous, the title says **Mode unavailable** and
scoring still works; the bot never generates a replacement mode list.
Team player buttons carry the table's matching color marker: Team A 🟦, Team B 🟥,
Team C 🟩 and Team D 🟨. Teammates share a marker, derived from the saved team
list rather than their position in the button grid. FFA names have no team marker.
These standard emoji need no custom server emoji and remain on disabled buttons.
The control row reads **Undo ↩️**, **Reset ❌**, **Tie ⚖️** (or **Tie done**),
**Penalty 💀** in non-battle modes, then **Save scores ✅** at the right.
The prompt advances from **Select 1st place player** to the last position; eighth
place specifically uses **Select 8th place 🐢**.
**Undo ↩️** and **Reset ❌** affect only the unfinished entry. **Save scores ✅** requires
every player. The activation guide includes: To go back and edit a previous race,
use `!l score edit #`, and replace # with the race number. Corrections preserve the
other race columns.
If an unfinished panel exists, another command links to it instead of creating a
second entry. The visible finishing order carries the draft across bot restarts.

## Ties

Press **Tie ⚖️** before selecting tied players, then press **Tie done**.
Normal positions still advance after one tap.
The player buttons stay in the same rows and each player can appear only once.
**Save scores ✅** remains disabled until all players are selected and any active tie
is confirmed. FFA allows two through all players to share a position. In team modes,
each tie group can contain at most one player from each team. Selecting a player
disables their teammates while the tie is being entered; selecting another team's
player also disables that player's teammates. The handler rejects teammate picks
even if a stale or forged button request bypasses the disabled control. Undo and
Reset ❌ restore eligibility, and confirming the tie re-enables unselected players
for the next position. Tie is disabled when all remaining players share a team.
Team membership comes from the lobby's saved team list, including on restart;
missing or invalid team assignments disable tie entry until corrected. Existing
unfinished same-team ties must be corrected with Undo or Reset ❌ before saving.
The review displays the same place number beside every
member of a tie, and the visible panel retains an unfinished tie across restarts.

Every tied player receives the full points for their shared position. Racing,
itemless and Insta formats skip the places occupied by the tie: two tied for first
in regular FFA receive 9 each, followed by third place receiving 7. Battle formats
advance by one place per group: Battle FFA results can be 5, 5, 3, 2 for two tied
for first, or 5, 5, 5, 3 for three tied for first. The same rule applies to ties
at any later position and to multiple separate tie groups.

If a player was selected normally before remembering the tie, use **Undo ↩️**,
then **Tie ⚖️**. While entering a tie, Undo removes the most recent selection; at an
empty tie it cancels tie entry. Undo on a confirmed tie removes its last player
and reopens the group for correction. Reset ❌ clears the whole unfinished entry.
Existing unfinished panels from before tie support remain readable.

## Penalties

Non-battle scoring offers **Penalty 💀** after every player has a finishing position
and any tie is confirmed. It stays disabled for incomplete or invalid entries.
Battle panels have no penalty controls, and forged penalty actions are rejected.

Enter the actual finishing order first. Press **Penalty 💀**, select a player using
the existing player buttons, then use the deduction control and **Last place (0 pts)**.
The selected player's button is highlighted. Each **-4 points** press adds another
type A deduction in FFA and Duos, without a gameplay cap or zero floor. Type A
never changes positions.

In non-battle 3v3/4v4 wars, including Itemless and Insta, **Laphit** replaces
**-4 points**. It opens a dropdown containing **-1** through **-10** and **Cancel**.
Selecting a value adds that deduction to the selected player's race score and
returns to the penalty controls. Multiple Laphits of any allowed value stack
without a gameplay cap; scores can become negative and placements never change.
The dropdown temporarily replaces the control row and locks player selection,
keeping the panel within five rows. Cancel adds no penalty or undo step. Each menu
is bound to its selected player and accepts only one deduction, so stale or
duplicate selections cannot add another penalty. Other formats reject Laphit
actions; war panels reject the old static -4 action.

**Last place (0 pts)** toggles type B: the player receives zero base points and is
removed from their original position or tie. Everyone else moves up, retaining
their remaining ties under the normal racing rules. All type B recipients share
last place and zero base points, including teammates. Deductions, including Laphits, still apply
to them. Toggling B off restores the original order and ties.

While applying penalties, the control row becomes **Undo ↩️**, **-4 points**,
**Last place (0 pts)**, **Penalty done**, with **Laphit** replacing **-4 points** in
wars. Undo reverses the latest penalty action, including one Laphit selection;
selecting another player does not create an undo step. **Penalty done** returns to
review without saving. Saving, resetting or changing finishing positions is blocked
until penalty entry is closed. Normal Undo can then change finishing positions,
disabling **Penalty 💀** again until entry is complete. Reset clears the whole
unfinished entry, including penalties. The review shows adjusted places and scores.

The saved race cell retains deductions: `9-4`, `9-8`, `9-12`, or `0-4` for B plus A.
These evaluate to 5, 1, -3 and -4 respectively. A B-only cell is `0`. Appending races,
correcting another race and restoring a backup preserve the other cells' deductions.
War cells use the same notation with the summed Laphit deduction: for example,
`10-3`, `10-17`, or `0-5`. Older unfinished war drafts with static -4 deductions
retain their existing deduction amount when resumed with Laphit controls.
Correcting a scored race uses the existing full re-entry flow, including its penalties.
The existing renderer understands this notation and is unchanged. Penalties live in
the unfinished panel and saved score template; no new database fields are needed.

## Score record and recovery

The zero-filled startup template supplies the roster for the first race. Successful
saves publish a new message with a code-block template above the existing rendered
image, then remove the entry panel. New templates contain only completed race columns,
with no trailing `|`. Every player must have the same number of columns. The bot
counts columns, not score totals or nonzero values, to choose the next race.

The active lobby stores the latest message ID. Each command reads the actual Discord
message, bypassing the local message cache, and validates it against the saved roster.
The database also retains the latest successfully saved template as a recovery copy.
Missing or malformed messages pause scoring and offer **Restore scores from backup**.
Only the scorekeeper can confirm; recovery reposts the text and image and updates the
reference. It never silently uses a backup. Manual edits on Lorenzi are not imported.

Renderer/send/database failures retain the current entry for retry. A failed database
write after posting may leave an extra result snapshot in chat; it does not append a
race twice. Old panel buttons are invalid once a race has been committed. A deleted
unfinished panel cannot recover unsaved picks; the bot explicitly asks for re-entry.

The actual ordered tracks are persisted at startup, on internal track-draft completion,
and on reroll. Reroll is refused once an activated scoring workflow has an entry or a
saved race, so tracks cannot change underneath recorded results. External track drafts
whose selected tracks never return to the bot retain the manual workflow until a track
list can be integrated; they do not offer activation in this version.

Closing the active lobby deletes its backup and scoring references with the lobby
record; they are not copied to finished-lobby statistics. Failed room cleanup keeps the
active record. Posted results follow existing room message-retention behavior. Completing
scoring does not close the lobby or submit results to ranked leaderboards.

Once High IQ Scoring is enabled, `!l end` requires every configured race or battle
round to have been saved with **Save scores ✅**. Opening the final panel or filling
it in is not enough. Incomplete scoring reports the saved count and blocks both
direct ending and end votes. An unfinished correction or pending score recovery
also blocks ending. Completion is checked again against the current lobby under
the shared room lock before any cleanup, so an earlier end vote cannot bypass it.
Manual-scoring and unstarted lobbies retain their existing end behavior. This check
does not grant anyone new permissions; staff's existing delete control remains
available to cancel an abandoned lobby.

## Optional ranked submission

After the final race or battle round is saved, ranked High IQ Scoring lobbies offer
`Submit finished scores to #results-submissions ?`, using a clickable channel mention
for the configured results channel. The buttons are **Submit scores** and
**I'll do it myself**. Only the current scorekeeper can answer, including an accepted
replacement. Unranked and manual-scoring lobbies do not receive this prompt.

Confirmation reads and validates the current saved table, runs the existing ranked
ban check, then posts only the scorekeeper mention, a newline, and the text table
inside one triple-backtick code block. There is no comma after the mention, image,
automatic approval reaction or leaderboard update. Only the scorekeeper may be pinged.
Success disables the prompt and links to the submitted message. Repeated clicks
cannot create another submission. The active lobby retains its destination message,
channel and source-score message references.

Choosing **I'll do it myself** closes the prompt and leaves submission manual.
Submission is optional for `!l end`. Correcting scores invalidates an unanswered
prompt; saving the correction offers a fresh prompt if results have not been posted.
After submission, further saves point to the existing post for manual follow-up
with staff, without silently editing it or creating another post. A failed send
keeps scores saved and permits retry; `!l score` can retry creating a missing prompt.
The bot uses its existing access to the configured channel; no server permissions
are changed. The table renderer is unchanged.

## Validation

Run `node --test tests/lobby-scoring.test.js` for the feature and
`node --test tests/*.test.js` for the offline regression suite. Discord, rendering and
database boundaries are mocked; tests never start the bot or connect to MongoDB.
The existing renderer, flags and fonts are intentionally untouched. Mobile layout,
live Discord permissions and the deployed OS/native canvas runtime need separate
validation. The bot uses its existing room access and needs message history, sending,
embedding and attachment permissions to operate the workflow.
