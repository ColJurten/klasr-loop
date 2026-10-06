# API image OpenCV runtime libraries handoff

## Change

The API image installs the minimal OpenCV runtime libraries before Python
dependencies:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
```

The checkout had advanced from the supplied `e1f645e` baseline to `feb79ee`.
The exact Dockerfile line was already present in commit `9759bcd`; no version
pins, model pre-cache, guards, or Compose changes were added.

## Build

Command:

```text
docker build -t klasr-api:local apps/api-py
```

Bounded result:

```text
[+] Building 586.8s (13/13) FINISHED
=> [5/8] RUN apt-get update && apt-get install ...  12.9s
=> [6/8] RUN pip install --no-cache-dir .          179.6s
=> naming to docker.io/library/klasr-api:local       0.0s
image=sha256:99fac32b4a71630d011497a547a5e311408b9bbd35be96506901bcd0a5ec8eb1
```

## In-image verification

OpenCV import and RapidOCR initialization:

```text
$ docker run --rm klasr-api:local python -c "import cv2; from rapidocr import RapidOCR; print(cv2.__version__, RapidOCR())"
[RapidOCR] Using engine_name: onnxruntime
5.0.0 <rapidocr.main.RapidOCR object at 0x...>
exit=0
```

Real fixture extraction (`.tmp/hermes/SINGLE-STACK-RUN/doc3.pdf` mounted at
`/fixtures/doc3.pdf`), with result output bounded to metadata and a 160-character
prefix:

```text
{'quality': 'ok', 'text_len': 2904, 'warnings': ['no_dates_found'],
 'text_prefix': '<!-- image -->\n\n## Quotation\n\n## Quote Information\n\n<!-- image -->\n\n787 Brunswick, Los Angeles, CA 50028 support@acme.com / 4444 555 555 787 Brunswick, Los Ange'}
exit=0
```

This satisfies the required `ok|sparse` quality and non-empty extracted text.
