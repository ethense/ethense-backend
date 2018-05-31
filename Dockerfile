FROM node:8.11.2-alpine

WORKDIR /app
COPY package.json package-lock.json yarn.lock ./
RUN npm install -g -s --no-progress yarn \
  && yarn install
COPY . .
RUN npm run lint \
  && rm -f /app/Dockerfile /app/.dockerignore

CMD ["yarn", "start"]
