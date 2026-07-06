FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY services/inventory-service ./services/inventory-service

EXPOSE 3003
CMD ["node", "services/inventory-service/src/server.js"]
