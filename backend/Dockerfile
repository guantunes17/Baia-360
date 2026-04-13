FROM python:3.13-slim
WORKDIR /app

RUN apt-get update && apt-get install -y tk && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 5001

CMD ["./entrypoint.sh"]