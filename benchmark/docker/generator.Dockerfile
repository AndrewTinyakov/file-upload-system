FROM node:24.11.1-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v1.56.1-noble
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /bench
COPY benchmark/package*.json ./
RUN npm ci
COPY package.json package-lock.json /src/
COPY client/package.json /src/client/package.json
RUN cd /src && npm ci --ignore-scripts
COPY client/src /src/client/src
COPY tests/system /src/tests/system
COPY benchmark /bench
RUN node src/build.mjs
ENTRYPOINT ["node", "src/run.mjs"]
