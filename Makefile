.PHONY: up up-local up-prod down down-local down-prod logs logs-local logs-prod psql seed test reset smoke csv-samples db-backup db-cleanup api-check

up:
	docker compose up -d --build

up-local:
	docker compose -f docker-compose.yml up -d --build

up-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml up -d --build

down:
	docker compose down

down-local:
	docker compose -f docker-compose.yml down

down-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml down

logs:
	docker compose logs -f api

logs-local:
	docker compose -f docker-compose.yml logs -f web api ssr

logs-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml logs -f web api ssr

psql:
	docker compose exec db psql -U apf -d apartment_finance

seed:
	docker compose run --rm migrate node dist/scripts/seed.js

test:
	docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm test

reset:
	docker compose down -v
	docker compose up -d --build

smoke:
	./scripts/smoke-test.sh

csv-samples:
	node scripts/generate-sample-csvs.mjs

db-backup:
	./scripts/db-cleanup.sh --backup-only

db-cleanup:
	./scripts/db-cleanup.sh

# API endpoint checklist — verifies every screen's required endpoints exist and return the expected shape.
# Set APF_TOKEN=... (from a logged-in session) to check authed endpoints.
api-check:
	APF_API=$${APF_API:-http://localhost:4010} node scripts/api-endpoint-checklist.mjs

