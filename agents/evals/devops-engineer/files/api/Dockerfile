FROM node:latest

ARG NPM_TOKEN
WORKDIR /app
COPY . .
COPY .env .env
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc && npm install
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
