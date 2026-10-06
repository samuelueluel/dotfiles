# doc-read Troubleshooting and Layout

**Load this file when** `doc-read` exits with an error, the Surya server will not start, OCR output looks wrong or empty, or you need the work-directory layout or exit codes.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 2 | Bad arguments, a missing file, or a missing Python | Check the path. `DOC_READ_PYTHON` overrides the interpreter (default `~/surya-spike-venv/bin/python`). |
| 3 | The file cannot be opened: password-protected PDF, unreadable image, pandoc failure, legacy Office format, unsupported type | Ask Samuel for an unlocked or exported copy. |
| 4 | OCR cannot start: Surya GGUF or CLI missing, `zotero-vlm-rocm` holds the GPU, or the server did not become ready | Report the message. Do not stop other containers. |
| 5 | `surya_ocr` failed on a chunk | Read `<workdir>/ocr.log`. Rerunning resumes after the last finished chunk. |
| 6 | More than 150 pages need OCR | Ask Samuel, then rerun with `--many`. |
| 130 | Interrupted | Rerun the same command to resume. |

## Work directory layout

`~/.cache/doc-read/<stem>-<sha8>/`:

- `original.<ext>`: a read-only copy of the source file.
- `manifest.json`: file type, SHA-256, and one record per page. Each record holds `flags`, `needs_ocr`, `structured`, `rotation`, and `ocr`, which contains block counts, the layer comparison, and `second_reading` on scans. The manifest also lists embedded-image `units` for office files and any warnings.
- `report.txt`: the latest printed report. `best.md`: the reading file.
- `pages/pNNNN.native.txt` and `pages/pNNNN.ocr.md`: one file per page and layer; `pages/mNNNN.ocr.md` for embedded images.
- `native.md`: pandoc Markdown, for office and text files only.
- `render/`: page PNGs for viewing (1568 px long side). `crops/pNNNN-KK-<label>.png`: tables, figures, and forms cut from the 192-dpi OCR render (`ocr-src/`), using Surya's block boxes. Blocks smaller than 120 px are skipped. `media/` and `media-png/`: embedded images from office files.
- `ocr-raw/cNNN/`: Surya's raw `results.json` for each chunk. `ocr.log`: the Surya CLI log.

## Page flags (PDF)

| Flag | Meaning | Effect |
|---|---|---|
| `no_text`, `low_text` | No usable text layer | OCR is the only source |
| `scan_text_layer` | Full-page image with an old OCR layer | Surya replaces it; the old layer becomes a second reading |
| `garbled` | Over 2% broken characters | OCR is the only source |
| `rotatedN` | Sideways text | Rendered upright for OCR and viewing |
| `table`, `math`, `columns`, `images`, `numeric_dense` | Structure that the text layer flattens | OCR'd even in long PDFs |

## How the layer check works

- On born-digital pages, the check compares the numbers, decimals, and words (four or more letters) in the text layer and in Surya's output. A page is marked `differ` when more than 2% of numbers differ, when two or more decimals differ, or when more than 4% of printed words are missing from OCR.
- On a figure page, `differ` usually means chart axis labels that OCR does not transcribe. On a table or text page, it usually means Surya dropped content.
- On scans, `second_reading` compares only numbers with three or more digits or a decimal point, because old OCR layers miss footnote markers. Agreement means both readings found the same numbers. It does not prove that each number sits in the right cell.
- Surya's confidence scores stay near 0.99 even when the output is broken. Do not use them.

## Known Surya failure modes

- Side-by-side tables can lose the right-hand panel. Very wide tables (more than 10 columns) can be truncated or get repeated rows. A long reference list can be cut off partway down the page.
- Stata-style output tables can lose their row labels. Diagram and chart text is not transcribed.
- A table crop viewed directly usually shows what full-page OCR dropped. On Sandler 2017 p. 10, the crop showed the full Table 13 even though OCR had lost its right panel.
- A table that Surya did not label `Table` gets no crop. Use `render --crop` for it.

## Server problems

- `podman logs doc-read-surya` shows why a start failed. The script removes its own container afterwards.
- If a hard kill left `doc-read-surya` behind, run `podman rm -f doc-read-surya`. This touches only that container.
- A healthy server on `:18090` is the Zotero batch's `zotero-surya`. OCR is slower while a batch is running.

## Format edge cases

- Image formats depend on ImageMagick's delegates; check with `magick -list format | grep -iE 'heic|avif'`. If HEIC (iPhone photos) or AVIF is missing, `ingest` fails with exit code 3. Ask Samuel for a JPG or PNG export.
- Pandoc's XLSX reader turns each sheet into a table and loses formulas and formatting. Check that every sheet appears.
- Embedded images smaller than 200 px on a side are skipped as icons. EMF/WMF images that ImageMagick cannot convert are listed as warnings.
