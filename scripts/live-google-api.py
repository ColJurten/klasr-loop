"""Run FastAPI with the acceptance-only, content-free Drive mutation audit."""

import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api-py/src"))

from services.drive import GoogleDriveExecutor  # noqa: E402

move_and_rename = GoogleDriveExecutor.move_and_rename


async def audited_move_and_rename(self, command):
    log = os.environ.get("KLASR_DRIVE_MUTATION_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as stream:
            stream.write("files.update\n")
    return await move_and_rename(self, command)


GoogleDriveExecutor.move_and_rename = audited_move_and_rename

from main import app  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]))
