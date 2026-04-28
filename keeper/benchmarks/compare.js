const fs = require('fs');

function parseResult(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const map = new Map();
    data.results.forEach(r => {
      map.set(r.name, r);
    });
    return { name: data.name, date: data.date, map };
  } catch (err) {
    console.error(`Error reading or parsing ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function compare(oldFile, newFile) {
  const oldData = parseResult(oldFile);
  const newData = parseResult(newFile);

  console.log(`\nComparing Benchmarks for: ${oldData.name}`);
  console.log(`Old Run: ${oldData.date}`);
  console.log(`New Run: ${newData.date}`);
  console.log('----------------------------------------------------------------------------------');
  console.log(`| ${'Test Name'.padEnd(35)} | ${'Old Ops/Sec'.padEnd(15)} | ${'New Ops/Sec'.padEnd(15)} | ${'Diff %'.padEnd(8)} |`);
  console.log('----------------------------------------------------------------------------------');

  for (const [name, newResult] of newData.map.entries()) {
    const oldResult = oldData.map.get(name);
    if (!oldResult) {
      console.log(`| ${name.padEnd(35)} | ${'N/A'.padEnd(15)} | ${newResult.ops.toString().padEnd(15)} | ${'N/A'.padEnd(8)} |`);
      continue;
    }

    const diff = ((newResult.ops - oldResult.ops) / oldResult.ops) * 100;
    const diffStr = diff > 0 ? `+${diff.toFixed(2)}%` : `${diff.toFixed(2)}%`;
    
    console.log(`| ${name.padEnd(35)} | ${oldResult.ops.toString().padEnd(15)} | ${newResult.ops.toString().padEnd(15)} | ${diffStr.padEnd(8)} |`);
  }
  console.log('----------------------------------------------------------------------------------\n');
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node compare.js <old-results.json> <new-results.json>');
  process.exit(1);
}

compare(args[0], args[1]);
