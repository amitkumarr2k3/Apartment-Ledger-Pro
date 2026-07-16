.PHONY: up down logs psql seed test reset smoke csv-samples db-backup db-cleanup api-check

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f api

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

