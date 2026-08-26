# Tagging taxonomy and MPD search reference

Load this file when searching by metadata, inspecting grouping/genre values, or changing tags.

## Storage and field names

`~/.local/bin/tag_utils.py` maps the custom fields as follows:

| Meaning | MP3 | FLAC |
|---|---|---|
| grouping | ID3 `TIT1` | Vorbis `grouping` |
| genres | ID3 `TCON` | Vorbis `genre` |
| title/album/artist/track/date | `TIT2`/`TALB`/`TPE1`/`TRCK`/`TDRC` | corresponding Vorbis fields |

The tag-surgery scripts support MP3 and FLAC only. MPD exposes `grouping` and `genre` as searchable tags.

## Grouping vocabulary

Samuel's grouping vocabulary includes:

- `[Priority]`
- Ratings: `R: 5`, `R: 4.5`, `R: 4`, `R: 3.5`, `R: 3`, and `R: 2.5`
- `Unrated`
- `Overrated`
- `Underrated`
- `<500 ratings`
- `FL`
- `Wall`

Use the spellings already in the files. In particular, the library uses `R: 5`, not `R: 5.0`.

`tag_utils.normalize_grouping()` implements this order:

1. `[Priority]`
2. values beginning with `R:` (reverse lexical order)
3. `Unrated`
4. `Overrated`
5. `Underrated`
6. `<500 ratings`
7. `FL`
8. `Wall`
9. other values, alphabetically

It also deduplicates grouping values because it starts from a set. It does not validate ratings numerically. `music-set-tags`, `music-add-tag`, `music-rename-tag`, and `music-normalize-order` can therefore change grouping order or remove duplicate grouping values.

## Search forms

Use the simple form for case-insensitive substring searches:

```bash
mpc search artist "Artist Name"
mpc search album "Album Name"
mpc search title "Song Title"
mpc search grouping "R: 5"
```

Use `find` for exact, case-sensitive tag values:

```bash
mpc find artist "Artist Name" album "Album Name"
```

Use `searchadd` or `findadd` to add results directly to the queue; preview with `search` first. Search results are tracks, even when the query identifies an album.

## Filter expressions: verified MPD syntax

The MPD filter grammar accepts `==`, `!=`, `contains`, `starts_with`, regex `=~` when PCRE is available, negation, and `AND`. Parenthesize every expression:

```bash
# All tracks carrying both flags.
mpc search '((grouping == "[Priority]") AND (grouping == "Unrated"))'

# 1990s releases. Date is treated as a string.
mpc search '((genre == "Art Rock") AND (date starts_with "199"))'

# Rating 4 or higher among the obscure-release group.
mpc search '((grouping == "<500 ratings") AND (grouping =~ "^R: (4([.]5)?|5)$"))'

# Exclude a flag.
mpc search '(!(grouping == "Overrated"))'
```

Important limitations verified against MPD 0.24:

- `OR` is not accepted; it returns `MPD error: 'AND' expected`. Use a regex or separate searches.
- Numeric date comparisons such as `date >= "1990"` are not accepted. Use `starts_with` or regex.
- Multiple values of one tag are supported, so two `grouping ==` clauses can match two values on one track.

For queueing, replace `search` with `searchadd` or `findadd`:

```bash
mpc searchadd '((grouping == "[Priority]") AND (grouping == "Unrated"))'
```

Adding a 4+ rating without regex is also possible with separate exact searches, but check for duplicates:

```bash
for rating in "R: 4" "R: 4.5" "R: 5"; do
    mpc searchadd grouping "$rating"
done
```

## Queue recipes

```bash
# Add 5-star tracks to the end of the queue.
mpc searchadd grouping "R: 5"

# Add a specific album and artist, case-insensitively.
mpc searchadd artist "Artist Name" album "Album Name"

# Add priority/unrated tracks, then shuffle only if requested.
mpc searchadd '((grouping == "[Priority]") AND (grouping == "Unrated"))'
mpc shuffle

# Replace the queue and play a filtered set only when explicitly requested.
mpc clear && mpc searchadd '((genre == "Art Rock") AND (date starts_with "199"))' && mpc play
```

Do not call the last recipe merely to preview a query: `clear`, `searchadd`, `shuffle`, and `play` mutate playback state.
