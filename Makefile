.SILENT:

all: build

build:
	npm run lint
	npm --workspace apps/api run test:ci
	docker compose -f docker-compose.build.yml build --no-cache
	docker compose -f docker-compose.build.single.yml build --no-cache

generate_py_req:
	docker run --rm -v "$PWD/apps/pyproxy:/app" -w /app python:3.14-slim sh -lc 'pip install --no-cache-dir pip-tools && pip-compile --generate-hashes --output-file=requirements.txt requirements.in'
