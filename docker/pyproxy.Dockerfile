FROM python:3.13-slim@sha256:5f55cdf0c5d9dc1a415637a5ccc4a9e18663ad203673173b8cda8f8dcacef689
WORKDIR /app
COPY apps/pyproxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --require-hashes
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY apps/pyproxy /app
EXPOSE 8080
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8080"]
