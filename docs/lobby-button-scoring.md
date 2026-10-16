# Optional lobby button scoring

The existing startup template and Lorenzi link remain available for manual scoring.
The first eligible human player accepting the scorekeeper checkmark is persisted on
the active lobby. Their announcement offers **Enable High IQ scoring** for supported
player counts. Tournaments, survival and 1v1 retain manual scoring. Default formats:

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

Only that scorekeeper can activate the system, use `!l score`, press entry controls,
edit past races or restore a backup. Staff privileges do not bypass this restriction.
All panels and results remain public to members with existing room read access;
successful button presses are acknowledged silently and rejection messages are private. No channel permissions
or server roles are changed by scoring.

## Race entry

After activation, the bot pings the scorekeeper with instructions. `!l score` opens
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
The control row reads **Undo↩️**, **Reset❌**, **Tie⚖️** (or **Tie done⚖️**), then
**Save scores✅** at the right.
The prompt advances from **Select 1st place player** to the last position; eighth
place specifically uses **Select 8th place 🐢**.
**Undo↩️** and **Reset❌** affect only the unfinished entry. **Save scores✅** requires
every player. `!l score edit 3` replaces race/round 3 without changing other columns.
If an unfinished panel exists, another command links to it instead of creating a
second entry. The visible finishing order carries the draft across bot restarts.

## Ties

At a position shared by multiple players, press **Tie⚖️**, select all players sharing
that place, then press **Tie done⚖️**. Normal positions still advance after one tap.
The player buttons stay in the same rows and each player can appear only once.
**Save scores✅** remains disabled until all players are selected and any active tie
is confirmed. FFA allows two through all players to share a position. In team modes,
each tie group can contain at most one player from each team. Selecting a player
disables their teammates while the tie is being entered; selecting another team's
player also disables that player's teammates. The handler rejects teammate picks
even if a stale or forged button request bypasses the disabled control. Undo and
Reset❌ restore eligibility, and confirming the tie re-enables unselected players
for the next position. Tie is disabled when all remaining players share a team.
Team membership comes from the lobby's saved team list, including on restart;
missing or invalid team assignments disable tie entry until corrected. Existing
unfinished same-team ties must be corrected with Undo or Reset❌ before saving.
The review displays the same place number beside every
member of a tie, and the visible panel retains an unfinished tie across restarts.

Every tied player receives the full points for their shared position. Racing,
itemless and Insta formats skip the places occupied by the tie: two tied for first
in regular FFA receive 9 each, followed by third place receiving 7. Battle formats
advance by one place per group: Battle FFA results can be 5, 5, 3, 2 for two tied
for first, or 5, 5, 5, 3 for three tied for first. The same rule applies to ties
at any later position and to multiple separate tie groups.

If a player was selected normally before remembering the tie, use **Undo↩️**,
then **Tie⚖️**. While entering a tie, Undo removes the most recent selection; at an
empty tie it cancels tie entry. Undo on a confirmed tie removes its last player
and reopens the group for correction. Reset❌ clears the whole unfinished entry.
Existing unfinished panels from before tie support remain readable.

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

## Validation

Run `node --test tests/lobby-scoring.test.js` for the feature and
`node --test tests/*.test.js` for the offline regression suite. Discord, rendering and
database boundaries are mocked; tests never start the bot or connect to MongoDB.
The existing renderer, flags and fonts are intentionally untouched. Mobile layout,
live Discord permissions and the deployed OS/native canvas runtime need separate
validation. The bot uses its existing room access and needs message history, sending,
embedding and attachment permissions to operate the workflow.
