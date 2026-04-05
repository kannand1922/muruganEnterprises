const path = require("path");
const { PrismaClient } = require("../generated/central-client");

const centralDatabasePath = path.resolve(
  __dirname,
  "../../shared/data/stock/central_master.sqlite"
);

const centralPrisma = new PrismaClient({
  log: ["warn", "error"],
  datasources: {
    db: {
      url: `file:${centralDatabasePath}`,
    },
  },
});

module.exports = { centralPrisma };
