FROM node:24-alpine AS builder

ARG VITE_MODE=production

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build -- --mode $VITE_MODE

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]