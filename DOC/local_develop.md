# **Локальная разработка**
### [К оглавлению](index.md)

Требуется Node.js ≥ 18.17 (рекомендуется 20.x) и npm.

```bash
npm i

# prisma
export DATABASE_URL="file:./data/app.db"
npx prisma generate
npx prisma migrate dev --name init

# dev-серверы (в разных терминалах):
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000

# pyproxy (python >= 3.10)
cd apps/pyproxy
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

В проде/в докере Prisma использует путь file:/app/data/app.db.