FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY services/report-service ./services/report-service

EXPOSE 3004
CMD ["node", "services/report-service/src/server.js"]
