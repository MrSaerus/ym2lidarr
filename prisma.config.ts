// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./apps/api/src/prisma/database";

export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  migrations: {
    path: "apps/api/prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});