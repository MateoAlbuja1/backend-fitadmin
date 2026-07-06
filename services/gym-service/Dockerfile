FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY services/gym-service ./services/gym-service

EXPOSE 3002
CMD ["node", "services/gym-service/src/server.js"]
