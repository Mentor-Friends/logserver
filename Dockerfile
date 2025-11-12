FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
# RUN npm ci --only=production
RUN npm install

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Copy only built files and node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server.js"]