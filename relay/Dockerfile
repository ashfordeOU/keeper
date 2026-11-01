# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Keeper Relay. Build the bundle first (node relay/build.mjs), then:
#   docker build -t keeper-relay relay && docker run -p 8080:8080 keeper-relay
FROM node:22-alpine
WORKDIR /app
COPY dist/keeper-relay.mjs .
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "keeper-relay.mjs"]
