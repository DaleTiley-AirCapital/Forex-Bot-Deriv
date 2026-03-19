import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { startScheduler } from "./lib/scheduler.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production (Docker), serve the built React frontend from the same process.
// This removes the need for a separate nginx container.
if (process.env.SERVE_FRONTEND === "true") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Vite outputs to dist/public — path inside the Docker image
  const frontendDist = path.resolve(__dirname, "../../deriv-quant/dist/public");

  app.use(express.static(frontendDist));

  // For any non-API route, return index.html so the React router works

  app.get(/.*/, (_req, res) => {

    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Start the signal scheduler (runs every 30s)
startScheduler();

export default app;
