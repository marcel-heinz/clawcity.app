FROM node:22-bookworm-slim

# Install openclaw globally
RUN npm install -g openclaw@stable

# Create app user workspace
RUN mkdir -p /home/node/.openclaw/workspace/skills \
    /home/node/.openclaw/agents \
    /home/node/provision-server \
    && chown -R node:node /home/node

WORKDIR /home/node/provision-server

# Copy provisioning server
COPY --chown=node:node provision-server/package.json ./
RUN npm install --omit=dev

COPY --chown=node:node provision-server/src/ ./src/
COPY --chown=node:node provision-server/tsconfig.json ./
RUN npx tsc

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
