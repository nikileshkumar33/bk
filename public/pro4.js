const API_BASE = ""; // Same-origin API: works locally and after deployment.
const $ = (id) => document.getElementById(id);
const accountForm = $("accountForm");
const accountSelect = $("accountSelect");
const accountSummary = $("accountSummary");
const amountInput = $("amount");
const output = $("output");
const transactionHistory = $("transactionHistory");
const messageBox = $("message");
let accounts = [];
let messageTimer;

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function showMessage(text, type = "success") {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
  messageBox.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { messageBox.hidden = true; }, 5000);
}
function handleError(error) {
  console.error(error);
  showMessage(error.message || "Something went wrong. Check the server and database configuration.", "error");
}
async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
  } catch {
    throw new Error("Cannot connect to the server. Check the deployment URL and backend logs.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}
function selectedAccountNumber() {
  return accountSelect.value;
}
function selectedAccount() {
  return accounts.find(account => String(account.accountNumber) === String(selectedAccountNumber()));
}
function renderSummary(account) {
  if (!account) {
    accountSummary.hidden = true;
    accountSummary.replaceChildren();
    return;
  }
  accountSummary.hidden = false;
  accountSummary.innerHTML = `<div><span>Account number</span><strong>${escapeHtml(account.accountNumber)}</strong></div><div><span>Available balance</span><strong>${money(account.balance)}</strong></div>`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
async function loadAccounts(keepSelection = true) {
  const previous = keepSelection ? selectedAccountNumber() : "";
  const data = await apiRequest("/accounts");
  accounts = Array.isArray(data) ? data : [];
  accountSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = accounts.length ? "Select a customer account" : "No accounts yet — create one above";
  accountSelect.appendChild(placeholder);
  accounts.forEach(account => {
    const option = document.createElement("option");
    option.value = account.accountNumber;
    option.textContent = `${account.name} — ${account.accountNumber}`;
    accountSelect.appendChild(option);
  });
  if (accounts.some(account => String(account.accountNumber) === String(previous))) accountSelect.value = previous;
  else if (accounts.length === 1) accountSelect.value = String(accounts[0].accountNumber);
  renderSummary(selectedAccount());
}
function requireAccount() {
  const accountNumber = selectedAccountNumber();
  if (!accountNumber) {
    showMessage("Please select a customer account first.", "error");
    return null;
  }
  return accountNumber;
}
function displayAccount(account) {
  output.innerHTML = `<div class="detail-grid"><div><span>Customer name</span><strong>${escapeHtml(account.name)}</strong></div><div><span>Father's name</span><strong>${escapeHtml(account.fname)}</strong></div><div><span>Account number</span><strong>${escapeHtml(account.accountNumber)}</strong></div><div><span>Current balance</span><strong class="balance-value">${money(account.balance)}</strong></div></div>`;
  renderSummary(account);
}
accountSelect.addEventListener("change", () => {
  renderSummary(selectedAccount());
  transactionHistory.replaceChildren();
  const account = selectedAccount();
  if (account) displayAccount(account);
  else output.innerHTML = '<p class="muted">Choose an account to see details.</p>';
});

accountForm.addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("name").value.trim();
  const fname = $("fname").value.trim();
  const openingBalance = $("openingBalance").value;
  if (!name || !fname || openingBalance === "" || !Number.isFinite(Number(openingBalance)) || Number(openingBalance) < 0) {
    showMessage("Enter valid customer details and a non-negative opening balance.", "error");
    return;
  }
  const submitButton = accountForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await apiRequest("/accounts", { method: "POST", body: JSON.stringify({ name, fname, openingBalance: Number(openingBalance) }) });
    await loadAccounts(false);
    accountSelect.value = String(result.accountNumber);
    renderSummary(result);
    displayAccount(result);
    accountForm.reset();
    showMessage(`Account created. Account number: ${result.accountNumber}`);
  } catch (error) { handleError(error); }
  finally { submitButton.disabled = false; }
});

async function performMoneyOperation(kind) {
  const accountNumber = requireAccount();
  if (!accountNumber) return;
  if (amountInput.value.trim() === "" || !Number.isFinite(Number(amountInput.value)) || Number(amountInput.value) <= 0) {
    showMessage("Enter an amount greater than zero.", "error");
    return;
  }
  const button = $(kind === "deposit" ? "depositBtn" : "withdrawBtn");
  button.disabled = true;
  try {
    const result = await apiRequest(`/accounts/${encodeURIComponent(accountNumber)}/${kind}`, {
      method: "POST", body: JSON.stringify({ amount: Number(amountInput.value) })
    });
    amountInput.value = "";
    await loadAccounts();
    const updated = selectedAccount();
    if (updated) displayAccount(updated);
    showMessage(`${result.message}. Current balance: ${money(result.balance)}`);
  } catch (error) { handleError(error); }
  finally { button.disabled = false; }
}
$("depositBtn").addEventListener("click", () => performMoneyOperation("deposit"));
$("withdrawBtn").addEventListener("click", () => performMoneyOperation("withdraw"));
$("balanceBtn").addEventListener("click", async () => {
  const accountNumber = requireAccount(); if (!accountNumber) return;
  try { const account = await apiRequest(`/accounts/${encodeURIComponent(accountNumber)}`); displayAccount(account); showMessage(`Current balance: ${money(account.balance)}`); }
  catch (error) { handleError(error); }
});
$("detailsBtn").addEventListener("click", async () => {
  const accountNumber = requireAccount(); if (!accountNumber) return;
  try { displayAccount(await apiRequest(`/accounts/${encodeURIComponent(accountNumber)}`)); }
  catch (error) { handleError(error); }
});
$("historyBtn").addEventListener("click", async () => {
  const accountNumber = requireAccount(); if (!accountNumber) return;
  try {
    const rows = await apiRequest(`/accounts/${encodeURIComponent(accountNumber)}/transactions`);
    transactionHistory.replaceChildren();
    if (!rows.length) { transactionHistory.innerHTML = '<p class="muted">No transactions found for this account.</p>'; return; }
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Type</th><th>Amount</th><th>Date</th></tr></thead>";
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      [row.type, money(row.amount), row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"].forEach(value => {
        const td = document.createElement("td"); td.textContent = String(value); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); transactionHistory.appendChild(table);
  } catch (error) { handleError(error); }
});

loadAccounts().catch(handleError);
