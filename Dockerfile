# syntax=docker/dockerfile:1.7

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_FACTOR=2
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_PREFER_OFFLINE=true
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_PROGRESS=false

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm,id=yard-api-npm-cache,sharing=locked \
    set -eux; \
    for attempt in 1 2 3 4; do \
      npm ci --omit=dev && break; \
      if [ "$attempt" -eq 4 ]; then exit 1; fi; \
      echo "npm ci failed on attempt $attempt, retrying..."; \
      sleep $((attempt * 10)); \
    done

COPY src ./src

EXPOSE 9898

CMD ["npm", "run", "start"]
