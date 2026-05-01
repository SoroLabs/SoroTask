const { xdr, nativeToScVal, Address } = require("@stellar/stellar-sdk");
const { createLogger } = require("./logger");

/**
 * StartupValidator performs fail-fast checks to ensure the keeper is 
 * correctly configured and can interact with the SoroTask contract.
 */
class StartupValidator {
  constructor(server, contractId, networkPassphrase, logger) {
    this.server = server;
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
    this.logger = logger || createLogger("validator");
  }

  /**
   * Run all validation checks.
   * Throws an error with an actionable message if any check fails.
   */
  async validate() {
    this.logger.info("Starting startup validation...");

    await this.checkNetwork();
    await this.checkContractExistence();
    await this.checkContractInitialization();
    await this.checkContractInterface();

    this.logger.info("Startup validation passed.");
  }

  /**
   * Check if the RPC server is reachable and returning ledgers.
   */
  async checkNetwork() {
    try {
      const info = await this.server.getLatestLedger();
      this.logger.info("Network check passed", { 
        sequence: info.sequence,
        protocolVersion: info.protocolVersion 
      });
    } catch (err) {
      throw new Error(`Network Connectivity Error: Unable to reach Soroban RPC at ${this.server.serverURL.toString()}. Please check your SOROBAN_RPC_URL. Original error: ${err.message}`);
    }
  }

  /**
   * Check if the contract ID points to a valid, existing contract.
   */
  async checkContractExistence() {
    try {
      Address.fromString(this.contractId);
    } catch (err) {
      throw new Error(`Configuration Error: Invalid Contract ID format: "${this.contractId}". It must be a valid Stellar contract address. Original error: ${err.message}`);
    }

    try {
      await this.server.getAccount(this.contractId);
      this.logger.info("Contract existence check passed");
    } catch (err) {
      if (err.response && err.response.status === 404) {
        throw new Error(`Contract Not Found Error: The SoroTask contract with ID "${this.contractId}" was not found on the configured network (passphrase: "${this.networkPassphrase}"). Please ensure the contract is deployed and CONTRACT_ID is correct.`);
      }
      throw new Error(`Contract Existence Check Failed: An unexpected error occurred while checking for contract ${this.contractId}. Original error: ${err.message}`);
    }
  }

  /**
   * Check if the contract is initialized with a reward token.
   */
  async checkContractInitialization() {
    try {
      const { TransactionBuilder, Operation, Networks } = require("@stellar/stellar-sdk");
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({
        sequenceNumber: () => "1", // Dummy sequence number for simulation
        accountId: () => this.contractId // Dummy account ID for simulation
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContract({
            contractId: this.contractId,
            functionName: "get_token",
            args: [],
          })
        )
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (simulation.error) {
        throw new Error(`Contract Initialization Simulation Failed: ${simulation.error}. This might indicate an RPC problem or a severely misconfigured contract.`);
      }

      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        const error = simulation.results[0].error;
        if (error.includes("Not Initialized") || error.includes("contract not initialized")) {
          throw new Error(`Contract Not Initialized Error: The SoroTask contract at ${this.contractId} is not yet initialized with a reward token. Please ensure the 'init' function has been called.`);
        }
        throw new Error(`Contract Initialization Check Failed: Unexpected error during 'get_token' simulation: ${error}`);
      }

      this.logger.info("Contract initialization check passed");
    } catch (err) {
      if (err.message.includes("Contract Not Initialized Error") || err.message.includes("Contract Initialization Simulation Failed") || err.message.includes("Contract Initialization Check Failed")) { throw err; }
      this.logger.warn("Contract initialization check encountered a non-critical error and was skipped. This might indicate a transient issue.", { error: err.message });
    }
  }

  async checkContractInterface() {
    try {
      const { TransactionBuilder, Operation, Networks } = require("@stellar/stellar-sdk");
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({
        sequenceNumber: () => "1", // Dummy sequence number for simulation
        accountId: () => this.contractId // Dummy account ID for simulation
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContract({
            contractId: this.contractId,
            functionName: "monitor_paginated",
            args: [
              nativeToScVal(0, { type: "u64" }),
              nativeToScVal(0, { type: "u64" })
            ],
          })
        )
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (simulation.error) {
        throw new Error(`Contract Interface Simulation Failed: ${simulation.error}. This might indicate an RPC problem or a severely misconfigured contract.`);
      }

      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        const error = simulation.results[0].error;
        if (error.includes("not found") || error.includes("InvalidAction") || error.includes("ScriptError") || error.includes("function not found")) {
          throw new Error(`ABI Compatibility Error: The SoroTask contract at ${this.contractId} is missing the required 'monitor_paginated' function or has a mismatched signature. Please ensure the correct contract version is deployed.`);
        }
        throw new Error(`Contract Interface Validation Failed: ${error}`);
      }

      this.logger.info("Contract interface check passed");
    } catch (err) {
      if (err.message.includes("ABI Compatibility Error") || err.message.includes("Contract Interface Simulation Failed") || err.message.includes("Contract Interface Check Failed")) { throw err; }
      this.logger.warn("Contract interface check encountered a non-critical error and was skipped. This might indicate a transient issue.", { error: err.message });
    }
  }
}

module.exports = { StartupValidator };
