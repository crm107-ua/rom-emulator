"""Cola simple de descargas ROM (progreso para IPC / UI web)."""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import unquote, urlparse

import requests

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _set(job_id: str, **fields: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = time.time()


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def list_jobs() -> list[dict[str, Any]]:
    with _lock:
        return [dict(j) for j in _jobs.values()]


def create_download_job(
    *,
    download_url: str,
    dest_dir: str,
    filename: Optional[str] = None,
    referer: str = "",
    session: Optional[requests.Session] = None,
    on_done: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    dest = Path(dest_dir).expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)

    if not filename:
        path = urlparse(download_url).path
        filename = unquote(path.rstrip("/").split("/")[-1]) or "rom.bin"
    # Sanitize filename
    filename = "".join(c for c in filename if c not in '<>:"/\\|?*').strip() or "rom.bin"

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "status": "queued",
        "download_url": download_url,
        "dest_dir": str(dest),
        "filename": filename,
        "path": str(dest / filename),
        "bytes_done": 0,
        "bytes_total": None,
        "error": None,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    with _lock:
        _jobs[job_id] = job

    def worker() -> None:
        part = dest / (filename + ".part")
        final = dest / filename
        _set(job_id, status="running")
        try:
            headers = {}
            if referer:
                headers["Referer"] = referer
            s = session or requests.Session()
            with s.get(download_url, headers=headers, stream=True, timeout=120, allow_redirects=True) as r:
                r.raise_for_status()
                total = r.headers.get("Content-Length")
                total_n = int(total) if total and total.isdigit() else None
                _set(job_id, bytes_total=total_n)
                done = 0
                with open(part, "wb") as f:
                    for chunk in r.iter_content(65536):
                        if not chunk:
                            continue
                        f.write(chunk)
                        done += len(chunk)
                        _set(job_id, bytes_done=done)
            part.replace(final)
            result = {
                "id": job_id,
                "status": "done",
                "path": str(final),
                "filename": filename,
                "bytes_done": done,
                "bytes_total": total_n or done,
            }
            _set(job_id, **result, error=None)
            if on_done:
                on_done(result)
        except Exception as e:
            try:
                if part.exists():
                    part.unlink()
            except OSError:
                pass
            _set(job_id, status="error", error=str(e))

    threading.Thread(target=worker, daemon=True).start()
    return dict(job)
