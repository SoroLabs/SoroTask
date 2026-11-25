//! Carbon-offset accounting for keeper executions (SC-PROD-48). Metered CPU
//! instructions become carbon debt (mg CO2e); past the threshold the contract
//! burns carbon credits it holds and publishes a `carbon_retired` certificate.
//! Debt the credit balance cannot cover is carried forward.

use soroban_sdk::{contracttype, token, Address, Env, Symbol};

use crate::events::EVENT_DOMAIN;

#[contracttype]
#[derive(Clone)]
enum CarbonKey {
    Config,
    Ledger,
    CertificateCounter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CarbonConfig {
    /// Tokenized carbon credit held by this contract; `None` disables retirement.
    pub credit_token: Option<Address>,
    /// Milligrams CO2e attributed to one million CPU instructions.
    pub mg_per_million_instructions: u64,
    /// Carbon debt (mg CO2e) at which retirement is attempted.
    pub threshold_mg: u64,
    /// Milligrams CO2e offset by one unit of the credit token.
    pub mg_per_credit_unit: u64,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CarbonLedger {
    pub cumulative_instructions: u64,
    pub carbon_debt_mg: u64,
    pub total_retired_mg: u64,
    pub total_credits_retired: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetirementCertificate {
    pub id: u64,
    pub credits_retired: i128,
    pub carbon_offset_mg: u64,
    pub cumulative_instructions: u64,
    pub timestamp: u64,
}

pub fn get_config(env: &Env) -> Option<CarbonConfig> {
    env.storage().instance().get(&CarbonKey::Config)
}

pub fn set_config(env: &Env, config: &CarbonConfig) {
    env.storage().instance().set(&CarbonKey::Config, config);
}

pub fn get_ledger(env: &Env) -> CarbonLedger {
    env.storage().instance().get(&CarbonKey::Ledger).unwrap_or_default()
}

/// Records one execution's CPU usage and retires credits if the threshold is met.
pub fn record_consumption(env: &Env, instructions: u64) -> Option<RetirementCertificate> {
    let config = get_config(env)?;
    let mut ledger = get_ledger(env);

    ledger.cumulative_instructions = ledger.cumulative_instructions.saturating_add(instructions);
    let added = (instructions as u128 * config.mg_per_million_instructions as u128) / 1_000_000;
    ledger.carbon_debt_mg = ledger
        .carbon_debt_mg
        .saturating_add(u64::try_from(added).unwrap_or(u64::MAX));

    let certificate = (ledger.carbon_debt_mg >= config.threshold_mg)
        .then(|| retire(env, &config, &mut ledger))
        .flatten();
    env.storage().instance().set(&CarbonKey::Ledger, &ledger);
    certificate
}

fn retire(
    env: &Env,
    config: &CarbonConfig,
    ledger: &mut CarbonLedger,
) -> Option<RetirementCertificate> {
    let credit_token = config.credit_token.as_ref().filter(|_| config.mg_per_credit_unit > 0)?;
    let client = token::Client::new(env, credit_token);
    let owed = (ledger.carbon_debt_mg / config.mg_per_credit_unit) as i128;
    let credits = owed.min(client.balance(&env.current_contract_address()));
    if credits <= 0 {
        return None;
    }

    client.burn(&env.current_contract_address(), &credits);
    let offset = credits as u64 * config.mg_per_credit_unit;
    ledger.carbon_debt_mg -= offset;
    ledger.total_retired_mg = ledger.total_retired_mg.saturating_add(offset);
    ledger.total_credits_retired += credits;

    let counter = env.storage().instance().get::<_, u64>(&CarbonKey::CertificateCounter);
    let id = counter.unwrap_or(0) + 1;
    env.storage().instance().set(&CarbonKey::CertificateCounter, &id);

    let certificate = RetirementCertificate {
        id,
        credits_retired: credits,
        carbon_offset_mg: offset,
        cumulative_instructions: ledger.cumulative_instructions,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (Symbol::new(env, EVENT_DOMAIN), Symbol::new(env, "carbon_retired"), id),
        certificate.clone(),
    );
    Some(certificate)
}
