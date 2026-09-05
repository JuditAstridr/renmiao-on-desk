"use strict";

const readline = require("node:readline");
const { hashPassword } = require("./auth-core");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] !== "hash-password") {
    console.error("Usage: node cloud/api/cli.js hash-password");
    process.exitCode = 2;
    return;
  }
  const password = await ask("Password to hash: ");
  process.stdout.write(`${await hashPassword(password)}\n`);
}

if (require.main === module) main();

module.exports = { main };
