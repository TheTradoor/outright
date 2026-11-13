//! Offsets come from the pinned Rust types. JavaScript never guesses alignment.
use core::mem::{offset_of, size_of};
use percolator::*;
use percolator_prog::{constants as c, state};
use serde_json::{json, Value};

macro_rules! fields {
    ($ty:ty; $($field:ident: $kind:literal),* $(,)?) => {
        json!({$(stringify!($field): {"offset": offset_of!($ty, $field), "type": $kind}),*})
    };
}

pub fn export() -> Value {
    json!({
        "market": fields!(MarketGroupV16HeaderAccount;
            market_group_id: "key", asset_slot_capacity: "u32", vault: "u128",
            insurance: "u128", c_tot: "u128", current_slot: "u64", slot_last: "u64",
            next_market_id: "u64", mode: "u8", oracle_epoch: "u64", funding_epoch: "u64",
            risk_epoch: "u64", asset_set_epoch: "u64", bankruptcy_hlock_active: "bool",
            threshold_stress_active: "bool", loss_stale_active: "bool",
            resolved_slot: "u64", payout_snapshot_captured: "bool"),
        "payoutLedgerOffset": offset_of!(MarketGroupV16HeaderAccount, resolved_payout_ledger),
        "payoutLedger": fields!(ResolvedPayoutLedgerV16Account;
            current_payout_rate_num: "u128", current_payout_rate_den: "u128",
            payout_halted: "bool", finalized: "bool"),
        "configOffset": offset_of!(MarketGroupV16HeaderAccount, config),
        "config": fields!(V16ConfigAccount;
            max_portfolio_assets: "u16", max_market_slots: "u32",
            maintenance_margin_bps: "u64", initial_margin_bps: "u64",
            max_trading_fee_bps: "u64", max_accrual_dt_slots: "u64",
            max_price_move_bps_per_slot: "u64", min_nonzero_mm_req: "u128",
            min_nonzero_im_req: "u128", liquidation_fee_bps: "u64"),
        "wrapper": fields!(state::WrapperConfigV16;
            marketauth: "key", collateral_mint: "key", secondary_collateral_mint: "key",
            trade_fee_base_bps: "u64", maintenance_fee_per_slot: "u128",
            force_close_delay_slots: "u64"),
        "assetOffset": offset_of!(Market<[u8; c::ASSET_ORACLE_WRAPPER_LEN]>, engine)
            + offset_of!(EngineAssetSlotV16Account, asset),
        "asset": fields!(AssetStateV16Account;
            market_id: "u64", lifecycle: "u8", raw_oracle_target_price: "u64",
            effective_price: "u64", slot_last: "u64", a_long: "u128", a_short: "u128",
            oi_eff_long_q: "u128", oi_eff_short_q: "u128", epoch_long: "u64",
            epoch_short: "u64", mode_long: "u8", mode_short: "u8"),
        "oracle": fields!(state::AssetOracleProfileV16;
            oracle_mode: "u8", oracle_leg_count: "u8", last_good_oracle_slot: "u64",
            oracle_target_price_e6: "u64", oracle_target_publish_time: "i64",
            max_staleness_secs: "u64", hybrid_soft_stale_slots: "u64",
            backing_trade_fee_bps_long: "u16", backing_trade_fee_bps_short: "u16"),
        "oracleFeedsOffset": offset_of!(state::AssetOracleProfileV16, oracle_leg_feeds),
        "controlSequencesOffset": c::ASSET_CONTROL_SEQUENCES_OFF,
        "controlSequences": fields!(state::AssetControlSequencesV16; authority_epoch: "u64"),
        "portfolio": fields!(PortfolioAccountV16Account;
            reserved_pnl: "u128", fee_credits: "i128", last_fee_slot: "u64",
            active_bitmap: "u64", stale_state: "bool", b_stale_state: "bool",
            rebalance_lock: "bool", liquidation_lock: "bool"),
        "payoutReceiptOffset": offset_of!(PortfolioAccountV16Account, resolved_payout_receipt),
        // Exact locations for review-race regressions outside the UI projection.
        "reviewAccountingOffsets": {
            "cancelDepositEscrow": offset_of!(PortfolioAccountV16Account, cancel_deposit_escrow),
            "closeResidual": offset_of!(PortfolioAccountV16Account, close_progress)
                + offset_of!(CloseProgressLedgerV16Account, residual_remaining),
            "sourceBacking": offset_of!(PortfolioAccountV16Account, source_domains)
                + offset_of!(PortfolioSourceDomainV16Account, source_lien_counterparty_backing_num)
        },
        "payoutReceipt": fields!(ResolvedPayoutReceiptV16Account;
            present: "bool", prior_bound_contribution_num: "u128",
            live_released_face_at_receipt: "u128", terminal_positive_claim_face: "u128",
            paid_effective: "u128", finalized: "bool"),
        "boundScale": BOUND_SCALE.to_string(),
        "legsOffset": offset_of!(PortfolioAccountV16Account, legs),
        "legLength": size_of::<PortfolioLegV16Account>(),
        "legCount": V16_MAX_PORTFOLIO_ASSETS_N,
        "leg": fields!(PortfolioLegV16Account;
            active: "bool", asset_index: "u32", market_id: "u64", side: "u8",
            basis_pos_q: "i128", a_basis: "u128", epoch_snap: "u64",
            k_snap: "i128", f_snap: "i128", loss_weight: "u128",
            b_rem: "u128", b_epoch_snap: "u64",
            b_stale: "bool", stale: "bool"),
        "socialLossDen": SOCIAL_LOSS_DEN.to_string(),
        "socialWeightScale": SOCIAL_WEIGHT_SCALE.to_string(),
        "healthOffset": offset_of!(PortfolioAccountV16Account, health_cert),
        "health": fields!(HealthCertV16Account;
            certified_equity: "i128", certified_initial_req: "u128",
            certified_maintenance_req: "u128", certified_liq_deficit: "u128",
            cert_oracle_epoch: "u64", cert_funding_epoch: "u64", cert_risk_epoch: "u64",
            cert_asset_set_epoch: "u64", active_bitmap_at_cert: "u64", valid: "bool"),
        "matcherOffset": c::PORTFOLIO_MATCHER_CONFIG_OFF,
        "matcher": fields!(state::PortfolioMatcherConfigV16;
            matcher_program: "key", matcher_context: "key", matcher_delegate: "key"),
        "matcherExpiryOffset": c::PORTFOLIO_MATCHER_EXPIRY_OFF,
        "adlOne": ADL_ONE.to_string(), "minASide": MIN_A_SIDE.to_string(),
        "maxPositionAbsQ": MAX_POSITION_ABS_Q.to_string(),
        "positionScale": POS_SCALE.to_string()
    })
}

pub fn market_fixture() -> Vec<u8> {
    let mut data = vec![0; state::market_account_len_for_capacity(1).unwrap()];
    let wrapper = state::WrapperConfigV16 {
        marketauth: [4; 32],
        collateral_mint: [5; 32],
        unit_scale: 1,
        next_portfolio_id: 18,
        last_good_oracle_slot: 123,
        mark_ewma_e6: 150_000_000,
        oracle_target_price_e6: 150_000_000,
        mark_ewma_halflife_slots: c::DEFAULT_MARK_EWMA_HALFLIFE_SLOTS,
        ..Default::default()
    };
    let mut config = V16Config::public_user_fund(1, 0, 10);
    config.min_nonzero_mm_req = 1;
    config.min_nonzero_im_req = 2;
    config.maintenance_margin_bps = 10_000;
    config.initial_margin_bps = 10_000;
    config.max_trading_fee_bps = 10_000;
    config.max_price_move_bps_per_slot = 10_000;
    config.max_accrual_dt_slots = 1;
    config.min_funding_lifetime_slots = 1;
    config.max_bankrupt_close_lifetime_slots = 100;
    config.validate_public_user_fund().unwrap();
    state::init_market_account_zero_copy(&mut data, &wrapper, config, [1; 32], 150_000_000, 123)
        .unwrap();
    // Ask the upstream reader to validate the exported fixture as well.
    state::read_market(&data).unwrap();
    data
}
