import { config } from "dotenv";

// Same precedence as Next: .env.local, then .env; fall back to the Docker Compose default.
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL ??= "postgres://seatplanner:seatplanner@localhost:5432/seatplanner";
