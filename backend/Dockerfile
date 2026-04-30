FROM python:3.13-slim
WORKDIR /app

RUN apt-get update && apt-get install -y tk && rm -rf /var/lib/apt/lists/* \
    && addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data \
    && chmod +x entrypoint.sh \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 5001

CMD ["./entrypoint.sh"]