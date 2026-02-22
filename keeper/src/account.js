const { Keypair, Server, Account } = require('soroban-client');

/**
 * Loads the keeper's keypair and validates its on-chain state.
 * 
 * We use Soroban RPC's getAccount endpoint because the keeper is primarily
 * interacting with Soroban contracts, and the RPC server provides the necessary
 * account state (sequence number, balances) required for transaction building.
 * 
 * @returns {Promise<{ keypair: Keypair, account: any }>}
 */
async function initializeKeeperAccount() {
    const secret = process.env.KEEPER_SECRET;
    if (!secret) {
        throw new Error('KEEPER_SECRET environment variable is not defined');
    }

    let keypair;
    try {
        keypair = Keypair.fromSecret(secret);
    } catch (err) {
        throw new Error('Failed to derive keypair from KEEPER_SECRET. Ensure it is a valid Stellar secret key.');
    }

    const publicKey = keypair.publicKey();
    console.log(`Keeper initialized with public key: ${publicKey}`);

    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    const server = new Server(rpcUrl);

    let accountResponse;
    try {
        // Fetch account from network
        accountResponse = await server.getAccount(publicKey);
    } catch (err) {
        // Specific handling for account not found
        if (err.response && err.response.status === 404) {
            throw new Error(
                `Keeper account ${publicKey} not found on-chain. ` +
                `Please fund this account with at least 1-2 XLM to enable transaction submission.`
            );
        }
        throw new Error(`Failed to fetch keeper account from RPC: ${err.message}`);
    }

    // Validate balance
    const minBalanceXlm = parseFloat(process.env.MIN_KEEPER_BALANCE_XLM || '1.0');
    const haltOnLowBalance = process.env.HALT_ON_LOW_BALANCE === 'true';

    const nativeBalance = accountResponse.balances.find(b => b.asset_type === 'native');
    const balanceXlm = nativeBalance ? parseFloat(nativeBalance.balance) : 0;

    if (balanceXlm < minBalanceXlm) {
        const warning = `Keeper balance (${balanceXlm} XLM) is below the recommended minimum of ${minBalanceXlm} XLM.`;
        if (haltOnLowBalance) {
            throw new Error(`HALTING: ${warning}`);
        } else {
            console.warn(`WARNING: ${warning}`);
        }
    }

    return { keypair, accountResponse };
}

/**
 * Returns a fresh Account object for transaction building.
 * @param {any} accountResponse The response from server.getAccount()
 * @returns {Account}
 */
function getKeeperAccount(accountResponse) {
    return new Account(accountResponse.accountId(), accountResponse.sequenceNumber());
}

module.exports = {
    initializeKeeperAccount,
    getKeeperAccount
};
