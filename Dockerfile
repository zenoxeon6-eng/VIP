FROM node:18-slim

WORKDIR /usr/src/app

# تثبيت المكتبات المطلوبة لعمل النظام بكل كفاءة
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 22214

CMD ["node", "index.js"]
