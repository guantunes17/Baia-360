FROM python:3.13-slim
WORKDIR /app

RUN apt-get update && apt-get install -y tk curl && rm -rf /var/lib/apt/lists/* \
    && addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data \
    && chmod +x entrypoint.sh entrypoint_central.sh \
    && chown -R appuser:appgroup /app

USER appuser

# Uma imagem, dois processos possíveis (Fase 5 — ver docker-compose.prod.yml):
# Atlas usa o CMD default abaixo; Central sobrescreve com
# command: ["./entrypoint_central.sh"] no compose.
EXPOSE 5001 5003

CMD ["./entrypoint.sh"]