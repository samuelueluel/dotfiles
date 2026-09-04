# Tagging Taxonomy & MPD Filter Reference

**Load this file when** querying metadata, constructing MPD filter expressions, inspecting custom tag fields, or verifying grouping vocabularies.

## Tag Field Mappings

`~/.local/bin/tag_utils.py` manages custom tags across formats (MP3 and FLAC only):

| Field Meaning | MP3 (ID3v2.4) | FLAC (Vorbis Comment) |
|---|---|---|
| Grouping | `TIT1` | `grouping` |
| Genre | `TCON` | `genre` |
| Title / Album / Artist | `TIT2` / `TALB` / `TPE1` | `title` / `album` / `artist` |
| Track / Date | `TRCK` / `TDRC` | `tracknumber` / `date` |

## Grouping Vocabulary & Normalization

Samuel's library uses a strictly controlled grouping taxonomy:
- `[Priority]`
- Ratings: `R: 5`, `R: 4.5`, `R: 4`, `R: 3.5`, `R: 3`, `R: 2.5` *(Note: use `R: 5`, never `R: 5.0`)*
- Flags: `Unrated`, `Overrated`, `Underrated`, `<500 ratings`, `FL`, `Wall`

### Canonical Sort Order (`tag_utils.normalize_grouping`)
When normalized, grouping values are deduplicated and ordered as follows:
1. `[Priority]`
2. Ratings `R:` (reverse lexical order: `R: 5`, `R: 4.5`, ..., `R: 2.5`)
3. `Unrated` → `Overrated` → `Underrated` → `<500 ratings` → `FL` → `Wall`
4. Custom/other values (alphabetical)

## MPD Search Forms

```bash
# Case-insensitive substring search
mpc search artist "Artist Name"
mpc search album "Album Name"
mpc search title "Song Title"
mpc search grouping "R: 5"

# Exact case-sensitive match
mpc find artist "Artist Name" album "Album Name"

# Queue results directly
mpc searchadd artist "Artist" album "Album"
mpc findadd artist "Artist" album "Album"
```

## MPD Filter Grammar (MPD 0.24 Verified)

MPD filter expressions require explicit parentheses around each clause and sub-expression:

```bash
# Multiple tag match (AND)
mpc search '((grouping == "[Priority]") AND (grouping == "Unrated"))'

# Genre + Date prefix (dates are treated as strings)
mpc search '((genre == "Art Rock") AND (date starts_with "199"))'

# Regex match (PCRE)
mpc search '((grouping == "<500 ratings") AND (grouping =~ "^R: (4([.]5)?|5)$"))'

# Negation
mpc search '(!(grouping == "Overrated"))'
```

### Grammar Limitations & Rules
- **No `OR` operator:** `OR` is unsupported and causes `MPD error: 'AND' expected`. Use regex (`=~`) or separate queries.
- **No numeric comparisons:** Expressions like `date >= "1990"` fail. Use `starts_with` or regex.
- **Multiple Tag Values:** Separate `(grouping == "...")` clauses can match distinct multi-value tags on the same track.

## Common Queue Recipes

```bash
# Append all 5-star tracks to queue
mpc searchadd grouping "R: 5"

# Append specific album
mpc searchadd artist "Artist Name" album "Album Name"

# Append filtered tracks and shuffle (if requested)
mpc searchadd '((grouping == "[Priority]") AND (grouping == "Unrated"))'
mpc shuffle

# Replace queue and start playback (explicit request only)
mpc clear && mpc searchadd '((genre == "Art Rock") AND (date starts_with "199"))' && mpc play
```

## RateYourMusic Genre Tagging Convention & Taxonomy

RateYourMusic (RYM) is Samuel's official gold-standard genre taxonomy across the entire library.

### Tagging Rules & Conventions
1. **Canonical Primary & Secondary Genres:** Always use official RateYourMusic genre nomenclature with strict Title Case and standard hyphenation:
   - Examples: `Slowcore`, `Midwest Emo`, `Shibuya-kei`, `Chamber Folk`, `Atmospheric Black Metal`, `Neo-Psychedelia`, `Glitch Pop`, `Alt-Country`, `Art Pop`, `Math Rock`, `Singer-Songwriter`, `Post-Rock`.
2. **Multi-Value Tag Storage:**
   - Genres must be written as discrete array items in `tag_utils.set_values(audio, 'genres', ['Genre 1', 'Genre 2'])`.
   - Never write flattened strings with embedded semicolons into a single tag frame.
3. **Library Manifest:** `~/.config/music/library_rym_genres_manifest.csv` holds the complete, verified mapping for all 1,376+ albums in `~/Music/mp3-library`.

## RateYourMusic Datasets & References

- **Library-Wide RYM Manifest:** `~/.config/music/library_rym_genres_manifest.csv` (1,376 albums mapped to canonical RYM genres).
- **Rated Collection Snapshot:** `~/.config/music/rym_collection_genres.csv` (720+ rated releases with star ratings and URLs for taste grounding across 4.0★, 4.5★, and 5.0★ tiers).

### Quick Query Patterns

```python
import csv

# Query full library manifest for specific RYM genres
with open("/var/home/samuel/.config/music/library_rym_genres_manifest.csv") as f:
    manifest = list(csv.DictReader(f))

slowcore_albums = [
    r for r in manifest
    if "Slowcore" in r["Proposed RYM Genres"]
]
```

### CLI One-Liner (Search Snapshot)
```bash
python3 -c '
import csv
with open("/var/home/samuel/.config/music/rym_collection_genres.csv") as f:
    for r in csv.DictReader(f):
        if r["Rating"] in ("5.00 stars", "4.50 stars", "4.00 stars"):
            print(f"{r[\"Rating\"]} | {r[\"Artist\"]} - {r[\"Album\"]} ({r[\"Genres\"]})")
'
```



