FROM python:3.13-slim@sha256:58c30f5bfaa718b5803a53393190b9c68bd517c44c6c94c1b6c8c172bcfad040
WORKDIR /app
COPY apps/pyproxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --require-hashes
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY apps/pyproxy /app
EXPOSE 8080
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8080"]
