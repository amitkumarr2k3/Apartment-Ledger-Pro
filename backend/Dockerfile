FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY package-lock.json ./
RUN npm install -g npm@11.19.1 && \
	npm ci --legacy-peer-deps
COPY src ./src
COPY db ./db
COPY scripts ./scripts
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache \
	python3 \
	py3-pip \
	py3-pandas \
	py3-openpyxl \
	py3-yaml
RUN python3 -m pip install --no-cache-dir --break-system-packages xlrd
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY package.json ./
EXPOSE 4000
CMD ["sh", "./docker-entrypoint.sh", "server"]
