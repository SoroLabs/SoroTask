FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js server.js ./

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

CMD ["npm", "start"]
