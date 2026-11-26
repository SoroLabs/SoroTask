#![cfg(test)]

use crate::governance::{
    commit_juror_vote, compute_juror_commitment, finalize_dispute, get_dispute, get_juror,
    get_juror_vote, initialize_arbitration, open_dispute, reveal_juror_vote, stake_juror,
    ArbitrationStatus, VoteChoice,
};
use crate::SoroTaskContract;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, Vec,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let address = token.address();
    soroban_sdk::token::StellarAssetClient::new(env, &address).mint(admin, &100_000_000);
    address
}

fn setup() -> (Env, Address, Address, Vec<Address>) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
        li.sequence_number = 1;
    });
    let contract = env.register_contract(None, SoroTaskContract);
    let admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let mut jurors = Vec::new(&env);
    let mut i = 0;
    while i < 3 {
        let juror = Address::generate(&env);
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&juror, &10_000);
        jurors.push_back(juror);
        i += 1;
    }
    env.as_contract(&contract, || {
        initialize_arbitration(&env, &admin, &token, 50, 3, 100, 100, 1_000, 5_000);
        stake_juror(&env, &jurors.get(0).unwrap(), 100);
        stake_juror(&env, &jurors.get(1).unwrap(), 200);
        stake_juror(&env, &jurors.get(2).unwrap(), 500);
    });
    (env, contract, token, jurors)
}

fn salt(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn majority_voters_earn_fees_and_dissenters_are_slashed() {
    let (env, contract, token, jurors) = setup();
    let claimant = Address::generate(&env);
    let respondent = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &10_000);
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let claimant_before = token_client.balance(&claimant);

    let dispute_id = env.as_contract(&contract, || {
        open_dispute(
            &env,
            &claimant,
            42,
            1_000,
            BytesN::from_array(&env, &[9u8; 32]),
            &respondent,
        )
    });
    assert_eq!(token_client.balance(&claimant), claimant_before - 1_100);
    let opened = env.as_contract(&contract, || get_dispute(&env, dispute_id).unwrap());
    assert_eq!(opened.selected.len(), 3);
    assert_eq!(opened.weights.len(), 3);
    let selected = opened.selected.clone();
    let weights = opened.weights.clone();
    let mut max_index = 0;
    let mut i = 1;
    while i < 3 {
        if weights.get(i).unwrap() > weights.get(max_index).unwrap() {
            max_index = i;
        }
        i += 1;
    }
    let dissent_index = if max_index == 0 { 1 } else { 0 };
    let expected_for = weights.get(max_index).unwrap();
    let expected_against = weights.get(dissent_index).unwrap();
    assert!(expected_for > expected_against);

    let mut salts: Vec<BytesN<32>> = Vec::new(&env);
    salts.push_back(salt(&env, 1));
    salts.push_back(salt(&env, 2));
    salts.push_back(salt(&env, 3));
    env.as_contract(&contract, || {
        let mut i = 0;
        while i < 3 {
            let juror = selected.get(i).unwrap();
            let choice = if i == max_index {
                VoteChoice::For
            } else if i == dissent_index {
                VoteChoice::Against
            } else {
                VoteChoice::Abstain
            };
            let commitment =
                compute_juror_commitment(&env, dispute_id, &juror, choice, &salts.get(i).unwrap());
            commit_juror_vote(&env, dispute_id, &juror, commitment);
            i += 1;
        }
    });

    env.ledger().with_mut(|li| li.timestamp = 1_101);
    env.as_contract(&contract, || {
        let mut i = 0;
        while i < 3 {
            let juror = selected.get(i).unwrap();
            let choice = if i == max_index {
                VoteChoice::For
            } else if i == dissent_index {
                VoteChoice::Against
            } else {
                VoteChoice::Abstain
            };
            reveal_juror_vote(&env, dispute_id, &juror, choice, &salts.get(i).unwrap());
            assert_eq!(
                get_juror_vote(&env, dispute_id, &juror).unwrap().choice,
                choice
            );
            i += 1;
        }
    });

    let pre_tally = env.as_contract(&contract, || {
        let d = get_dispute(&env, dispute_id).unwrap();
        let mut f = 0i128;
        let mut a = 0i128;
        let mut j = 0;
        while j < d.selected.len() {
            let vote = get_juror_vote(&env, dispute_id, &d.selected.get(j).unwrap()).unwrap();
            if vote.choice == VoteChoice::For {
                f += d.weights.get(j).unwrap();
            } else if vote.choice == VoteChoice::Against {
                a += d.weights.get(j).unwrap();
            }
            j += 1;
        }
        (f, a)
    });
    assert_eq!(pre_tally, (expected_for, expected_against));

    let majority_before = token_client.balance(&selected.get(max_index).unwrap());
    env.ledger().with_mut(|li| li.timestamp = 1_201);
    env.as_contract(&contract, || finalize_dispute(&env, dispute_id));

    let dispute = env.as_contract(&contract, || get_dispute(&env, dispute_id).unwrap());
    assert_eq!(dispute.status, ArbitrationStatus::Upheld);
    assert_eq!(dispute.majority, Some(VoteChoice::For as u32));
    assert_eq!(token_client.balance(&claimant), claimant_before - 100);
    assert!(token_client.balance(&selected.get(max_index).unwrap()) > majority_before);
    assert_eq!(
        env.as_contract(&contract, || get_juror(
            &env,
            &selected.get(dissent_index).unwrap()
        )
        .unwrap()
        .stake),
        expected_against / 2
    );
}

#[test]
fn tie_refunds_claimant_without_slashing_jurors() {
    let (env, contract, token, jurors) = setup();
    let claimant = Address::generate(&env);
    let respondent = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &10_000);
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let claimant_before = token_client.balance(&claimant);

    let dispute_id = env.as_contract(&contract, || {
        open_dispute(
            &env,
            &claimant,
            77,
            1_000,
            BytesN::from_array(&env, &[8u8; 32]),
            &respondent,
        )
    });
    env.ledger().with_mut(|li| li.timestamp = 1_201);
    env.as_contract(&contract, || finalize_dispute(&env, dispute_id));

    let dispute = env.as_contract(&contract, || get_dispute(&env, dispute_id).unwrap());
    assert_eq!(dispute.status, ArbitrationStatus::Tied);
    assert_eq!(token_client.balance(&claimant), claimant_before);
    let mut i = 0;
    while i < 3 {
        let expected = match i {
            0 => 100,
            1 => 200,
            _ => 500,
        };
        assert_eq!(
            env.as_contract(&contract, || get_juror(&env, &jurors.get(i).unwrap())
                .unwrap()
                .stake),
            expected
        );
        i += 1;
    }
}
