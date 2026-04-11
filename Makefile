.SILENT:

all: build

build_local:
	npm ci
	npx prisma generate --config prisma.config.ts
	npm --workspace apps/api run build

build:
	npm run lint
	npm --workspace apps/api run test:ci
	docker compose -f docker-compose.build.yml build --no-cache
	docker compose -f docker-compose.build.single.yml build --no-cache

generate_py_req:
	docker run --rm -v "$PWD/apps/pyproxy:/app" -w /app python:3.14-slim sh -lc 'pip install --no-cache-dir pip-tools && pip-compile --generate-hashes --output-file=requirements.txt requirements.in'

clean:
	rm -rf apps/**/dist/ apps/api/coverage apps/api/reports apps/api/junit.xml  apps/web/.next apps/web/out apps/pyproxy/.venv apps/pyproxy/__pycache__ apps/pyproxy/requirements.in apps/web/node_modules apps/api/node_modules apps/web/public/example.js apps/api/src/generated node_modules
