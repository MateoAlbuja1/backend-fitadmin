FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway

EXPOSE 3000
CMD ["node", "services/api-gateway/src/server.js"]
