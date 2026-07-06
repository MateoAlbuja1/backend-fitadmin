FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY services/auth-service ./services/auth-service

EXPOSE 3001
CMD ["node", "services/auth-service/src/server.js"]
