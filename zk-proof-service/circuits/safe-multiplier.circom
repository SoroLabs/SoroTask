pragma circom 2.0.0;

// #854: minimal example circuit kept in the repo so the circuit-audit CI
// workflow has something concrete to run against. Every declared signal
// appears in a constraint, so this passes circom-fuzzer's static analysis
// cleanly — it's a "known good" fixture, not a demonstration of a flaw.
// (The fuzzer's own detection logic for the under-constrained case is
// covered directly in lib/circom-fuzzer.test.js.)
template SafeMultiplier() {
    signal input a;
    signal input b;
    signal output c;

    c <== a * b;
}

component main = SafeMultiplier();
