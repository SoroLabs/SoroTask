const { xdr } = require('@stellar/stellar-sdk');

const symbols = [
  "TaskRegistered",
  "TaskPaused",
  "TaskResumed",
  "KeeperPaid",
  "GasDeposited",
  "GasWithdrawn",
  "TaskCancelled",
  "DependencyAdded",
  "DependencyRemoved"
];

const results = {};
symbols.forEach(s => {
  const sym = xdr.ScVal.scvSymbol(s);
  results[s] = sym.toXDR().toString('base64');
});

console.log(JSON.stringify(results, null, 2));
