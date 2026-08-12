FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY app/__init__.py app/__init__.py
RUN pip install --no-cache-dir -e ".[dev]"

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "app.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
