FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY db ./db
COPY scripts ./scripts
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY package.json ./
EXPOSE 4000
CMD ["sh", "./docker-entrypoint.sh", "server"]
