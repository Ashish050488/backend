# Backend Dockerfile
FROM node:20-alpine

# Install Docker CLI for dockerode
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /opt/saas/data

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
