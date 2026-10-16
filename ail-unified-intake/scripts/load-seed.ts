// 使い方: DATABASE_PATH=... tsx scripts/load-seed.ts <seed.sql>
import { readFileSync } from "node:fs";
const { db, migrate } = await import("../src/db.js");
migrate();
const file = process.argv[2] || "db/seed.pilot-rehearsal.sql";
db.exec(readFileSync(file, "utf8"));
console.log(`seeded from ${file}`);
db.close();
