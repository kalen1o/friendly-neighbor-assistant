FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --fetch-timeout=600000 --fetch-retries=3

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
