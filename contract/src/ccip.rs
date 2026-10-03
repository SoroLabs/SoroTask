use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env};
use crate::Error;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CrossChainMessage {
    pub message_id: BytesN<32>,
    pub source_chain_selector: u64,
    pub sender: Bytes,
    pub data: Bytes,
    pub nonce: u64,
}

#[contracttype]
pub enum CcipDataKey {
    Router,
    ChainWhitelisted(u64),
    ExecutedMessage(BytesN<32>),
    NonceBloom(u64),
}

pub fn configure_ccip(env: &Env, router: Address) {
    env.storage().instance().set(&CcipDataKey::Router, &router);
}

pub fn whitelist_chain(env: &Env, selector: u64, whitelisted: bool) {
    env.storage().instance().set(&CcipDataKey::ChainWhitelisted(selector), &whitelisted);
}

pub fn receive_ccip_message(env: &Env, caller: Address, msg: CrossChainMessage) -> Result<(), Error> {
    caller.require_auth();

    let router: Address = env
        .storage()
        .instance()
        .get(&CcipDataKey::Router)
        .ok_or(Error::GatewayNotConfigured)?;

    if caller != router {
        return Err(Error::GatewayUnauthorized);
    }

    let whitelisted: bool = env
        .storage()
        .instance()
        .get(&CcipDataKey::ChainWhitelisted(msg.source_chain_selector))
        .unwrap_or(false);

    if !whitelisted {
        return Err(Error::UnsupportedSourceChain);
    }

    // Cryptographic message ID hashing
    let msg_hash = env.crypto().keccak256(&msg.to_xdr(env));

    // Replay-attack cache
    if env.storage().persistent().has(&CcipDataKey::ExecutedMessage(msg_hash.clone())) {
        return Err(Error::MessageAlreadyExecuted);
    }
    env.storage().persistent().set(&CcipDataKey::ExecutedMessage(msg_hash.clone()), &msg.message_id);

    // Store executed nonces in bit-packed bloom filters
    let block_index = msg.nonce / 64;
    let bit_index = msg.nonce % 64;
    let mut bloom_block: u64 = env
        .storage()
        .persistent()
        .get(&CcipDataKey::NonceBloom(block_index))
        .unwrap_or(0);

    if (bloom_block & (1 << bit_index)) != 0 {
        return Err(Error::MessageAlreadyExecuted);
    }
    
    bloom_block |= 1 << bit_index;
    env.storage().persistent().set(&CcipDataKey::NonceBloom(block_index), &bloom_block);

    // Auto-pruning via TTL
    env.storage().persistent().extend_ttl(
        &CcipDataKey::ExecutedMessage(msg_hash),
        crate::MIN_THRESHOLD_LEDGERS,
        crate::EXTEND_TO_LEDGERS,
    );
    env.storage().persistent().extend_ttl(
        &CcipDataKey::NonceBloom(block_index),
        crate::MIN_THRESHOLD_LEDGERS,
        crate::EXTEND_TO_LEDGERS,
    );

    Ok(())
}
