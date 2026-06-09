# Formula Atlas Pipeline

Offline builder for turning a formula-heavy textbook PDF into the static JSON
contracts used by the Formula Atlas frontend.

## OCR

The OCR stage uses the AIStudio PaddleOCR jobs API and the model requested for
this project:

```text
PaddleOCR-VL-1.6
```

Put the token in the local root `.env` file. Do not commit it.

```powershell
PADDLEOCR_AISTUDIO_TOKEN=...
```

Capture OCR output:

```powershell
python -m scripts.formula_atlas_pipeline capture `
  --book-id my-book `
  --input path\to\book.pdf
```

Build from existing JSONL:

```powershell
python -m scripts.formula_atlas_pipeline build `
  --book-id my-book `
  --jsonl data\formula_atlas_pipeline\my-book\ocr_raw\result.jsonl
```

Add `--publish` to copy generated files into `data/frontend` and `public/data`.
Publishing overwrites generated files but does not delete unrelated local files.
