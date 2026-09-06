# Curation and Discovery Workflows

**Load this file when** selecting local albums by criteria, building a personalized queue, interpreting taste or novelty language, or recommending artists/albums outside the library.

## Evidence Sources & Discovery Pillars

Music curation and discovery operates across four synthesized pillars:
1. **Last.fm MCP:** Collaborative filtering (`get_similar_artists`, `get_similar_tracks`, `get_tag_top_albums`), user scrobble history, and exposure metrics.
2. **Library RYM Genre Tags:** Local library structural querying via live MPD genre fields (`mpc search genre ...`), leveraging fine-grained canonical RYM subgenres.
3. **Implicit Model Knowledge:** Nuanced understanding of production aesthetics, instrumentation, historical scenes, and artistic trajectories.
4. **Targeted Web Search:** Authorized for outside-library exploration, obscure release verification, and RYM/critical discourse; generally unnecessary for within-library matching.

| Question | Primary source | Supporting source |
|---|---|---|
| Is it in the local library? | Exact `mpc find` against live MPD | None |
| What is its current album rating? | MPD `grouping` (`R: 5` through `R: 2.5`, or `Unrated`) | Never substitute the CSV snapshot |
| What are its current canonical genres? | MPD `genre` values displayed by `rmpc` | RYM manifest only for audit/provenance |
| How often or recently has Samuel listened? | Last.fm personal charts and recent scrobbles | Treat missing/truncated results as unknown |
| What is similar or related? | Last.fm similar artists/tracks + Model knowledge | Artist top albums, tag top albums, web search |
| What are candidates outside the library? | Last.fm + Model knowledge + Web search | RYM collection snapshot for URL/context |
| Is an external release in Samuel's RYM snapshot? | `rym_collection_genres.csv` | Useful for RYM URL and snapshot context, not current local state |

## Local Candidate Construction

1. Query the live MPD database with `mpc`; do not scrape the visible `rmpc` interface.
2. Format enough fields to identify releases and evaluate filters:
   ```bash
   mpc -f '%albumartist%\t%album%\t%date%\t%grouping%\t%genre%\t%file%' search <criteria>
   ```
3. Collapse track results to distinct album artist + album. Include date when different releases share those fields.
4. Apply hard criteria before Last.fm enrichment. For multiple broad genres, run separate MPD searches and deduplicate because MPD has no `OR`. Do not apply implicit grouping rating or `[Priority]` filters; unrated, rarely played, and unfamiliar releases must remain fully eligible unless explicit bounds are requested.
5. Inspect the current queue and remove already-queued albums unless Samuel explicitly permits duplicates:
   ```bash
   mpc -f '%albumartist%\t%album%\t%file%' playlist
   ```

## Last.fm Tool Routing

- `get_user_top_albums`, `get_user_top_artists`, `get_user_top_tracks`: personal play counts over the requested period; use `overall` when no period is implied.
- `get_user_recent_tracks`: recency and last-180-day exclusion. Follow pagination far enough to cover the requested window; if complete coverage is impractical, label it partial.
- `get_similar_artists`: primary artist/band relatedness route.
- `get_similar_tracks`: track-level relatedness that can expose candidate albums.
- `get_artist_top_albums`: convert a related artist into album candidates.
- `get_tag_top_albums`: broaden discovery around a Last.fm tag; treat tags as discovery signals, not canonical RYM genres.
- `get_album` and `get_artist`: identity, metadata, and global context; global listener/play counts are not Samuel's personal play counts.

Last.fm exposes similar artists and tracks, not a direct similar-albums route. Build related album candidates from similar tracks' album identities or from the top albums of similar artists.

## Common Criterion Recipes

### Likely to Like but Unrated

1. Candidate pool: distinct local albums carrying `Unrated`.
2. Build affinity anchors from Samuel's live `R: 4`–`R: 5` albums and Last.fm listening history.
3. Rank candidates using canonical genre overlap, artist/track similarity edges, and personal familiarity.
4. Keep the candidate labeled `Unrated`; similarity is not a predicted numeric rating.

### High Rated but Not Heard in a While

1. Candidate pool: local `R: 4`, `R: 4.5`, and `R: 5` albums.
2. Default recency window: 180 days unless Samuel specifies another period.
3. Remove albums with a scrobble inside the window.
4. Rank previously scrobbled-but-stale albums ahead of albums with no verified history; present never-scrobbled albums as a separate category when useful.

### Similar to Artist or Band

1. Seed Last.fm with the named artist and fetch similar artists or similar tracks.
2. For a local queue, intersect resulting artists/albums with exact MPD matches.
3. For outside-library discovery, convert related artists to album candidates and remove albums already in MPD.
4. Preserve Last.fm match/relationship evidence in the rationale.

### Outside the Usual Listening Pattern

1. Estimate the familiar core from highly rated local genres and Last.fm top artists/albums.
2. Favor underrepresented genres, low-familiarity artists, or weakly represented regions/scenes.
3. Require one bridge signal: adjacent genre, similarity connection, shared scene, or relation to a highly rated anchor.
4. Do not turn novelty into randomness or claim unfamiliarity without checking local and Last.fm evidence.

### In the Ballpark of Several Genres

1. Treat “ballpark,” “around,” or “like A, B, C” as a union of those genres plus adjacent candidates.
2. Use live canonical genre tags for local filtering.
3. Use Last.fm tag/artist similarity only to broaden discovery.
4. Require every named genre only when Samuel says “all,” “both,” “intersection,” or equivalent.

## Queue Execution

1. Preview each selected release with an exact `mpc find` and confirm it resolves to the intended album tracks.
2. Append the complete release using the exact artist/album fields or verified file paths; preserve track order.
3. Do not clear, play, shuffle, or otherwise alter existing queue state unless explicitly requested.
4. Verify the queue after appending and report the number of distinct albums added plus any shortfall.

## Outside-Library Verification

- Album request: require no exact MPD match for artist/album; the artist may still exist locally.
- Artist request: require no MPD tracks matching that artist or album artist.
- Suggestions remain non-mutating. Explain that an external album cannot be queued until it has been added to the local library.
