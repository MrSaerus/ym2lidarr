FROM python:3.14-slim@sha256:0aecac02dc3d4c5dbb024b753af084cafe41f5416e02193f1ce345d671ec966e
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    make \
    rustc \
    cargo \
    ca-certificates  \
    wget \
 && rm -rf /var/lib/apt/lists/*
COPY apps/pyproxy/requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
     && pip install --no-cache-dir -r requirements.txt --require-hashes
COPY apps/pyproxy /app
EXPOSE 8080
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8080"]
