FROM node:22-bookworm-slim AS builder

WORKDIR /home/node/provision-server

# Install all dependencies (including devDependencies for tsc)
COPY provision-server/package.json provision-server/package-lock.json* ./
RUN npm install

# Copy source and compile
COPY provision-server/src/ ./src/
COPY provision-server/tsconfig.json ./
RUN npx tsc

# --- Production image ---
FROM node:22-bookworm-slim

# Install openclaw globally
RUN npm install -g openclaw@latest

# Create app user workspace
RUN mkdir -p /home/node/.openclaw/workspace/skills \
    /home/node/.openclaw/agents \
    /home/node/provision-server \
    && chown -R node:node /home/node

WORKDIR /home/node/provision-server

# Install production deps only
COPY --chown=node:node provision-server/package.json provision-server/package-lock.json* ./
RUN npm install --omit=dev

# Copy compiled JS from builder
COPY --from=builder /home/node/provision-server/dist ./dist

# Copy OpenClaw base config and skill
COPY --chown=node:node openclaw.json /home/node/.openclaw/openclaw.json
COPY --chown=node:node clawcity.skill.ts /home/node/.openclaw/workspace/skills/clawcity.skill.ts

# Copy startup script
COPY --chown=node:node startup.sh /home/node/startup.sh
RUN chmod +x /home/node/startup.sh

USER node

# Gateway port + provisioning API port
EXPOSE 18789 18800

CMD ["/home/node/startup.sh"]
