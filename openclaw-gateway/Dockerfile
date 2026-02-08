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

# Install git (required by openclaw's npm dependency on libsignal-node)
# and configure git to use HTTPS instead of SSH for GitHub
# (the baileys WhatsApp lib references a git+ssh:// dep we can't auth)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --system --add url."https://github.com/".insteadOf "git@github.com:"

# Install openclaw globally
RUN npm install -g openclaw@latest

# Create app user workspace (including all dirs gateway needs at runtime)
RUN mkdir -p /home/node/.openclaw/workspace/skills \
    /home/node/.openclaw/agents \
    /home/node/.openclaw/canvas \
    /home/node/.openclaw/cron \
    /home/node/provision-server \
    && chown -R node:node /home/node

WORKDIR /home/node/provision-server

# Install production deps only
COPY provision-server/package.json provision-server/package-lock.json* ./
RUN npm install --omit=dev

# Copy compiled JS from builder
COPY --from=builder /home/node/provision-server/dist ./dist

# Copy OpenClaw base config and skill to defaults dir (outside volume mount)
# Railway volume at /home/node/.openclaw/ overlays Docker-build files,
# so startup.sh seeds these into the volume at boot
RUN mkdir -p /home/node/defaults
COPY openclaw.json /home/node/defaults/openclaw.json
COPY clawcity.skill.ts /home/node/defaults/clawcity.skill.ts

# Copy startup script
COPY startup.sh /home/node/startup.sh
RUN chmod +x /home/node/startup.sh

# Run as root so startup.sh can fix volume permissions, then drop to node
EXPOSE 18789 18800

CMD ["/home/node/startup.sh"]
