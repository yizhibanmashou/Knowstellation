from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .io_utils import write_json, write_text


DEFAULT_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
DEFAULT_MODEL = "PaddleOCR-VL-1.6"
DEFAULT_OPTIONAL_PAYLOAD = {
    "useDocOrientationClassify": False,
    "useDocUnwarping": False,
    "useChartRecognition": False,
}
ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class OCRJobResult:
    job_id: str
    state_payload: dict[str, Any]
    jsonl_url: str


class AistudioPaddleOCRClient:
    """Small wrapper around the AIStudio PaddleOCR-VL jobs API.

    Tokens are intentionally accepted only as runtime values. Callers should
    pass ``PADDLEOCR_AISTUDIO_TOKEN`` or another env-var value, never commit it.
    """

    def __init__(
        self,
        token: str,
        *,
        job_url: str = DEFAULT_JOB_URL,
        model: str = DEFAULT_MODEL,
        optional_payload: dict[str, Any] | None = None,
        timeout_seconds: int = 3600,
        poll_interval_seconds: int = 5,
    ) -> None:
        if not token:
            raise ValueError("PaddleOCR AIStudio token is required.")
        self.token = token
        self.job_url = job_url
        self.model = model
        self.optional_payload = optional_payload or dict(DEFAULT_OPTIONAL_PAYLOAD)
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"bearer {self.token}"}

    def submit(self, file_path_or_url: str) -> str:
        import requests

        if file_path_or_url.startswith("http"):
            headers = {**self.headers, "Content-Type": "application/json"}
            payload = {
                "fileUrl": file_path_or_url,
                "model": self.model,
                "optionalPayload": self.optional_payload,
            }
            response = requests.post(self.job_url, json=payload, headers=headers, timeout=120)
        else:
            path = Path(file_path_or_url)
            if not path.is_file():
                raise FileNotFoundError(path)
            data = {
                "model": self.model,
                "optionalPayload": json.dumps(self.optional_payload),
            }
            with path.open("rb") as fh:
                response = requests.post(
                    self.job_url,
                    headers=self.headers,
                    data=data,
                    files={"file": fh},
                    timeout=120,
                )
        response.raise_for_status()
        payload = response.json()
        try:
            return str(payload["data"]["jobId"])
        except KeyError as exc:
            raise RuntimeError(f"PaddleOCR response did not include data.jobId: {payload}") from exc

    def poll(self, job_id: str) -> OCRJobResult:
        import requests

        deadline = time.time() + self.timeout_seconds
        while True:
            if time.time() > deadline:
                raise TimeoutError(f"PaddleOCR job {job_id} did not finish within {self.timeout_seconds}s.")
            response = requests.get(f"{self.job_url}/{job_id}", headers=self.headers, timeout=120)
            response.raise_for_status()
            payload = response.json()
            data = payload.get("data") or {}
            state = data.get("state")
            if state == "done":
                jsonl_url = ((data.get("resultUrl") or {}).get("jsonUrl") or "")
                if not jsonl_url:
                    raise RuntimeError(f"PaddleOCR job {job_id} finished without a JSONL URL.")
                return OCRJobResult(job_id=job_id, state_payload=payload, jsonl_url=jsonl_url)
            if state == "failed":
                raise RuntimeError(f"PaddleOCR job {job_id} failed: {data.get('errorMsg') or payload}")
            time.sleep(self.poll_interval_seconds)

    def download_jsonl(self, result: OCRJobResult, output_path: Path) -> None:
        import requests

        response = requests.get(result.jsonl_url, timeout=300)
        response.raise_for_status()
        write_text(output_path, response.text if response.text.endswith("\n") else response.text + "\n")

    def capture(self, file_path_or_url: str, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "provider": "aistudio-paddleocr-jobs",
            "job_url": self.job_url,
            "model": self.model,
            "optional_payload": self.optional_payload,
            "token_source": "runtime-env",
            "input": file_path_or_url if file_path_or_url.startswith("http") else str(Path(file_path_or_url).resolve()),
        }
        write_json(output_dir / "ocr_request_manifest.json", manifest)
        job_id = self.submit(file_path_or_url)
        result = self.poll(job_id)
        write_json(output_dir / "ocr_job_result.json", result.state_payload)
        jsonl_path = output_dir / "result.jsonl"
        self.download_jsonl(result, jsonl_path)
        extract_markdown_assets(jsonl_path, output_dir / "markdown_pages")
        return jsonl_path


def token_from_env(env_name: str = "PADDLEOCR_AISTUDIO_TOKEN") -> str:
    load_root_dotenv()
    return os.environ.get(env_name, "")


def load_root_dotenv(path: Path | None = None) -> None:
    dotenv = path or ROOT / ".env"
    if not dotenv.is_file():
        return
    try:
        lines = dotenv.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and os.environ.get(key) is None:
            os.environ[key] = value.strip().strip('"').strip("'")


def extract_markdown_assets(jsonl_path: Path, output_dir: Path) -> list[Path]:
    """Extract page Markdown text from AIStudio JSONL for audit/debugging.

    Images are deliberately not downloaded here; the pipeline is formula-first
    and keeps image URLs in the raw JSONL for traceability.
    """

    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    page_index = 0
    with jsonl_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            payload = json.loads(line)
            results = ((payload.get("result") or {}).get("layoutParsingResults") or [])
            for result in results:
                markdown = ((result.get("markdown") or {}).get("text") or "")
                path = output_dir / f"page_{page_index:04d}.md"
                write_text(path, markdown)
                written.append(path)
                page_index += 1
    return written
