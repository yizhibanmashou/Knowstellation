import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from scripts.knowstellation_pipeline.pipeline import build_from_ocr_jsonl  # noqa: E402


class KnowstellationPipelineTest(unittest.TestCase):
    def test_builds_frontend_contracts_with_source_trace(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            jsonl = root / "sample.jsonl"
            write_sample_jsonl(
                jsonl,
                [
                    """
# Chapter 1 Foundations

Trait mean is introduced first.
$$
z = x + w
$$
(1.1)

Equation (1.1) defines z. The next formula uses z.
$$
y = z + w + 1
$$
(1.2)
""",
                ],
            )

            summary = build_from_ocr_jsonl(
                jsonl_path=jsonl,
                book_id="Synthetic Book",
                source_pdf="synthetic.pdf",
                work_root=root / "pipeline",
            )

            output_dir = Path(summary["output_dir"])
            dependency = read_json(output_dir / "frontend" / "dependency" / "chapter1_dependencies.json")
            formulas = dependency["formulas"]
            self.assertEqual([formula["id"] for formula in formulas], ["formula_1.1", "formula_1.2"])
            self.assertTrue(all(formula.get("source_trace", {}).get("ocr_block_id") for formula in formulas))

            second_dependency = next(item for item in dependency["dependencies"] if item["dependent_id"] == "formula_1.2")
            self.assertTrue(
                any(
                    prereq.get("target_id") == "formula_1.1" and prereq.get("edge_status") == "accepted"
                    for prereq in second_dependency["prerequisites"]
                )
            )

            search_index = read_json(output_dir / "frontend" / "formula_search_index.json")
            self.assertEqual(search_index[0]["id"], "formula_1.1")
            self.assertIn("review_flags", search_index[0])

            report = read_json(output_dir / "quality" / "build_report.json")
            self.assertTrue(report["accuracy_checks"]["formula_ids_unique"])
            self.assertTrue(report["accuracy_checks"]["accepted_edges_reference_existing_formulas"])
            self.assertTrue(report["accuracy_checks"]["every_formula_has_source_trace"])

    def test_low_confidence_formula_is_marked_and_not_accepted_as_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            jsonl = root / "sample.jsonl"
            write_sample_jsonl(
                jsonl,
                [
                    """
# Chapter 1 Noisy OCR

$$
z =
$$

Later formula uses z.
$$
y = z + 1
$$
(1.2)
""",
                ],
            )

            summary = build_from_ocr_jsonl(
                jsonl_path=jsonl,
                book_id="Noisy Book",
                source_pdf="noisy.pdf",
                work_root=root / "pipeline",
            )

            output_dir = Path(summary["output_dir"])
            dependency = read_json(output_dir / "frontend" / "dependency" / "chapter1_dependencies.json")
            low_confidence = next(formula for formula in dependency["formulas"] if formula["id"] == "formula_1.u001")
            self.assertIn("low_confidence_ocr", low_confidence["review_flags"])

            second_dependency = next(item for item in dependency["dependencies"] if item["dependent_id"] == "formula_1.2")
            self.assertFalse(any(prereq.get("target_id") == "formula_1.u001" for prereq in second_dependency["prerequisites"]))
            self.assertTrue(any(item.get("edge_evidence") == "low_confidence_ocr" for item in dependency["ambiguous"]))

            report = read_json(output_dir / "quality" / "build_report.json")
            self.assertTrue(report["accuracy_checks"]["low_confidence_ocr_has_no_accepted_edges"])
            self.assertEqual(report["summaries"]["low_confidence_formula_count"], 1)


def write_sample_jsonl(path: Path, pages: list[str]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for text in pages:
            payload = {
                "result": {
                    "layoutParsingResults": [
                        {
                            "markdown": {
                                "text": text.strip(),
                                "images": {},
                            },
                            "outputImages": {},
                        }
                    ]
                }
            }
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def read_json(path: Path):
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


if __name__ == "__main__":
    unittest.main()
