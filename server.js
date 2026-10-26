require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

// Local development static files. On Vercel, files in /public are also served as static assets.
app.use(express.static(path.join(__dirname, "public")));

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  decimalNumbers: true
};
if (process.env.DB_SSL === "true") {
  dbConfig.ssl = { rejectUnauthorized: true };
}
const pool = mysql.createPool(dbConfig);

function dbNotConfigured() {
  return !process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME;
}
function sendDbError(res, error, publicMessage = "Database request failed") {
  console.error("Database error:", error.message);
  return res.status(500).json({ message: publicMessage });
}
function validPositiveAmount(value) {
  const amount = Number(value);
  return value !== "" && value !== null && value !== undefined && Number.isFinite(amount) && amount > 0;
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.get("/api/health", async (req, res) => {
  try {
    if (dbNotConfigured()) {
      return res.status(503).json({ ok: false, message: "Database environment variables are not configured" });
    }
    await pool.query("SELECT 1");
    return res.json({ ok: true, message: "API and database connected" });
  } catch (error) {
    return sendDbError(res, error, "Database connection failed. Check your hosted database and environment variables.");
  }
});

app.get("/accounts", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, fname, accountNumber, balance, createdAt FROM BankAccount ORDER BY id DESC"
    );
    res.json(rows);
  } catch (error) {
    sendDbError(res, error, "Unable to retrieve accounts. Check that the database tables exist.");
  }
});

app.post("/accounts", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const fname = typeof req.body.fname === "string" ? req.body.fname.trim() : "";
  const openingBalance = Number(req.body.openingBalance);
  if (!name || !fname || req.body.openingBalance === "" || req.body.openingBalance == null || !Number.isFinite(openingBalance) || openingBalance < 0) {
    return res.status(400).json({ message: "Enter a customer name, father's name, and a valid non-negative opening balance." });
  }
  const accountNumber = `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
  const connection = await pool.getConnection().catch(error => {
    console.error("Database connection error:", error.message);
    return null;
  });
  if (!connection) return res.status(500).json({ message: "Database connection failed" });
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      "INSERT INTO BankAccount (name, fname, accountNumber, balance) VALUES (?, ?, ?, ?)",
      [name, fname, accountNumber, openingBalance]
    );
    if (openingBalance > 0) {
      await connection.query(
        "INSERT INTO transactions (accountNumber, type, amount) VALUES (?, 'OPENING', ?)",
        [accountNumber, openingBalance]
      );
    }
    await connection.commit();
    res.status(201).json({ message: "Account created successfully", id: result.insertId, name, fname, accountNumber, balance: openingBalance });
  } catch (error) {
    await connection.rollback();
    sendDbError(res, error, "Unable to create account. Check that the database schema has been imported.");
  } finally {
    connection.release();
  }
});

async function moveMoney(req, res, kind) {
  const accountNumber = String(req.params.accountNumber || "").trim();
  if (!validPositiveAmount(req.body.amount)) {
    return res.status(400).json({ message: `Enter a valid ${kind.toLowerCase()} amount greater than zero.` });
  }
  const amount = Number(req.body.amount);
  const connection = await pool.getConnection().catch(error => {
    console.error("Database connection error:", error.message);
    return null;
  });
  if (!connection) return res.status(500).json({ message: "Database connection failed" });
  try {
    await connection.beginTransaction();
    const updateSql = kind === "DEPOSIT"
      ? "UPDATE BankAccount SET balance = balance + ? WHERE accountNumber = ?"
      : "UPDATE BankAccount SET balance = balance - ? WHERE accountNumber = ? AND balance >= ?";
    const params = kind === "DEPOSIT" ? [amount, accountNumber] : [amount, accountNumber, amount];
    const [result] = await connection.query(updateSql, params);
    if (!result.affectedRows) {
      const [rows] = await connection.query("SELECT accountNumber FROM BankAccount WHERE accountNumber = ?", [accountNumber]);
      await connection.rollback();
      return res.status(rows.length ? 400 : 404).json({ message: rows.length ? "Insufficient balance" : "Account not found" });
    }
    await connection.query("INSERT INTO transactions (accountNumber, type, amount) VALUES (?, ?, ?)", [accountNumber, kind, amount]);
    await connection.commit();
    const [rows] = await connection.query("SELECT balance FROM BankAccount WHERE accountNumber = ?", [accountNumber]);
    return res.json({ message: kind === "DEPOSIT" ? "Deposit successful" : "Withdrawal successful", amount, balance: rows[0].balance });
  } catch (error) {
    await connection.rollback();
    return sendDbError(res, error, `${kind === "DEPOSIT" ? "Deposit" : "Withdrawal"} failed. Check your database schema.`);
  } finally {
    connection.release();
  }
}
app.post("/accounts/:accountNumber/deposit", (req, res) => moveMoney(req, res, "DEPOSIT"));
app.post("/accounts/:accountNumber/withdraw", (req, res) => moveMoney(req, res, "WITHDRAWAL"));

app.get("/accounts/:accountNumber/transactions", async (req, res) => {
  try {
    const [account] = await pool.query("SELECT accountNumber FROM BankAccount WHERE accountNumber = ?", [req.params.accountNumber]);
    if (!account.length) return res.status(404).json({ message: "Account not found" });
    const [rows] = await pool.query(
      "SELECT id, accountNumber, type, amount, createdAt FROM transactions WHERE accountNumber = ? ORDER BY id DESC",
      [req.params.accountNumber]
    );
    res.json(rows);
  } catch (error) {
    sendDbError(res, error, "Unable to retrieve transaction history.");
  }
});

app.get("/accounts/:accountNumber", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, fname, accountNumber, balance, createdAt FROM BankAccount WHERE accountNumber = ?",
      [req.params.accountNumber]
    );
    if (!rows.length) return res.status(404).json({ message: "Account not found" });
    res.json(rows[0]);
  } catch (error) {
    sendDbError(res, error, "Unable to retrieve account details.");
  }
});

app.use((req, res) => res.status(404).json({ message: "API route not found" }));

// Vercel imports the Express app; local Node runs it on PORT.
if (require.main === module) {
  const port = Number(process.env.PORT || 5050);
  app.listen(port, () => console.log(`Banking System API running at http://localhost:${port}`));
}
module.exports = app;
