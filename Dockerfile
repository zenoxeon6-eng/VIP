FROM node:18-slim

WORKDIR /usr/src/app

# تثبيت git بالإضافة للمكتبات المطلوبة لعمل النظام
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 22214

CMD ["node", "index.js"]
