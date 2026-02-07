const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { stockLensPaths } = require("./path/path");

const filePath = stockLensPaths.brandsCsv;

function testReadBrandsCsv() {
  let rawData = "";

  const stream = fs.createReadStream(filePath);
  
  stream.on("data", (chunk) => {
    rawData += chunk.toString("utf8");
  });

  stream.on("end", () => {
    const lines = rawData.split(/\r?\n/).filter((line) => line.trim() !== "");
    
    console.log(`Total lines read: ${lines.length}`);
    
    if (lines.length < 5) {
      console.log("File too short");
      return;
    }

    const tableLines = lines.slice(3).join("\n");
    const results = [];

    Readable.from(tableLines)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        console.log(`Parsed rows: ${results.length}`);
        console.log("First 5 rows:", results.slice(0, 5));
        
        // Check for missing data
        // Expected rows = Total lines - 3 (headers) - 1 (header row itself) ? 
        // lines.slice(3) includes the header row.
        // So results should be lines.length - 3 - 1 (header).
        // Let's verify.
        const expectedCount = lines.length - 4; // 3 metadata lines + 1 header line
        console.log(`Expected count (approx): ${expectedCount}`);
        
        if (results.length !== expectedCount) {
             console.log(`MISMATCH! Missing ${expectedCount - results.length} rows.`);
        }
      })
      .on("error", (err) => {
        console.error("CSV Parse Error:", err);
      });
  });
}

testReadBrandsCsv();
