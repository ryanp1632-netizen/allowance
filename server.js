// Allowance web server.
// Right now it only serves the dashboard page and a status endpoint;
// guardrails, the agent and PayPal payments get added step by step.
import express from 'express';
import { configStatus, assertSandboxEnv } from './src/config.js';

// Safety lock: refuse to start unless PayPal is the sandbox (fake money).
try {
  assertSandboxEnv();
} catch (e) {
  console.error(`\nAllowance will not start: ${e.message}\n`);
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Tells the dashboard which keys are set (true/false only, never the values).
app.get('/api/status', (req, res) => res.json(configStatus()));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Allowance running at http://localhost:${port}`));
