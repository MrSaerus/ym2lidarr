FROM python:3.13-slim@sha256:27f90d79cc85e9b7b2560063ef44fa0e9eaae7a7c3f5a9f74563065c5477cc24
WORKDIR /app
COPY apps/pyproxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --require-hashes
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY apps/pyproxy /app
EXPOSE 8080
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8080"]
