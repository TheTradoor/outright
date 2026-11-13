//! Fixed, deliberately synthetic local-validator market configuration.
use percolator_prog::{ix::Instruction, state};
use serde_json::{json, Value};
use solana_program::pubkey::Pubkey;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn export() -> Value {
    let init = Instruction::InitMarket {
        max_portfolio_assets: 1,
        h_min: 0,
        h_max: 10,
        initial_price: 1_000_000,
        min_nonzero_mm_req: 1,
        min_nonzero_im_req: 2,
        maintenance_margin_bps: 10_000,
        initial_margin_bps: 10_000,
        max_trading_fee_bps: 100,
        trade_fee_base_bps: 0,
        liquidation_fee_bps: 0,
        liquidation_fee_cap: 0,
        min_liquidation_abs: 0,
        max_price_move_bps_per_slot: 1_000,
        max_accrual_dt_slots: 4,
        max_abs_funding_e9_per_slot: 0,
        min_funding_lifetime_slots: 4,
        max_account_b_settlement_chunks: 1,
        max_bankrupt_close_chunks: 1,
        max_bankrupt_close_lifetime_slots: 100,
        public_b_chunk_atoms: percolator::MAX_VAULT_TVL,
        maintenance_fee_per_slot: 0,
    };
    assert_eq!(Instruction::decode(&init.encode()).unwrap(), init);
    let owner = Pubkey::new_from_array([3; 32]);
    let mint = Pubkey::new_from_array([5; 32]);
    let destination = Pubkey::new_from_array([6; 32]);
    let initialize_mint =
        spl_token::instruction::initialize_mint2(&spl_token::ID, &mint, &owner, None, 6).unwrap();
    let mint_tokens = spl_token::instruction::mint_to_checked(
        &spl_token::ID,
        &mint,
        &destination,
        &owner,
        &[],
        1_000_000_000,
        6,
    )
    .unwrap();
    let configure = Instruction::ConfigureAuthMark {
        asset_index: 0,
        market_id: 1,
        now_slot: 123,
        initial_mark_e6: 1_000_000,
        observation_sequence: 2,
        authority_epoch: 3,
    };
    let push = Instruction::PushAuthMark {
        asset_index: 0,
        market_id: 1,
        now_slot: 124,
        mark_e6: 1_000_000,
        observation_sequence: 3,
        authority_epoch: 3,
    };
    let consent = Instruction::SetMatcherConfig {
        portfolio_id: 17,
        expected_sequence: 2,
        position_epoch: 3,
        asset_generation_frontier: 2,
        enabled: 1,
        trade_fee_cap_bps: 100,
        expiry_slot: 100_000,
    };
    json!({
        "marketAccountLength": state::market_account_len_for_capacity(1).unwrap(),
        "initializeMarketHex": hex(&init.encode()),
        "initialPrice": "1000000",
        "initializeMintHex": hex(&initialize_mint.data),
        "mintTokensHex": hex(&mint_tokens.data),
        "configureMarkHex": hex(&configure.encode()),
        "pushMarkHex": hex(&push.encode()),
        "matcherConsentHex": hex(&consent.encode())
    })
}
