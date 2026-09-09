.PHONY: up up-local up-prod up-images down down-local down-prod down-images logs logs-local logs-prod logs-images psql seed test reset smoke csv-samples db-backup db-cleanup api-check image-pack image-load release-vm

up:
	docker compose up -d --build

up-local:
	docker compose -f docker-compose.yml up -d --build

up-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml up -d --build

up-images:
	docker compose -f docker-compose.yml -f docker-compose.images.yml up -d

down:
	docker compose down

down-local:
	docker compose -f docker-compose.yml down

down-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml down

down-images:
	docker compose -f docker-compose.yml -f docker-compose.images.yml down

logs:
	docker compose logs -f api

logs-local:
	docker compose -f docker-compose.yml logs -f web api ssr

logs-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml logs -f web api ssr

logs-images:
	docker compose -f docker-compose.yml -f docker-compose.images.yml logs -f web api ssr

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

image-pack:
	./scripts/build-release-images.sh

image-load:
	./scripts/load-release-images.sh

# One-command release to VM (example):
# make release-vm HOST=azureuser@1.2.3.4 KEY=~/.ssh/apf_vm TAG=2026.09.08 MODE=prod
release-vm:
	./scripts/release-to-vm.sh --host "$(HOST)" --key "$(KEY)" --tag "$(TAG)" --mode "$(MODE)" --env-file "$${ENV_FILE:-.env}" --project-name "$${PROJECT_NAME:-apartment-ledger-pro}" --remote-dir "$${REMOTE_DIR:-deploy}"

# API endpoint checklist — verifies every screen's required endpoints exist and return the expected shape.
# Set APF_TOKEN=... (from a logged-in session) to check authed endpoints.
api-check:
	APF_API=$${APF_API:-http://localhost:4010} node scripts/api-endpoint-checklist.mjs

