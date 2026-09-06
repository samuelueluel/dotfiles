---
name: music
description: Manages MPD/rmpc playback and queues, criterion-based local album curation, personalized recommendations and outside-library discovery through Last.fm, music metadata and tags, covers, Beets imports, and onboarding. Use when the user asks to add albums to the queue, find music matching ratings/genres/taste/recency, suggest music not in the library, inspect or control playback, manage playlists, tag music, repair album art, import albums, or use Beets or music-onboard.
---

# Music Management: MPD, `mpc`, `rmpc`, and Beets

## CPTR / Headless Limitation

CPTR's conservative headless Bash policy does not allow `mpc`, `rmpc`, or interactive `music-onboard`. Use CPTR for explanatory guidance only; perform playback, queue, tagging, and onboarding through regular Pi or a host terminal, and report blocked commands without claiming they ran.

## Request-Routing Playbook

```text
REQUEST
├─ Library & Tag Management
│  ├─ Inspect/search metadata ──→ mpc search/filter over live MPD state
│  └─ Add/edit tags ───────────→ music-* scripts (append unless replacement is explicit)
├─ Add Albums/Tracks to Queue
│  ├─ Named local items ───────→ exact MPD match → append
│  └─ Criteria-based request ──→ local candidates → filter/enrich/rank → append N
├─ Recommend/Suggest Only
│  ├─ Local-library scope ─────→ live MPD candidates + Last.fm evidence
│  └─ Outside-library scope ───→ Last.fm candidates → verify absent from MPD → return list
├─ Direct Playback Control ─────→ mpc status/toggle/next/prev (NEVER clear unless asked)
└─ Album Onboarding & Beets ────→ references/beets-and-onboarding.md (interactive only)
```

## Architecture & Tool Split

- **MPD (`mpd`):** Music server daemon and database. Do not restart or reconfigure unless explicitly requested.
- **`mpc`:** Primary CLI for playback control, status, queue management, searches, and filter pipelines.
- **`rmpc`:** Interactive terminal TUI and CLI helper (for `addrandom`, `remote keybind`, `save`/`load` playlists). Controls and displays the same MPD state queried by `mpc`.
- **Search Tooling:** Always use `mpc search` for live local metadata queries (no `rmpc search` exists).
- **Last.fm MCP:** Supplies Samuel's scrobbles, personal play counts/charts, listening history, and Last.fm similarity/relatedness data. The configured default user is `samuelueluel`.

## Mode Boundaries

- **Queue requests are local-only mutations:** “add,” “enqueue,” or “put in my queue” selects only files present in MPD. Never offer an unavailable external release as a queued result.
- **Suggestion requests do not mutate playback:** “recommend” or “suggest” returns candidates unless Samuel also asks to queue them. For “not in my library,” verify every candidate's absence with an exact MPD artist/album lookup.
- **Unscoped suggestions may mix pools:** If Samuel gives no local/outside-library qualifier, recommendations may include both, but label local availability and do not modify the queue.

## Criteria-Based Curation Workflow

1. **Resolve action and pool:** Queue language means local MPD items and an append mutation; suggestion language means no mutation. Honor explicit local-library or outside-library scope.
2. **Parse criteria:** Separate hard filters (library presence, `Unrated`, rating bounds, named genres, exclusions) from ranking signals (“likely to like,” similarity, recency, novelty). Never relax a hard filter silently.
3. **Generate distinct candidates:** Deduplicate local track matches by album artist + album (and date when needed). Generate external candidates from Last.fm, then remove exact artist/album matches already present in MPD.
4. **Enrich and rank:** Combine live MPD ratings/genres with relevant Last.fm personal play counts, recency, and similarity. Explicit ratings are stronger preference evidence than play counts; high play counts indicate exposure or engagement, not approval.
5. **Select the requested count:** Avoid albums already in the queue and repeated candidates. If too few satisfy the hard criteria, use the available set and report the shortfall rather than weakening the request.
6. **Complete the action:** For queue requests, append every track from each selected album in track order without clearing, playing, or shuffling. For suggestions, return the ranked list with concise evidence and local availability.

## Natural Criterion Semantics

- **High rated:** Means live `R: 4`, `R: 4.5`, or `R: 5` unless Samuel sets another threshold. “Unrated” means the live `Unrated` grouping value, not missing Last.fm data.
- **Likely to like but unrated:** Start from distinct local `Unrated` albums; rank by genre affinity to highly rated albums, Last.fm similarity, and personal listening evidence without inventing a candidate rating.
- **Similar to artist/band `Y`:** Use Last.fm `get_similar_artists` or `get_similar_tracks`; derive album candidates through related artists' top albums, similar tracks' albums, or tag-based album results. Intersect with MPD for queue requests; require MPD absence for outside-library requests.
- **Haven't listened to in a while:** If no window is given, use no scrobble in the last 180 days. Prefer previously scrobbled-but-stale albums over never-scrobbled albums, and label unknown history rather than treating it as stale.
- **Wouldn't usually listen to:** Enter novelty mode: favor locally underrepresented genres/artists or low-familiarity candidates, while retaining at least one bridge signal such as an adjacent genre, a similarity edge, or affinity to a highly rated album.
- **In the ballpark of genres `A`, `B`, `C`:** Treat as a broad union plus adjacent similarity candidates; deduplicate separate MPD searches because MPD lacks `OR`. Require intersection only when Samuel says “all,” “both,” or “every,” and honor explicit exclusions.

## Evidence Boundaries

- For installed albums, current ratings and canonical RYM-derived genres come from live MPD metadata displayed by `rmpc` and queried with `mpc`.
- Use Last.fm personal charts/history for play evidence and Last.fm similarity/tag endpoints for discovery. Never use its folksonomy as authority for canonical RYM genre tags.
- Explain recommendations using observed evidence; never invent a rating, play count, last-played date, similarity link, genre, or library-presence result. If a Last.fm result is paginated or truncated, label partial coverage rather than claiming completeness.

## Safe Mutation Invariants

- **Queue Preservation:** Do not clear or replace the queue unless explicitly instructed. Commands like `mpc clear`, `searchadd`, `insert`, `shuffle`, and `play` mutate playback state.
- **Dry-Run First:** Always preview metadata and filesystem modifications with `--dry-run`.
- **Destructive Onboarding:** `music-onboard` is interactive, moves/deletes source files, and has no dry-run mode. Run only upon explicit request.
- **No `--help` on Legacy Scripts:** Never pass `--help` to `music-fix-multivalue` or `music-fix-separators-legacy` (they do not parse help and may trigger unintended library scans).
- **MPD Cache Invalidation:** Refresh MPD after approved tag or file changes using `mpc -w update`.

## Scope & Syntax Invariants

- **Tagging Scope:** `tag_utils.py` supports only MP3 and FLAC. Targeted scripts require an explicit album/directory path; bulk scripts require `MUSIC_DIR`.
- **Destructive Conversion:** `music-m4a-to-flac` requires explicit user authorization, a recent backup, and a `--dry-run` preview before live use.
- **Separator Repair Order:** If both legacy separator and multivalue repairs are needed, run `music-fix-separators-legacy` before `music-fix-multivalue`.
- **Rating Syntax:** Use `R: 5`, never `R: 5.0`.
- **Natural-Language Tag Mutation:** “Tag this album with `X`,” “add `X`,” and “apply `X`” mean append with `music-add-tag`, preserving all existing genre and grouping values. Use `music-set-tags` only when Samuel explicitly says “set,” “replace,” “only,” or otherwise requests field replacement.
- **Inclusive Tag Matching:** Requests for albums or tracks “with,” “having,” or “tagged” `X` mean `X` must be present; additional grouping/tag values remain allowed. Require an exclusive match only when the user says “only,” “exclusively,” or explicitly excludes another value.
- **Album Rating Semantics:** Unless Samuel explicitly names RYM data, “album rating” and comparisons such as “less than 4,” “at least `R: 4`,” or “between 3.5 and 4.5” refer to numeric comparison over live MPD `grouping` ratings. Ignore non-rating grouping flags and exclude `Unrated`; strict terms exclude the boundary and inclusive terms include it.
- **MPD Filter Syntax:** Filter expressions require explicit parentheses around each clause and sub-expression; `OR` and numeric comparisons are unsupported. Expand rating comparisons over the finite canonical rating set using regex or separate searches. When filter behavior is version-sensitive, inspect `mpd --version`.

## RateYourMusic Genre Tagging Convention & Datasets

- **Standard Genre Convention:** RateYourMusic (RYM) is Samuel's official gold-standard taxonomy for all genre tagging.
- **Canonical RYM Subgenres:** When tagging or onboarding music, always assign canonical **RYM Primary and Secondary Genres** (e.g. `Slowcore`, `Midwest Emo`, `Shibuya-kei`, `Chamber Folk`, `Atmospheric Black Metal`, `Neo-Psychedelia`, `Glitch Pop`, `Alt-Country`, `Art Pop`).
- **Native Multi-Value Storage:** Genres are stored as discrete array elements in ID3v2.4 `TCON` (MP3) and Vorbis `genre` (FLAC) via `tag_utils.py` (never raw embedded semicolons in a single string).
- **Current Installed-Library State:** Use live MPD `grouping` ratings and `genre` values for taste judgments, recommendations, and current album queries; these are the values displayed by `rmpc`.
- **Secondary Reference Files:**
  - `~/.config/music/library_rym_genres_manifest.csv`: Use for bulk genre audits, mapping provenance, planned/current comparisons, and cross-checks; do not prefer its snapshot over live MPD metadata.
  - `~/.config/music/rym_collection_genres.csv`: Use for collection-wide offline queries, RYM release URLs, and releases absent from MPD; its ratings and genres are snapshots, not the current authority for installed albums.
- Inspect either CSV's live contents before using it rather than relying on baked counts or remembered rows.

## Progressive Disclosure & Reference Routing

- If curating a criterion-based queue, interpreting taste/novelty language, or finding music outside the library, load [curation and discovery workflows](references/curation-and-discovery.md).
- If directly controlling playback, appending named items, or editing the queue, load [playback and queue commands](references/playback-and-queue.md).
- If handling metadata fields, grouping, RYM queries, or MPD filter grammar, load [tagging taxonomy](references/tagging-taxonomy.md).
- If editing audio tags, fixing separators or cover art, or converting formats, load [custom scripts](references/scripts.md).
- If onboarding albums, using Beets, or managing ReplayGain, load [Beets and onboarding](references/beets-and-onboarding.md).
