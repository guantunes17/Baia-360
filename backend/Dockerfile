FROM python:3.13-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001

# Gunicorn em produção — 4 workers, timeout maior para SSE do Atlas
CMD ["gunicorn", "app:app", \
     "--bind", "0.0.0.0:5001", \
     "--workers", "4", \
     "--timeout", "120", \
     "--worker-class", "sync"]