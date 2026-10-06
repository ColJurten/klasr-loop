FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
COPY src src
RUN pip install --no-cache-dir .
COPY alembic.ini .
COPY alembic alembic
ENV PYTHONPATH=/app/src KLASR_CONTAINER=true CREWAI_DISABLE_TELEMETRY=true OTEL_SDK_DISABLED=true
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001", "--app-dir", "src"]
