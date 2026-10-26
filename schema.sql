CREATE DATABASE IF NOT EXISTS bank_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bank_db;

CREATE TABLE IF NOT EXISTS BankAccount (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  fname VARCHAR(100) NOT NULL,
  accountNumber VARCHAR(32) NOT NULL,
  balance DECIMAL(13,2) NOT NULL DEFAULT 0.00,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bankaccount_accountNumber (accountNumber)
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  accountNumber VARCHAR(32) NOT NULL,
  type ENUM('OPENING','DEPOSIT','WITHDRAWAL') NOT NULL,
  amount DECIMAL(13,2) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transactions_accountNumber (accountNumber),
  CONSTRAINT fk_transactions_accountNumber
    FOREIGN KEY (accountNumber) REFERENCES BankAccount(accountNumber)
    ON UPDATE CASCADE ON DELETE CASCADE
);
