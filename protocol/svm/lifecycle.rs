// Copied temporarily into the exact upstream checkout by run.sh. Its fixture
// initializes the market and funded counterparties through the actual SBF.
#[allow(dead_code)]
#[path = "support/v16_svm.rs"]
mod upstream_fixture;

use percolator_prog::error::PercolatorError;
use serde_json::{json, Value};
use solana_sdk::{
    account::Account,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::{Transaction, TransactionError},
};
use std::{
    io::Write,
    process::{Command, Stdio},
    str::FromStr,
};
use upstream_fixture::{MarketConfig, V16Svm};

// The pinned engine has bounded close continuations. Zero positions or zero
// capital alone is not proof that a portfolio has finished settlement.
fn resolved_actor_terminal(env: &V16Svm, actor: usize) -> bool {
    let group = env.primary_market_state().1;
    let p = env.primary_portfolio(actor);
    let receipt = p.resolved_payout_receipt.try_to_runtime().unwrap();
    let close = p.close_progress.try_to_runtime().unwrap();
    group.mode == percolator::MarketModeV16::Resolved
        && p.capital.get() == 0
        && p.pnl.get() == 0
        && p.reserved_pnl.get() == 0
        && p.fee_credits.get() == 0
        && p.cancel_deposit_escrow.get() == 0
        && percolator::active_bitmap_is_empty(percolator_prog::state::portfolio_active_bitmap(&p))
        && p.stale_state == 0
        && p.b_stale_state == 0
        && p.rebalance_lock == 0
        && p.liquidation_lock == 0
        && p.last_fee_slot.get() == group.resolved_slot
        && p.health_cert.valid == 0
        && p.source_domains.iter().all(|source| !source.is_occupied())
        && (!receipt.present || receipt.finalized)
        && (!close.active || (close.finalized && close.residual_remaining == 0))
}

fn settlement_view(env: &V16Svm, actor: usize) -> Value {
    js(json!({"operation":"settlement",
        "marketAccount":account_json(env,env.market),
        "marketExpected":{"programId":env.program_id.to_string(),"address":env.market.to_string(),"collateralMint":env.mint.to_string()},
        "portfolioAccount":account_json(env,env.actors[actor].portfolio),
        "portfolioExpected":{"programId":env.program_id.to_string(),"address":env.actors[actor].portfolio.to_string(),
            "market":env.market.to_string(),"owner":env.actors[actor].signer.pubkey().to_string()}}))
}

fn resolved_close(env: &V16Svm, actor: usize, name: &str) -> Instruction {
    build(
        env,
        name,
        json!({}),
        custody(
            env,
            env.actors[actor].portfolio,
            env.actors[actor].signer.pubkey(),
            env.actors[actor].destination_token,
        ),
    )
}

fn portfolio_close(env: &V16Svm, actor: usize) -> Instruction {
    build(
        env,
        "closePortfolio",
        json!({
        "portfolioId":env.primary_portfolio_id(actor).to_string(),
        "expectedSequence":env.primary_portfolio_matcher_sequence(actor).to_string(),
        "positionEpoch":env.primary_portfolio_position_epoch(actor).to_string()}),
        json!({"owner":env.actors[actor].signer.pubkey().to_string(),
            "market":env.market.to_string(),"portfolio":env.actors[actor].portfolio.to_string()}),
    )
}

fn slab_close(env: &V16Svm) -> Instruction {
    let market = js(
        json!({"operation":"readMarket","account":account_json(env,env.market),
        "expected":{"programId":env.program_id.to_string(),"address":env.market.to_string(),"collateralMint":env.mint.to_string()}}),
    );
    let epoch = &market["assets"][0]["control"]["authority_epoch"];
    assert_eq!(
        epoch,
        &json!(env.primary_control_sequences(0).authority_epoch.to_string())
    );
    build(
        env,
        "closeSlab",
        json!({"authorityEpoch":epoch}),
        json!({"owner":env.actors[4].signer.pubkey().to_string(),"market":env.market.to_string(),
            "vault":env.vault.to_string(),"mint":env.mint.to_string(),
            "userToken":env.actors[4].destination_token.to_string()}),
    )
}

fn assert_closed_portfolio(env: &V16Svm, portfolio: Pubkey) {
    if let Some(account) = env.svm.get_account(&portfolio) {
        assert_eq!(account.lamports, 0);
        assert!(account.data.is_empty());
    }
}

#[test]
fn javascript_resolved_receipt_survives_haircut_and_pays_late_backing_exactly_once() {
    resolved_receipt_trace(false);
}

#[test]
fn keeper_resolved_planner_expires_backing_and_pays_owner_without_owner_signature() {
    resolved_receipt_trace(true);
}

fn resolved_keeper_instruction(
    env: &V16Svm,
    payer: Pubkey,
    slot: u64,
    discovery: u16,
) -> Instruction {
    continuation_instruction(env, payer, slot, discovery, 0)
}

fn continuation_instruction(
    env: &V16Svm,
    payer: Pubkey,
    slot: u64,
    discovery: u16,
    actor_index: usize,
) -> Instruction {
    let actor = &env.actors[actor_index];
    let group = env.primary_market_state().1;
    from_js_instruction(&js(
        json!({"operation":"planCrank", "slot":slot,"discoveryIndex":discovery,
        "config":{"settleResolved":true,"feePayer":payer.to_string(),
            "deployment":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
                "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string()}},
            "assets":[{"index":0,"marketId":group.assets[0].market_id.to_string()},
                {"index":1,"marketId":group.assets[1].market_id.to_string()}]},
        "target":{"address":actor.portfolio.to_string(),"owner":actor.signer.pubkey().to_string()},
        "marketAccount":account_json(env,env.market),"portfolioAccount":account_json(env,actor.portfolio),
        "payoutTokenAccount":account_json(env,actor.destination_token)}),
    ))
}

fn resolved_receipt_trace(use_keeper: bool) {
    use percolator_prog::ix::CrankObservationHint;
    // Adapt the upstream INV-067 public trace. No program-owned financial state
    // is injected: deposits, matching, marks, expiry and resolution use SBF.
    let config = MarketConfig {
        initial_price: 100,
        maintenance_margin_bps: 1_000,
        initial_margin_bps: 1_000,
        max_price_move_bps_per_slot: 500,
        max_accrual_dt_slots: 1,
        min_funding_lifetime_slots: 1,
        actor_deposits: [1_000, 250, 0, 0, 0],
        ..MarketConfig::default()
    };
    let mut env = V16Svm::new([101; 32], config);
    let supply = env.mint_supply();
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let payer = Keypair::new();
    env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    if use_keeper {
        let ata = js(
            json!({"operation":"createPayoutAta", "payer":payer.pubkey().to_string(),
            "owner":owner.pubkey().to_string(),"mint":env.mint.to_string()}),
        );
        send(
            &mut env,
            from_js_instruction(&ata["instruction"]),
            &[&payer],
        )
        .unwrap();
        env.actors[0].destination_token =
            Pubkey::from_str(ata["address"].as_str().unwrap()).unwrap();
    }
    let signer = if use_keeper { &payer } else { &owner };
    let payout_ix = |env: &V16Svm| {
        if use_keeper {
            resolved_keeper_instruction(env, payer.pubkey(), env.current_slot(), 1)
        } else {
            resolved_close(env, 0, "claimResolvedPayoutTopup")
        }
    };
    env.configure_permissionless_resolve(100, 1).unwrap();
    env.update_asset_authority_from_admin(
        1,
        percolator_prog::processor::ASSET_AUTH_BACKING_BUCKET,
        2,
    )
    .unwrap();
    env.top_up_backing_bucket_for_actor(2, 3, 500, 40).unwrap();
    let size = 20 * percolator::POS_SCALE as i128;
    env.trade_no_cpi(0, 1, 0, size, 100, 0).unwrap();
    for (offset, mark) in (105..=150).step_by(5).enumerate() {
        let slot = 2 + offset as u64;
        env.warp_to_slot(slot);
        env.push_auth_mark(0, slot, mark).unwrap();
        for actor in [1, 0] {
            env.crank(
                actor,
                slot,
                vec![CrankObservationHint {
                    asset_index: 0,
                    oracle_accounts: env.primary_profile(0).oracle_leg_count,
                }],
            )
            .unwrap();
        }
    }
    env.trade_no_cpi(0, 1, 0, -size, 150, 0).unwrap();
    env.warp_to_slot(12);
    env.resolve_market().unwrap();
    if use_keeper {
        let before = snapshot(
            &env,
            &[env.actors[0].portfolio, env.actors[0].destination_token],
        );
        // A forged caller slot passes the planner's delay check, but cannot
        // bypass the program's authenticated Clock and owner-signature gate.
        let forged = resolved_keeper_instruction(&env, payer.pubkey(), 13, 0);
        assert!(forged.accounts.iter().all(|a| !a.is_signer));
        rejected(
            send(&mut env, forged, &[&payer]),
            2,
            PercolatorError::ExpectedSigner,
        );
        assert_unchanged(&env, &before);
    }
    for actor in [1, 2, 3, 4] {
        let signer = Keypair::from_bytes(&env.actors[actor].signer.to_bytes()).unwrap();
        for _ in 0..16 {
            if resolved_actor_terminal(&env, actor) {
                break;
            }
            let ix = resolved_close(&env, actor, "closeResolved");
            send(&mut env, ix, &[&signer]).expect("JS bounded close");
        }
        assert!(resolved_actor_terminal(&env, actor));
        let ix = portfolio_close(&env, actor);
        send(&mut env, ix, &[&signer]).expect("JS closes the terminal peer portfolio");
    }
    env.warp_to_slot(14);
    let ix = if use_keeper {
        resolved_keeper_instruction(&env, payer.pubkey(), 14, 0)
    } else {
        resolved_close(&env, 0, "closeResolved")
    };
    send(&mut env, ix, &[signer]).expect("JS initial haircut close");
    let initial_paid = env.token_amount(env.actors[0].destination_token);
    let view = settlement_view(&env, 0);
    assert_eq!(view["receipt"]["present"], true);
    assert_eq!(view["receipt"]["finalized"], false);
    assert_eq!(view["recordedPayout"], "0");
    assert!(initial_paid > 0 && initial_paid < 1_750);
    let before_pending_close = snapshot(&env, &[env.actors[0].portfolio]);
    let premature = portfolio_close(&env, 0);
    rejected(
        send(&mut env, premature, &[&owner]),
        2,
        PercolatorError::EngineLockActive,
    );
    assert_unchanged(&env, &before_pending_close);
    // Repeated claims before additional backing cannot increase payment.
    let ix = payout_ix(&env);
    if use_keeper {
        let before = snapshot(
            &env,
            &[env.actors[0].portfolio, env.actors[0].destination_token],
        );
        rejected(
            send(&mut env, ix, &[signer]),
            2,
            PercolatorError::EngineNonProgress,
        );
        assert_unchanged(&env, &before);
    } else {
        send(&mut env, ix, &[signer]).expect("zero-due claim");
    }
    assert_eq!(
        env.token_amount(env.actors[0].destination_token),
        initial_paid
    );
    assert_eq!(settlement_view(&env, 0)["receipt"], view["receipt"]);
    env.warp_to_slot(40);
    if use_keeper {
        let ix = resolved_keeper_instruction(&env, payer.pubkey(), 40, 1);
        send(&mut env, ix, &[signer]).expect("keeper discovers expired backing");
    } else {
        env.crank(
            0,
            40,
            vec![CrankObservationHint {
                asset_index: 1,
                oracle_accounts: 0,
            }],
        )
        .expect("public backing discovery releases expired collateral");
    }
    let due = settlement_view(&env, 0)["recordedPayout"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert_eq!(initial_paid + due, 1_750);
    let before = snapshot(
        &env,
        &[env.actors[0].portfolio, env.actors[0].destination_token],
    );
    let mut wrong = payout_ix(&env);
    wrong.accounts[3].pubkey = env.actors[1].destination_token;
    rejected(
        send(&mut env, wrong, &[signer]),
        2,
        PercolatorError::InvalidTokenAccount,
    );
    assert_unchanged(&env, &before);
    let ix = payout_ix(&env);
    let invalid = Instruction {
        program_id: env.program_id,
        accounts: vec![],
        data: vec![255],
    };
    assert_eq!(
        send_many(&mut env, &[ix, invalid], &[signer]).unwrap_err(),
        TransactionError::InstructionError(3, InstructionError::InvalidInstructionData)
    );
    assert_unchanged(&env, &before);
    env.svm.expire_blockhash();
    let ix = payout_ix(&env);
    send(&mut env, ix, &[signer]).expect("JS late payout");
    assert_eq!(env.token_amount(env.actors[0].destination_token), 1_750);
    assert_eq!(settlement_view(&env, 0)["recordedPayout"], "0");
    env.svm.expire_blockhash();
    let ix = payout_ix(&env);
    let again = send(&mut env, ix, &[signer]);
    if use_keeper && again.is_err() {
        rejected(again, 2, PercolatorError::EngineNonProgress);
    } else {
        again.expect("repeated settlement cannot pay twice");
    }
    assert_eq!(env.token_amount(env.actors[0].destination_token), 1_750);
    for _ in 0..16 {
        if resolved_actor_terminal(&env, 0) {
            break;
        }
        env.svm.expire_blockhash();
        let ix = if use_keeper {
            payout_ix(&env)
        } else {
            resolved_close(&env, 0, "closeResolved")
        };
        send(&mut env, ix, &[signer]).expect("finish JS close continuations");
    }
    assert!(resolved_actor_terminal(&env, 0));
    assert_eq!(env.token_amount(env.actors[0].destination_token), 1_750);
    assert_eq!(env.mint_supply(), supply);
    finish_market_teardown(&mut env, &owner, &payer, supply);
    eprintln!(
        "JS resolved receipt: keeper={use_keeper}, initial={initial_paid}, topup={due}, total=1750"
    );
}

fn finish_market_teardown(env: &mut V16Svm, owner: &Keypair, payer: &Keypair, supply: u64) {
    let portfolio = env.actors[0].portfolio;
    env.update_market_authority_from_admin(4)
        .expect("public market authority handoff");
    let admin = Keypair::from_bytes(&env.actors[4].signer.to_bytes()).unwrap();
    let before = snapshot(env, &[portfolio]);
    let premature = slab_close(env);
    rejected(
        send(env, premature, &[payer, &admin]),
        2,
        PercolatorError::EngineLockActive,
    );
    assert_unchanged(env, &before);
    let close = portfolio_close(env, 0);
    for offset in [1usize, 9, 17] {
        let mut stale = close.clone();
        stale.data[offset] ^= 1;
        rejected(
            send(env, stale, &[payer, owner]),
            2,
            PercolatorError::EngineStale,
        );
        assert_unchanged(env, &before);
    }
    let mut wrong_owner = close.clone();
    wrong_owner.accounts[0].pubkey = payer.pubkey();
    rejected(
        send(env, wrong_owner, &[payer]),
        2,
        PercolatorError::Unauthorized,
    );
    assert_unchanged(env, &before);
    let invalid = Instruction {
        program_id: env.program_id,
        accounts: vec![],
        data: vec![255],
    };
    assert_eq!(
        send_many(env, &[close.clone(), invalid.clone()], &[payer, owner]).unwrap_err(),
        TransactionError::InstructionError(3, InstructionError::InvalidInstructionData)
    );
    assert_unchanged(env, &before);
    let market_lamports = env.svm.get_account(&env.market).unwrap().lamports;
    let account_lamports = env.svm.get_account(&portfolio).unwrap().lamports;
    let owner_lamports = env.svm.get_account(&owner.pubkey()).unwrap().lamports;
    let tokens = env.all_token_account_data();
    send(env, close, &[payer, owner]).expect("JS removes the final portfolio");
    assert_closed_portfolio(env, portfolio);
    assert_eq!(
        env.svm.get_account(&env.market).unwrap().lamports,
        market_lamports + account_lamports
    );
    assert_eq!(
        env.svm.get_account(&owner.pubkey()).unwrap().lamports,
        owner_lamports
    );
    assert_eq!(env.all_token_account_data(), tokens);
    let group = env.primary_market_state().1;
    assert_eq!(
        (
            group.materialized_portfolio_count,
            group.c_tot,
            group.vault,
            group.insurance
        ),
        (0, 0, 0, 0)
    );

    // Unbooked SPL surplus is distinct from user claims and protocol residue.
    let donation = spl_token::instruction::transfer(
        &spl_token::ID,
        &env.actors[0].source_token,
        &env.vault,
        &owner.pubkey(),
        &[],
        7,
    )
    .unwrap();
    send(env, donation, &[payer, owner]).expect("donate seven unbooked collateral atoms");
    let before = snapshot(env, &[]);
    let ix = slab_close(env);
    let mut stale = ix.clone();
    stale.data[1] ^= 1;
    rejected(
        send(env, stale, &[payer, &admin]),
        2,
        PercolatorError::EngineStale,
    );
    assert_unchanged(env, &before);
    let mut wrong_authority = ix.clone();
    wrong_authority.accounts[0].pubkey = owner.pubkey();
    wrong_authority.accounts[4].pubkey = env.actors[0].destination_token;
    rejected(
        send(env, wrong_authority, &[payer, owner]),
        2,
        PercolatorError::Unauthorized,
    );
    assert_unchanged(env, &before);
    let mut wrong = ix.clone();
    wrong.accounts[4].pubkey = env.actors[0].destination_token;
    rejected(
        send(env, wrong, &[payer, &admin]),
        2,
        PercolatorError::InvalidTokenAccount,
    );
    assert_unchanged(env, &before);
    assert_eq!(
        send_many(env, &[ix.clone(), invalid], &[payer, &admin]).unwrap_err(),
        TransactionError::InstructionError(3, InstructionError::InvalidInstructionData)
    );
    assert_unchanged(env, &before);
    let rent = env
        .svm
        .get_sysvar::<Rent>()
        .minimum_balance(percolator_prog::constants::HEADER_LEN);
    let refund = env.svm.get_account(&env.market).unwrap().lamports - rent
        + env.svm.get_account(&env.vault).unwrap().lamports;
    let admin_lamports = env.svm.get_account(&admin.pubkey()).unwrap().lamports;
    let admin_tokens = env.token_amount(env.actors[4].destination_token);
    // The earlier failed attempt used the same instruction. A later state does
    // not make that signature new; retry with a fresh blockhash.
    env.svm.expire_blockhash();
    send(env, ix.clone(), &[payer, &admin])
        .expect("JS closes the vault and writes the market tombstone");
    let tombstone = env.svm.get_account(&env.market).unwrap();
    assert_eq!(tombstone.lamports, rent);
    assert_eq!(tombstone.data.len(), percolator_prog::constants::HEADER_LEN);
    assert_eq!(
        tombstone.data[10],
        percolator_prog::constants::KIND_CLOSED_MARKET
    );
    assert_closed_portfolio(env, env.vault);
    assert_eq!(
        env.svm.get_account(&admin.pubkey()).unwrap().lamports,
        admin_lamports + refund
    );
    assert_eq!(
        env.token_amount(env.actors[4].destination_token),
        admin_tokens + 7
    );
    assert_eq!(env.token_amount(env.actors[0].destination_token), 1_750);
    assert_eq!(env.mint_supply(), supply);
    let terminal_keys = [
        env.market,
        env.vault,
        env.mint,
        owner.pubkey(),
        admin.pubkey(),
        env.actors[0].destination_token,
        env.actors[4].destination_token,
    ];
    let terminal_accounts = terminal_keys.map(|key| env.svm.get_account(&key));
    env.svm.expire_blockhash();
    assert!(
        send(env, ix, &[payer, &admin]).is_err(),
        "a closed market cannot close again"
    );
    assert_eq!(
        terminal_keys.map(|key| env.svm.get_account(&key)),
        terminal_accounts
    );
    eprintln!("JS teardown: all primary portfolios removed, seven surplus atoms swept, vault closed, exact rent refund and persistent tombstone");
}

fn js(input: Value) -> Value {
    let driver = std::env::var("OUTRIGHT_NATIVE_DRIVER").expect("SVM driver path");
    let mut child = Command::new("node")
        .arg(driver)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start native adapter");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "adapter: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("adapter JSON")
}

fn read(env: &V16Svm, address: Pubkey, owner: Pubkey) -> Value {
    let account = env.svm.get_account(&address).unwrap();
    js(json!({"operation":"readPortfolio",
        "account":{"owner":account.owner.to_string(),"executable":account.executable,"data":account.data},
        "expected":{"programId":env.program_id.to_string(),"address":address.to_string(),
            "market":env.market.to_string(),"owner":owner.to_string()}}))
}

fn build(env: &V16Svm, name: &str, args: Value, accounts: Value) -> Instruction {
    let out = js(
        json!({"operation":"buildInstruction","program":env.program_id.to_string(),
        "name":name,"args":args,"accounts":accounts}),
    );
    from_js_instruction(&out)
}

fn from_js_instruction(out: &Value) -> Instruction {
    Instruction {
        program_id: Pubkey::from_str(out["programId"].as_str().unwrap()).unwrap(),
        accounts: out["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| AccountMeta {
                pubkey: Pubkey::from_str(k["pubkey"].as_str().unwrap()).unwrap(),
                is_signer: k["isSigner"].as_bool().unwrap(),
                is_writable: k["isWritable"].as_bool().unwrap(),
            })
            .collect(),
        data: out["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| u8::try_from(n.as_u64().unwrap()).unwrap())
            .collect(),
    }
}

fn planned_recovery_exit(env: &V16Svm, actor: usize) -> Instruction {
    planned_recovery_exit_for(env, actor, 0)
}

fn planned_recovery_exit_for(env: &V16Svm, actor: usize, asset_index: usize) -> Instruction {
    let owner = env.actors[actor].signer.pubkey();
    let group = env.primary_market_state().1;
    let plan = js(json!({"operation":"planAction", "owner":owner.to_string(),
        "slot":env.current_slot(),
        "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
            "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"}},
        "marketAccount":account_json(env,env.market),
        "portfolioAccount":account_json(env,env.actors[actor].portfolio),
        "action":{"type":"forfeitRecoveryLeg","assetIndex":asset_index,"marketId":group.assets[asset_index].market_id.to_string(),
            "budget":"0.000001","acceptForfeiture":true}}));
    assert_eq!(plan["rentLamports"], 0);
    assert_eq!(plan["instructions"].as_array().unwrap().len(), 1);
    from_js_instruction(&plan["instructions"][0])
}

#[test]
fn recovery_obligation_survives_wallet_refresh_and_keeper_finalization_to_exact_payout() {
    use percolator::{MarketModeV16, PermissionlessRecoveryReasonV16, POS_SCALE};
    use percolator_prog::ix::CrankObservationHint;
    // Adapt pinned INV-071 for Outright's readers and planners. Recovery state
    // comes from deposits, trades, authenticated marks and SBF continuations.
    for direction in [1i128, -1] {
        let config = MarketConfig {
            initial_price: 100,
            max_price_move_bps_per_slot: 10_000,
            max_accrual_dt_slots: 1,
            min_funding_lifetime_slots: 1,
            max_bankrupt_close_lifetime_slots: 2,
            public_b_chunk_atoms: 1,
            actor_deposits: [0; 5],
            ..MarketConfig::default()
        };
        let mut env = V16Svm::new_with_asset_count([104; 32], config, 2);
        env.configure_permissionless_resolve(100, 5).unwrap();
        for actor in [0, 1, 3] {
            env.close_primary_portfolio(actor).unwrap();
            let owner = Keypair::from_bytes(&env.actors[actor].signer.to_bytes()).unwrap();
            let plan = js(
                json!({"operation":"planAction", "owner":owner.pubkey().to_string(),
                "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
                    "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"}},
                "marketAccount":account_json(&env,env.market),"action":{"type":"initialize"},
                "rentLamports":Rent::default().minimum_balance(percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN)}),
            );
            let instructions: Vec<_> = plan["instructions"]
                .as_array()
                .unwrap()
                .iter()
                .map(from_js_instruction)
                .collect();
            send_many(&mut env, &instructions, &[&owner]).unwrap();
            env.actors[actor].portfolio =
                Pubkey::from_str(plan["portfolio"].as_str().unwrap()).unwrap();
        }
        for (actor, amount) in [(0, 1_000), (1, 1_000), (2, 10), (3, 2)] {
            env.deposit_primary(actor, amount).unwrap();
        }
        let supply = env.mint_supply();
        let payer = Keypair::new();
        env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
        let ata = js(
            json!({"operation":"createPayoutAta", "payer":payer.pubkey().to_string(),
            "owner":owner.pubkey().to_string(),"mint":env.mint.to_string()}),
        );
        send(
            &mut env,
            from_js_instruction(&ata["instruction"]),
            &[&payer],
        )
        .unwrap();
        env.actors[0].destination_token =
            Pubkey::from_str(ata["address"].as_str().unwrap()).unwrap();
        env.trade_no_cpi(0, 1, 0, direction * POS_SCALE as i128, 100, 0)
            .unwrap();
        env.trade_no_cpi(2, 3, 1, (POS_SCALE / 50) as i128, 100, 0)
            .unwrap();
        for (slot, price) in [(2, 200), (3, 300)] {
            env.warp_to_slot(slot);
            env.push_auth_mark(1, slot, price).unwrap();
            env.crank(
                2,
                slot,
                vec![CrankObservationHint {
                    asset_index: 1,
                    oracle_accounts: 0,
                }],
            )
            .unwrap();
        }
        env.crank(
            3,
            3,
            vec![CrankObservationHint {
                asset_index: 1,
                oracle_accounts: 0,
            }],
        )
        .unwrap();
        env.warp_to_slot(4);
        for asset in [0, 1] {
            env.shutdown_asset(asset, 4).unwrap();
        }
        let ix = planned_recovery_exit(&env, 0);
        send(&mut env, ix, &[&owner]).unwrap();
        let p = env.primary_portfolio(0);
        let obligation = p.legs.iter().find(|leg| leg.active != 0).unwrap();
        assert_eq!(obligation.basis_pos_q.get(), 0);
        assert_eq!(obligation.loss_weight.get(), POS_SCALE);
        assert_eq!(obligation.stale, 0);
        assert_eq!(obligation.b_stale, 0);
        let before = snapshot(&env, &[env.actors[0].portfolio]);
        let error = env
            .close_primary_portfolio(0)
            .expect_err("an obligation cannot be discarded by account closure");
        assert!(
            error.contains(&format!(
                "Custom({})",
                PercolatorError::EngineLockActive as u32
            )),
            "{error}"
        );
        assert_unchanged(&env, &before);
        // A successful exit must remain readable even while loss weight stays attached.
        let parsed = read(&env, env.actors[0].portfolio, owner.pubkey());
        assert_eq!(parsed["positions"][0]["basis_pos_q"], "0");
        let display = js(json!({"operation":"positions",
            "marketAccount":account_json(&env,env.market),
            "marketExpected":{"programId":env.program_id.to_string(),"address":env.market.to_string()},
            "portfolioAccount":account_json(&env,env.actors[0].portfolio),
            "portfolioExpected":{"programId":env.program_id.to_string(),"address":env.actors[0].portfolio.to_string(),
                "market":env.market.to_string(),"owner":owner.pubkey().to_string()}}));
        assert_eq!(display[0]["effectiveSizeQ"], "0");
        assert_eq!(display[0]["needsCleanup"], true);
        assert_eq!(
            display[0]["side"],
            if direction == 1 { "long" } else { "short" }
        );
        for (actor, asset) in [(1, 0), (3, 1)] {
            let signer = Keypair::from_bytes(&env.actors[actor].signer.to_bytes()).unwrap();
            let ix = planned_recovery_exit_for(&env, actor, asset);
            send(&mut env, ix, &[&signer]).unwrap();
        }
        let close = env
            .primary_portfolio(3)
            .close_progress
            .try_to_runtime()
            .unwrap();
        assert_eq!(close.residual_remaining, 1);
        assert_eq!(env.primary_market_state().1.mode, MarketModeV16::Live);
        let expiry = close.max_close_slot + 1;
        env.warp_to_slot(expiry);
        env.svm.expire_blockhash();
        let custody_before = env.all_token_account_data();
        let ix = continuation_instruction(&env, payer.pubkey(), expiry, 1, 3);
        send(&mut env, ix, &[&payer]).expect("expired close declares market Recovery");
        let recovered = env.primary_market_state().1;
        assert_eq!(recovered.mode, MarketModeV16::Recovery);
        assert_eq!(
            recovered.recovery_reason,
            Some(PermissionlessRecoveryReasonV16::ActiveBankruptCloseCannotProgress)
        );
        let epoch = env.primary_portfolio_position_epoch(0);
        let ix = continuation_instruction(&env, payer.pubkey(), expiry, 0, 0);
        assert_eq!(ix.accounts.len(), 3);
        assert_eq!(
            ix.data[9], 0,
            "Recovery never requires live oracle observations"
        );
        let before = snapshot(
            &env,
            &[env.actors[0].portfolio, env.actors[0].destination_token],
        );
        let invalid = Instruction {
            program_id: env.program_id,
            accounts: vec![],
            data: vec![255],
        };
        assert_eq!(
            send_many(&mut env, &[ix.clone(), invalid], &[&payer]).unwrap_err(),
            TransactionError::InstructionError(3, InstructionError::InvalidInstructionData)
        );
        assert_unchanged(&env, &before);
        send(&mut env, ix, &[&payer]).expect("keeper releases the retained obligation");
        assert_eq!(env.primary_portfolio_position_epoch(0), epoch + 1);
        assert!(
            read(&env, env.actors[0].portfolio, owner.pubkey())["positions"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(env.primary_market_state().1.mode, MarketModeV16::Recovery);
        assert_eq!(env.primary_portfolio(0).capital.get(), 1_000);
        assert_eq!(env.all_token_account_data(), custody_before);
        let final_slot = expiry + 9;
        env.warp_to_slot(final_slot);
        env.svm.expire_blockhash();
        let ix = continuation_instruction(&env, payer.pubkey(), 0, 0, 0);
        send(&mut env, ix, &[&payer]).expect("a later continuation finalizes Recovery");
        let resolved = env.primary_market_state().1;
        assert_eq!(resolved.mode, MarketModeV16::Resolved);
        assert_eq!(resolved.resolved_slot, final_slot);
        assert_eq!(resolved.assets[0].slot_last, recovered.assets[0].slot_last);
        assert_eq!(resolved.assets[1].slot_last, recovered.assets[1].slot_last);
        assert_eq!(env.token_amount(env.vault), 2_012);
        let deadline = final_slot + 5;
        env.warp_to_slot(deadline - 1);
        let before = snapshot(
            &env,
            &[env.actors[0].portfolio, env.actors[0].destination_token],
        );
        let ix = continuation_instruction(&env, payer.pubkey(), deadline, 0, 0);
        rejected(
            send(&mut env, ix, &[&payer]),
            2,
            PercolatorError::ExpectedSigner,
        );
        assert_unchanged(&env, &before);
        env.warp_to_slot(deadline);
        env.svm.expire_blockhash();
        let capital = env.primary_market_state().1.c_tot;
        let ix = continuation_instruction(&env, payer.pubkey(), deadline, 0, 0);
        send(&mut env, ix, &[&payer]).expect("permissionless payout after the owner window");
        assert_eq!(env.token_amount(env.actors[0].destination_token), 1_000);
        assert_eq!(env.token_amount(env.vault), 1_012);
        assert_eq!(env.primary_market_state().1.c_tot, capital - 1_000);
        assert!(resolved_actor_terminal(&env, 0));
        env.svm.expire_blockhash();
        let before = snapshot(
            &env,
            &[env.actors[0].portfolio, env.actors[0].destination_token],
        );
        let ix = continuation_instruction(&env, payer.pubkey(), deadline, 0, 0);
        rejected(
            send(&mut env, ix, &[&payer]),
            2,
            PercolatorError::EngineNonProgress,
        );
        assert_unchanged(&env, &before);
        let market_rent = env.svm.get_account(&env.market).unwrap().lamports;
        let portfolio_rent = env
            .svm
            .get_account(&env.actors[0].portfolio)
            .unwrap()
            .lamports;
        env.close_primary_portfolio(0)
            .expect("only the terminal portfolio can be removed");
        // The legacy VM may retain an empty account entry until bank cleanup.
        if let Some(closed) = env.svm.get_account(&env.actors[0].portfolio) {
            assert_eq!(closed.lamports, 0);
            assert!(closed.data.is_empty());
        }
        assert_eq!(
            env.svm.get_account(&env.market).unwrap().lamports,
            market_rent + portfolio_rent
        );
        assert_eq!(env.mint_supply(), supply);
        eprintln!("JS Recovery continuation: direction={direction}, obligation cleaned, authenticated finalization, exactly 1000 atoms paid, rent returned to market");
    }
}

#[test]
fn wallet_recovery_exit_forfeits_unbooked_gain_applies_loss_and_rejects_stale_consent() {
    use percolator_prog::ix::CrankObservationHint;
    let config = MarketConfig {
        initial_price: 100,
        maintenance_margin_bps: 1_000,
        initial_margin_bps: 1_000,
        max_price_move_bps_per_slot: 500,
        max_accrual_dt_slots: 1,
        actor_deposits: [0; 5],
        ..MarketConfig::default()
    };
    let mut env = V16Svm::new_with_asset_count([103; 32], config, 1);
    env.configure_permissionless_resolve(100, 1).unwrap();
    // Create the wallet client's deterministic portfolios through System/SBF.
    for actor in [0, 1] {
        let owner = Keypair::from_bytes(&env.actors[actor].signer.to_bytes()).unwrap();
        let plan = js(
            json!({"operation":"planAction", "owner":owner.pubkey().to_string(),
            "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
                "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"}},
            "marketAccount":account_json(&env,env.market),"action":{"type":"initialize"},
            "rentLamports":Rent::default().minimum_balance(percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN)}),
        );
        let instructions: Vec<_> = plan["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        send_many(&mut env, &instructions, &[&owner]).unwrap();
        env.actors[actor].portfolio =
            Pubkey::from_str(plan["portfolio"].as_str().unwrap()).unwrap();
        env.deposit_primary(actor, 1_000).unwrap();
    }
    let supply = env.mint_supply();
    env.trade_no_cpi(0, 1, 0, 10 * percolator::POS_SCALE as i128, 100, 0)
        .unwrap();
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let other = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
    let mut active = build(
        &env,
        "forfeitRecoveryLeg",
        json!({"portfolioId":env.primary_portfolio_id(0).to_string(),
            "positionEpoch":env.primary_portfolio_position_epoch(0).to_string(),
            "assetIndex":0,"bDeltaBudget":"1"}),
        json!({"owner":owner.pubkey().to_string(),"market":env.market.to_string(),"portfolio":env.actors[0].portfolio.to_string()}),
    );
    let before = snapshot(&env, &[env.actors[0].portfolio, env.actors[1].portfolio]);
    rejected(
        send(&mut env, active.clone(), &[&owner]),
        2,
        PercolatorError::EngineLockActive,
    );
    assert_unchanged(&env, &before);
    env.warp_to_slot(2);
    env.push_auth_mark(0, 2, 105).unwrap();
    // Accrue with an unrelated empty portfolio, leaving both traders' K/F stale.
    env.crank(
        2,
        2,
        vec![CrankObservationHint {
            asset_index: 0,
            oracle_accounts: 0,
        }],
    )
    .unwrap();
    assert_eq!(env.primary_market_state().1.assets[0].effective_price, 105);
    assert_eq!(env.primary_portfolio(0).pnl.get(), 0);
    assert_eq!(env.primary_portfolio(1).pnl.get(), 0);
    assert_ne!(
        env.primary_portfolio(0).legs[0].k_snap.get(),
        env.primary_market_state().1.assets[0].k_long,
        "the winner still has an unbooked price gain"
    );
    env.shutdown_asset(0, 2).unwrap();
    env.svm.expire_blockhash();
    assert_eq!(
        env.primary_market_state().1.assets[0].lifecycle,
        percolator::AssetLifecycleV16::Recovery
    );
    active = planned_recovery_exit(&env, 0);
    let before = snapshot(&env, &[env.actors[0].portfolio, env.actors[1].portfolio]);
    let mut wrong_owner = active.clone();
    wrong_owner.accounts[0].pubkey = other.pubkey();
    rejected(
        send(&mut env, wrong_owner, &[&other]),
        2,
        PercolatorError::Unauthorized,
    );
    assert_unchanged(&env, &before);
    let mut stale = active.clone();
    stale.data[9..17].copy_from_slice(&(env.primary_portfolio_position_epoch(0) + 1).to_le_bytes());
    rejected(
        send(&mut env, stale, &[&owner]),
        2,
        PercolatorError::EngineProvenanceMismatch,
    );
    assert_unchanged(&env, &before);
    let invalid = Instruction {
        program_id: env.program_id,
        accounts: vec![],
        data: vec![255],
    };
    assert_eq!(
        send_many(&mut env, &[active.clone(), invalid], &[&owner]).unwrap_err(),
        TransactionError::InstructionError(3, InstructionError::InvalidInstructionData)
    );
    assert_unchanged(&env, &before);
    let custody_before = env.all_token_account_data();
    let epoch = env.primary_portfolio_position_epoch(0);
    send(&mut env, active.clone(), &[&owner]).expect("owner-reviewed Recovery gain forfeiture");
    assert_eq!(env.primary_portfolio_position_epoch(0), epoch + 1);
    assert_eq!(env.primary_portfolio(0).capital.get(), 1_000);
    assert_eq!(
        env.primary_portfolio(0).pnl.get(),
        0,
        "the unbooked 50-atom gain is discarded"
    );
    env.svm.expire_blockhash();
    let before = snapshot(&env, &[env.actors[0].portfolio, env.actors[1].portfolio]);
    rejected(
        send(&mut env, active, &[&owner]),
        2,
        PercolatorError::EngineProvenanceMismatch,
    );
    assert_unchanged(&env, &before);
    let loss = planned_recovery_exit(&env, 1);
    send(&mut env, loss, &[&other]).expect("owner-reviewed Recovery loss settlement");
    assert_eq!(
        env.primary_portfolio(1).capital.get(),
        950,
        "a one-atom shared-loss budget does not cap the 50-atom price loss"
    );
    assert_eq!(
        env.all_token_account_data(),
        custody_before,
        "forfeit does not transfer tokens"
    );
    assert_eq!(env.mint_supply(), supply);
    eprintln!("JS Recovery exit: 50 atoms forfeited, 50 atoms charged, one-atom B budget; custody unchanged");
}

fn account_json(env: &V16Svm, address: Pubkey) -> Value {
    match env.svm.get_account(&address) {
        Some(a) => {
            json!({"owner":a.owner.to_string(),"executable":a.executable,"data":a.data,"lamports":a.lamports})
        }
        None => Value::Null,
    }
}

fn keeper_instruction(env: &V16Svm, payer: Pubkey, oracle: Pubkey, feed: [u8; 32]) -> Instruction {
    keeper_instruction_for(env, payer, 0, oracle, feed)
}

fn keeper_instruction_for(
    env: &V16Svm,
    payer: Pubkey,
    actor: usize,
    oracle: Pubkey,
    feed: [u8; 32],
) -> Instruction {
    let target = env.actors[actor].portfolio;
    let market_id = env.primary_market_state().1.assets[0].market_id;
    let input = json!({"operation":"planCrank", "slot":env.current_slot(), "discoveryIndex":0,
        "config":{"deployment":{"program":{"address":env.program_id.to_string()},
            "market":env.market.to_string(),"collateral":{"mint":env.mint.to_string()}},
            "feePayer":payer.to_string(),
            "assets":[{"index":0,"marketId":market_id.to_string(),"oracleMode":1,
                "feeds":[{"id":Pubkey::new_from_array(feed).to_string(),"account":oracle.to_string()}]}]},
        "target":{"address":target.to_string(),"owner":env.actors[actor].signer.pubkey().to_string()},
        "marketAccount":account_json(env,env.market),"portfolioAccount":account_json(env,target)});
    from_js_instruction(&js(input))
}

// AuthMark is a local funding fixture, not a supported devnet keeper profile.
fn managed_crank_instruction(env: &V16Svm, payer: Pubkey, actor: usize) -> Instruction {
    build(
        env,
        "permissionlessCrank",
        json!({"nowSlot":env.current_slot().to_string(),
            "observations":[{"assetIndex":0,"oracleAccounts":0}]}),
        json!({"owner":payer.to_string(),"market":env.market.to_string(),
            "portfolio":env.actors[actor].portfolio.to_string(),"oracleAccounts":[]}),
    )
}

#[test]
fn javascript_crank_preserves_fractional_funding_across_settlement_cadence() {
    // 123.456789 units at a price of 0.000100 for 24 slots at the 10,000 e9
    // funding cap transfer exactly 2.962962936 collateral atoms. The payer
    // owes three atoms; the receiver gets two. Two 12-slot settlements must
    // preserve the fractional carry instead of charging the payer four atoms.
    for premium in [-1i64, 1] {
        for step in [12u64, 24] {
            let mut config = MarketConfig::default();
            config.initial_price = 100;
            config.max_price_move_bps_per_slot = 1;
            config.max_abs_funding_e9_per_slot = 10_000;
            config.max_accrual_dt_slots = 32;
            config.min_funding_lifetime_slots = 32;
            let seed = 94 + u8::from(premium > 0) * 2 + u8::from(step == 12);
            let mut env = V16Svm::new_with_asset_count([seed; 32], config, 1);
            let quantity = 123_456_789i128;
            env.trade_no_cpi(0, 1, 0, quantity, 100, 0).unwrap();
            let payer = Keypair::new();
            env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
            let custody = env.all_token_account_data();
            let market_before = env.primary_market_state().1;
            env.set_clock(2, 1_001);
            env.push_auth_mark(0, 2, (100 + premium) as u64).unwrap();
            let ix = managed_crank_instruction(&env, payer.pubkey(), 2);
            send(&mut env, ix, &[&payer]).expect("activate the authenticated premium");
            assert_eq!(env.primary_market_state().1.assets[0].f_long_num, 0);
            let debtor = usize::from(premium < 0);
            let creditor = 1 - debtor;
            let order = if step == 12 {
                [creditor, debtor]
            } else {
                [debtor, creditor]
            };
            for slot in (2 + step..=26).step_by(step as usize) {
                env.set_clock(slot, 999 + slot as i64);
                let ix = managed_crank_instruction(&env, payer.pubkey(), 2);
                send(&mut env, ix, &[&payer])
                    .expect("accrue funding without settling either trader");
                for actor in order {
                    let ix = managed_crank_instruction(&env, payer.pubkey(), actor);
                    if slot == 2 + step && actor == order[0] {
                        let owner =
                            Keypair::from_bytes(&env.actors[actor].signer.to_bytes()).unwrap();
                        let duplicate = build(
                            &env,
                            "initPortfolio",
                            json!({}),
                            json!({"owner":owner.pubkey().to_string(),"market":env.market.to_string(),
                                "portfolio":env.actors[actor].portfolio.to_string()}),
                        );
                        let before =
                            snapshot(&env, &[env.actors[0].portfolio, env.actors[1].portfolio]);
                        rejected(
                            send_many(&mut env, &[ix.clone(), duplicate], &[&payer, &owner]),
                            3,
                            PercolatorError::AlreadyInitialized,
                        );
                        assert_unchanged(&env, &before);
                    }
                    send(&mut env, ix, &[&payer]).expect("settle a trader's funding");
                }
                eprintln!("funding premium={premium} step={step} slot={slot}: payer capital={} pnl={}, receiver capital={} pnl={}",
                    env.primary_portfolio(debtor).capital.get(),env.primary_portfolio(debtor).pnl.get(),
                    env.primary_portfolio(creditor).capital.get(),env.primary_portfolio(creditor).pnl.get());
                assert_eq!(env.all_token_account_data(), custody);
            }
            let market = env.primary_market_state().1;
            let expected_index =
                -i128::from(premium) * 10_000 * 24 * 100 * percolator::ADL_ONE as i128
                    / percolator::FUNDING_DEN as i128;
            assert_eq!(market.assets[0].slot_last, 26);
            assert_eq!(market.assets[0].effective_price, 100);
            assert_eq!(market.assets[0].f_long_num, expected_index);
            assert_eq!(market.assets[0].f_short_num, -expected_index);
            assert_eq!(env.primary_portfolio(creditor).pnl.get(), 2);
            assert_eq!(
                env.primary_portfolio(creditor).capital.get(),
                config.actor_deposits[creditor]
            );
            assert_eq!(env.primary_portfolio(debtor).pnl.get(), 0);
            assert_eq!(
                env.primary_portfolio(debtor).capital.get(),
                config.actor_deposits[debtor] - 3
            );
            assert_eq!(market.vault, market_before.vault);
            assert_eq!(market.c_tot, market_before.c_tot - 3);
            assert_eq!(market.insurance, market_before.insurance);
            for actor in 0..2 {
                let p = read(
                    &env,
                    env.actors[actor].portfolio,
                    env.actors[actor].signer.pubkey(),
                );
                assert_eq!(p["pnl"], if actor == creditor { "2" } else { "0" });
                assert_eq!(
                    p["capital"],
                    (config.actor_deposits[actor] - if actor == debtor { 3 } else { 0 })
                        .to_string()
                );
                // Another account's settlement may require a certificate or
                // source-credit refresh. None may collect the funding again.
                let mut idle = false;
                for _ in 0..4 {
                    let before =
                        snapshot(&env, &[env.actors[0].portfolio, env.actors[1].portfolio]);
                    env.svm.expire_blockhash();
                    let ix = managed_crank_instruction(&env, payer.pubkey(), actor);
                    let result = send(&mut env, ix, &[&payer]);
                    if result.is_err() {
                        rejected(result, 2, PercolatorError::EngineNonProgress);
                        assert_unchanged(&env, &before);
                        idle = true;
                        break;
                    }
                    assert_eq!(env.primary_portfolio(creditor).pnl.get(), 2);
                    assert_eq!(
                        env.primary_portfolio(debtor).capital.get(),
                        config.actor_deposits[debtor] - 3
                    );
                    assert_eq!(env.primary_market_state().1.c_tot, market.c_tot);
                    assert_eq!(env.primary_market_state().1.insurance, market.insurance);
                    assert_eq!(env.all_token_account_data(), custody);
                }
                assert!(idle, "same-slot funding retries must reach non-progress");
            }
        }
    }
}

fn oracle_keeper_fixture(seed: u8) -> (V16Svm, Pubkey, [u8; 32]) {
    let mut config = MarketConfig::default();
    config.initial_price = 150_000_000;
    let mut env = V16Svm::new_with_asset_count([seed; 32], config, 1);
    let feed = [77; 32];
    env.set_clock(1, 1_000);
    let oracle = env.set_pyth_price(&feed, 150_000_000, -6, 10, 1_000);
    env.configure_hybrid_oracle(0, 1, 1_000, 0, [feed, [0; 32], [0; 32]], &[oracle], 10, 100)
        .expect("configure authenticated Pyth fixture through SBF");
    (env, oracle, feed)
}

#[test]
fn keeper_planner_liquidates_unhealthy_positions_and_preserves_custody() {
    for direction in [-1i128, 1] {
        let mut config = MarketConfig::default();
        config.initial_price = 150_000_000;
        config.initial_margin_bps = 500;
        config.maintenance_margin_bps = 500;
        config.min_nonzero_mm_req = 1_000;
        config.min_nonzero_im_req = 1_001;
        config.max_price_move_bps_per_slot = 300;
        config.max_accrual_dt_slots = 1;
        config.min_funding_lifetime_slots = 1;
        config.liquidation_fee_bps = 100;
        config.liquidation_fee_cap = 1_000_000;
        config.actor_deposits[0] = 10_000_000;
        let mut env = V16Svm::new_with_asset_count([98 + u8::from(direction > 0); 32], config, 1);
        let feed = [79; 32];
        env.set_clock(1, 1_000);
        let oracle = env.set_pyth_price(&feed, 150_000_000, -6, 10, 1_000);
        env.configure_hybrid_oracle(0, 1, 1_000, 0, [feed, [0; 32], [0; 32]], &[oracle], 10, 100)
            .unwrap();
        env.set_matcher_config_with_trade_fee_cap(1, 1, 0).unwrap();
        env.set_matcher_spreads(1, 0, 0).unwrap();
        env.trade_cpi(0, 1, 0, direction * 1_000_000, 0, 150_000_000)
            .unwrap();
        let target = env.actors[0].portfolio;
        let peer = env.actors[1].portfolio;
        let peer_before = env.svm.get_account(&peer).unwrap();
        let custody_before = env.all_token_account_data();
        let market_before = env.primary_market_state().1;
        let payer = Keypair::new();
        env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
        let duplicate = build(
            &env,
            "initPortfolio",
            json!({}),
            json!({"owner":owner.pubkey().to_string(),"market":env.market.to_string(),"portfolio":target.to_string()}),
        );
        let price = (150_000_000 - direction * 5_000_000) as u64;
        env.set_clock(2, 1_001);
        env.update_pyth_price(oracle, &feed, price as i64, -6, 10, 1_001);
        let ix = keeper_instruction_for(&env, payer.pubkey(), 2, oracle, feed);
        send(&mut env, ix, &[&payer]).expect("first bounded oracle price move");
        env.set_clock(3, 1_002);
        env.update_pyth_price(oracle, &feed, price as i64, -6, 10, 1_002);
        let ix = keeper_instruction_for(&env, payer.pubkey(), 2, oracle, feed);
        send(&mut env, ix, &[&payer]).expect("finish the authenticated price move");
        let mut remaining = 1_000_000u128;
        let mut steps = 0;
        while remaining == 1_000_000 && steps < 4 {
            if steps == 1 {
                // The portfolio is now refreshed and unhealthy. Stale evidence
                // must still reject the liquidation and preserve all state.
                env.update_pyth_price(oracle, &feed, price as i64, -6, 10, 900);
                let stale = keeper_instruction_for(&env, payer.pubkey(), 0, oracle, feed);
                let before = snapshot(&env, &[target, peer]);
                env.svm.expire_blockhash();
                rejected(
                    send(&mut env, stale, &[&payer]),
                    2,
                    PercolatorError::OracleStale,
                );
                assert_unchanged(&env, &before);
                env.update_pyth_price(oracle, &feed, price as i64, -6, 10, 1_002);
            }
            let ix = keeper_instruction_for(&env, payer.pubkey(), 0, oracle, feed);
            let before = snapshot(&env, &[target, peer]);
            rejected(
                send_many(
                    &mut env,
                    &[ix.clone(), duplicate.clone()],
                    &[&payer, &owner],
                ),
                3,
                PercolatorError::AlreadyInitialized,
            );
            assert_unchanged(&env, &before);
            env.svm.expire_blockhash();
            send(&mut env, ix, &[&payer]).expect("permissionless refresh or liquidation");
            steps += 1;
            remaining = env.primary_portfolio(0).legs[0]
                .basis_pos_q
                .get()
                .unsigned_abs();
            eprintln!("liquidation direction={direction} step={steps} remaining={remaining} capital={} pnl={} insurance={}",
                env.primary_portfolio(0).capital.get(), env.primary_portfolio(0).pnl.get(), env.primary_market_state().1.insurance);
            assert_eq!(env.all_token_account_data(), custody_before);
            assert_eq!(env.svm.get_account(&peer).unwrap(), peer_before);
        }
        assert!(
            remaining > 0 && remaining < 1_000_000,
            "bounded partial liquidation"
        );
        let closed = 1_000_000 - remaining;
        let closed_notional = (closed * u128::from(price)).div_ceil(percolator::POS_SCALE);
        let fee = (closed_notional * 100).div_ceil(10_000).min(1_000_000);
        let market = env.primary_market_state().1;
        assert_eq!(market.assets[0].effective_price, price);
        assert_eq!(env.primary_portfolio(0).pnl.get(), 0);
        assert_eq!(env.primary_portfolio(0).capital.get(), 5_000_000 - fee);
        assert_eq!(market.insurance, market_before.insurance + fee);
        assert_eq!(market.c_tot, market_before.c_tot - 5_000_000 - fee);
        assert_eq!(market.vault, market_before.vault);
        let p = read(&env, target, owner.pubkey());
        assert_eq!(p["capital"], (5_000_000 - fee).to_string());
        assert_eq!(p["pnl"], "0");
        assert_eq!(p["healthCertificate"]["valid"], true);
        assert_eq!(p["healthCertificate"]["certified_liq_deficit"], "0");
        let display = js(json!({"operation":"positions",
            "marketAccount":account_json(&env,env.market),
            "marketExpected":{"programId":env.program_id.to_string(),"address":env.market.to_string()},
            "portfolioAccount":account_json(&env,target),
            "portfolioExpected":{"programId":env.program_id.to_string(),"address":target.to_string(),
                "market":env.market.to_string(),"owner":owner.pubkey().to_string()}}));
        assert_eq!(
            display[0]["effectiveSizeQ"],
            (direction * remaining as i128).to_string()
        );
        let withdrawal = build(
            &env,
            "withdraw",
            json!({"portfolioId":p["portfolioId"],"expectedSequence":p["expectedSequence"],"amount":"1"}),
            custody(
                &env,
                target,
                owner.pubkey(),
                env.actors[0].destination_token,
            ),
        );
        let before = snapshot(&env, &[target, peer]);
        rejected(
            send(&mut env, withdrawal, &[&owner]),
            2,
            PercolatorError::EngineStale,
        );
        assert_unchanged(&env, &before);
    }
}

#[test]
fn keeper_planner_advances_authenticated_oracle_without_portfolio_owner_signature() {
    let (mut env, oracle, feed) = oracle_keeper_fixture(81);
    env.set_clock(2, 1_001);
    env.update_pyth_price(oracle, &feed, 151_000_000, -6, 10, 1_001);
    let tokens = env.all_token_account_data();
    let before = env.svm.get_account(&env.market).unwrap();
    let payer = Keypair::new();
    env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let mut ix = keeper_instruction(&env, payer.pubkey(), oracle, feed);
    assert_eq!(ix.accounts.len(), 4);
    assert!(!ix.accounts[3].is_writable && !ix.accounts[3].is_signer);
    // A forged instruction hint must not advance past the authenticated Clock.
    ix.data[1..9].copy_from_slice(&999_999u64.to_le_bytes());
    let cu = send(&mut env, ix, &[&payer]).expect("permissionless keeper oracle progress");
    let after = env.svm.get_account(&env.market).unwrap();
    assert_ne!(before.data, after.data);
    let profile = percolator_prog::state::read_asset_oracle_profile(&after.data, 0).unwrap();
    assert_eq!(profile.oracle_target_price_e6, 151_000_000);
    assert_eq!(profile.oracle_target_publish_time, 1_001);
    assert_eq!(profile.last_good_oracle_slot, 2);
    assert!(env.primary_market_state().1.current_slot <= 2);
    assert_eq!(env.all_token_account_data(), tokens);
    assert!(cu <= 1_400_000);
}

#[test]
fn keeper_oracle_failures_roll_back_market_portfolio_and_custody() {
    for (case, seed) in [
        ("stale", 82),
        ("wrong_feed", 83),
        ("confidence", 84),
        ("owner", 85),
    ] {
        let (mut env, oracle, feed) = oracle_keeper_fixture(seed);
        env.set_clock(2, 1_001);
        let (observed_feed, confidence, publish) = match case {
            "stale" => (feed, 10, 900),
            "wrong_feed" => ([78; 32], 10, 1_001),
            "confidence" => (feed, 150_000_000, 1_001),
            _ => (feed, 10, 1_001),
        };
        env.update_pyth_price(oracle, &observed_feed, 151_000_000, -6, confidence, publish);
        if case == "owner" {
            let mut account = env.svm.get_account(&oracle).unwrap();
            account.owner = Pubkey::new_unique();
            env.svm.set_account(oracle, account).unwrap();
        }
        let target = env.actors[0].portfolio;
        let before = snapshot(&env, &[target]);
        let payer = Keypair::new();
        env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let ix = keeper_instruction(&env, payer.pubkey(), oracle, feed);
        let error = send(&mut env, ix, &[&payer]).unwrap_err();
        let expected = match case {
            "stale" => InstructionError::Custom(PercolatorError::OracleStale as u32),
            "wrong_feed" => InstructionError::Custom(PercolatorError::InvalidOracleKey as u32),
            "confidence" => InstructionError::Custom(PercolatorError::OracleConfTooWide as u32),
            _ => InstructionError::IllegalOwner,
        };
        assert_eq!(
            error,
            TransactionError::InstructionError(2, expected),
            "{case}"
        );
        assert_unchanged(&env, &before);
    }
}

#[test]
fn wallet_planner_creates_seeded_portfolio_and_withdrawal_token_account() {
    wallet_planner_custody_exit(false);
}

#[test]
fn wallet_planner_resolved_close_creates_ata_and_rolls_back_atomically() {
    wallet_planner_custody_exit(true);
}

fn wallet_planner_custody_exit(resolved: bool) {
    let mut env = V16Svm::new_with_asset_count([76; 32], MarketConfig::default(), 1);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let mut input = json!({"operation":"planAction","owner":owner.pubkey().to_string(),
        "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
        "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"}},
        "marketAccount":account_json(&env,env.market),"action":{"type":"initialize"},
        "rentLamports":Rent::default().minimum_balance(percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN)});
    let init = js(input.clone());
    let portfolio = Pubkey::from_str(init["portfolio"].as_str().unwrap()).unwrap();
    let user_ata = Pubkey::from_str(init["userToken"].as_str().unwrap()).unwrap();
    assert!(env.svm.get_account(&portfolio).is_none());
    assert!(env.svm.get_account(&user_ata).is_none());
    let instructions: Vec<_> = init["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(from_js_instruction)
        .collect();
    send_many(&mut env, &instructions, &[&owner])
        .expect("system allocation and portfolio initialization");
    assert_eq!(
        read(&env, portfolio, owner.pubkey())["owner"],
        owner.pubkey().to_string()
    );

    let source = env.actors[0].source_token;
    let before = env.token_amount(source);
    let vault_before = env.token_amount(env.vault);
    input["marketAccount"] = account_json(&env, env.market);
    input["portfolioAccount"] = account_json(&env, portfolio);
    input["action"] = json!({"type":"deposit","amount":"2.5"});
    input["userToken"] = json!(source.to_string());
    input["tokenAccountExists"] = json!(true);
    input["tokenBalance"] = json!(before.to_string());
    let deposit = js(input.clone());
    let instructions: Vec<_> = deposit["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(from_js_instruction)
        .collect();
    send_many(&mut env, &instructions, &[&owner]).expect("planned deposit");
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "2500000");

    if resolved {
        env.resolve_market().expect("resolve funded portfolio");
    }
    input["marketAccount"] = account_json(&env, env.market);
    input["portfolioAccount"] = account_json(&env, portfolio);
    input["action"] = if resolved {
        json!({"type":"closeResolved"})
    } else {
        json!({"type":"withdraw","amount":"2.5"})
    };
    input.as_object_mut().unwrap().remove("userToken");
    input["tokenAccountExists"] = json!(false);
    input["rentLamports"] = json!(Rent::default().minimum_balance(165));
    let withdraw = js(input.clone());
    let instructions: Vec<_> = withdraw["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(from_js_instruction)
        .collect();
    assert_eq!(instructions.len(), 2);
    if resolved {
        let before = snapshot(&env, &[portfolio]);
        let mut failing = instructions.clone();
        failing.push(Instruction {
            program_id: env.program_id,
            accounts: vec![],
            data: vec![255],
        });
        assert_eq!(
            send_many(&mut env, &failing, &[&owner]).unwrap_err(),
            TransactionError::InstructionError(4, InstructionError::InvalidInstructionData)
        );
        assert_unchanged(&env, &before);
        assert!(
            env.svm.get_account(&user_ata).is_none(),
            "ATA creation must also roll back"
        );
    }
    send_many(&mut env, &instructions, &[&owner])
        .expect("atomic ATA creation and planned withdrawal");
    assert_eq!(env.token_amount(user_ata), 2_500_000);
    assert_eq!(env.token_amount(source), before - 2_500_000);
    assert_eq!(env.token_amount(env.vault), vault_before);
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
    if resolved {
        input["marketAccount"] = account_json(&env, env.market);
        input["portfolioAccount"] = account_json(&env, portfolio);
        input["action"] = json!({"type":"closePortfolio"});
        // Closure must not create or require a token account.
        input["tokenAccountExists"] = json!(false);
        let planned = js(input);
        assert_eq!(planned["rentLamports"], 0);
        let ixs: Vec<_> = planned["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        assert_eq!(ixs.len(), 1);
        let market_lamports = env.svm.get_account(&env.market).unwrap().lamports;
        let portfolio_lamports = env.svm.get_account(&portfolio).unwrap().lamports;
        let tokens = env.all_token_account_data();
        send_many(&mut env, &ixs, &[&owner]).expect("wallet-planned account closure");
        assert_closed_portfolio(&env, portfolio);
        assert_eq!(
            env.svm.get_account(&env.market).unwrap().lamports,
            market_lamports + portfolio_lamports
        );
        assert_eq!(env.all_token_account_data(), tokens);
    }
}

#[test]
fn wallet_planner_recovers_prefunded_addresses_with_atomic_allocation() {
    let rent = Rent::default().minimum_balance(percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN);
    for funding in [Rent::default().minimum_balance(0), rent, rent + 500] {
        let mut env = V16Svm::new_with_asset_count([86; 32], MarketConfig::default(), 1);
        let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
        let sender = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
        let mut input = json!({"operation":"planAction","owner":owner.pubkey().to_string(),
            "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
            "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"}},
            "marketAccount":account_json(&env,env.market),"action":{"type":"initialize"},"rentLamports":rent});
        let initial = js(input.clone());
        let portfolio = Pubkey::from_str(initial["portfolio"].as_str().unwrap()).unwrap();
        send(
            &mut env,
            system_instruction::transfer(&sender.pubkey(), &portfolio, funding),
            &[&sender],
        )
        .expect("another wallet can fund the derived address before initialization");
        input["portfolioAccount"] = account_json(&env, portfolio);
        let planned = js(input);
        assert_eq!(
            planned["rentLamports"].as_u64().unwrap(),
            rent.saturating_sub(funding)
        );
        let instructions: Vec<_> = planned["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        assert_eq!(instructions.len(), if funding < rent { 3 } else { 2 });
        let before = snapshot(&env, &[portfolio]);
        let mut rejected_plan = instructions.clone();
        rejected_plan.push(instructions.last().unwrap().clone());
        rejected(
            send_many(&mut env, &rejected_plan, &[&owner]),
            (2 + instructions.len()) as u8,
            PercolatorError::AlreadyInitialized,
        );
        assert_unchanged(&env, &before);
        send_many(&mut env, &instructions, &[&owner])
            .expect("seeded allocation, assignment and initialization");
        let account = env.svm.get_account(&portfolio).unwrap();
        assert_eq!(account.owner, env.program_id);
        assert_eq!(account.lamports, funding.max(rent));
        assert_eq!(
            read(&env, portfolio, owner.pubkey())["owner"],
            owner.pubkey().to_string()
        );
        assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
        for (address, expected) in before {
            if address != env.market && address != portfolio {
                assert_eq!(env.svm.get_account(&address).unwrap(), expected);
            }
        }
    }
}

fn send_many(
    env: &mut V16Svm,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Result<u64, TransactionError> {
    let mut transaction_instructions = vec![
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::request_heap_frame(256 * 1024),
    ];
    transaction_instructions.extend_from_slice(instructions);
    let tx = Transaction::new_signed_with_payer(
        &transaction_instructions,
        Some(&signers[0].pubkey()),
        signers,
        env.svm.latest_blockhash(),
    );
    env.svm
        .send_transaction(tx)
        .map(|m| m.compute_units_consumed)
        .map_err(|e| e.err)
}

fn send(env: &mut V16Svm, ix: Instruction, signers: &[&Keypair]) -> Result<u64, TransactionError> {
    send_many(env, &[ix], signers)
}

fn rejected(result: Result<u64, TransactionError>, instruction: u8, error: PercolatorError) {
    assert_eq!(
        result.unwrap_err(),
        TransactionError::InstructionError(instruction, InstructionError::Custom(error as u32),)
    );
}

fn snapshot(env: &V16Svm, portfolios: &[Pubkey]) -> Vec<(Pubkey, Account)> {
    let mut keys = vec![env.market];
    keys.extend_from_slice(portfolios);
    keys.extend(env.all_token_account_data().into_iter().map(|(key, _)| key));
    keys.into_iter()
        .map(|key| (key, env.svm.get_account(&key).unwrap()))
        .collect()
}

fn assert_unchanged(env: &V16Svm, before: &[(Pubkey, Account)]) {
    for (key, expected) in before {
        assert_eq!(
            env.svm.get_account(key).as_ref(),
            Some(expected),
            "account {key} changed after rejection"
        );
    }
}

fn custody(env: &V16Svm, portfolio: Pubkey, owner: Pubkey, token: Pubkey) -> Value {
    json!({"owner":owner.to_string(),"market":env.market.to_string(),
        "portfolio":portfolio.to_string(),"userToken":token.to_string(),"vault":env.vault.to_string()})
}

#[test]
fn javascript_failed_deposit_needs_a_new_blockhash_after_source_is_funded() {
    let config = MarketConfig {
        actor_deposits: [0; 5],
        actor_token_balances: [10, 10, 10, 10, 10],
        ..MarketConfig::default()
    };
    let mut env = V16Svm::new([113; 32], config);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let donor = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
    let portfolio = env.actors[0].portfolio;
    let source = env.actors[0].source_token;
    let donor_source = env.actors[1].source_token;
    let amount = env.token_amount(source) + 1;
    let vault_before = env.token_amount(env.vault);
    let supply = env.mint_supply();
    let p = read(&env, portfolio, owner.pubkey());
    let deposit = build(
        &env,
        "deposit",
        json!({"portfolioId":p["portfolioId"],
            "expectedSequence":p["expectedSequence"],"amount":amount.to_string()}),
        custody(&env, portfolio, owner.pubkey(), source),
    );
    let before = snapshot(&env, &[portfolio]);
    rejected(
        send(&mut env, deposit.clone(), &[&owner]),
        2,
        PercolatorError::InvalidTokenAccount,
    );
    assert_unchanged(&env, &before);

    // Fix the funding condition through SPL Token, without touching the market
    // or portfolio. Re-signing the same message still reuses its failed signature.
    let transfer = spl_token::instruction::transfer(
        &spl_token::id(),
        &donor_source,
        &source,
        &donor.pubkey(),
        &[],
        1,
    )
    .unwrap();
    send(&mut env, transfer, &[&donor]).unwrap();
    assert_eq!(env.token_amount(source), amount);
    let funded = snapshot(&env, &[portfolio]);
    assert_eq!(
        send(&mut env, deposit.clone(), &[&owner]).unwrap_err(),
        TransactionError::AlreadyProcessed,
    );
    assert_unchanged(&env, &funded);

    env.svm.expire_blockhash();
    send(&mut env, deposit.clone(), &[&owner]).unwrap();
    assert_eq!(env.token_amount(source), 0);
    assert_eq!(env.token_amount(donor_source), 9);
    assert_eq!(env.token_amount(env.vault), vault_before + amount);
    assert_eq!(
        read(&env, portfolio, owner.pubkey())["capital"],
        amount.to_string()
    );
    assert_eq!(env.mint_supply(), supply);
    let deposited = snapshot(&env, &[portfolio]);
    assert_eq!(
        send(&mut env, deposit, &[&owner]).unwrap_err(),
        TransactionError::AlreadyProcessed,
    );
    assert_unchanged(&env, &deposited);
}

#[test]
fn javascript_adapter_executes_init_deposit_open_reduce_close_and_withdraw() {
    let mut config = MarketConfig::default();
    config.initial_price = 150_000_000; // Fixed SOL/USD fixture; not a live oracle test.
    let mut env = V16Svm::new_with_asset_count([73; 32], config, 1);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let maker = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
    let portfolio = Pubkey::new_unique();
    let len = percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN;
    env.svm
        .set_account(
            portfolio,
            Account {
                lamports: Rent::default().minimum_balance(len),
                data: vec![0; len],
                owner: env.program_id,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let init = build(
        &env,
        "initPortfolio",
        json!({}),
        json!({"owner":owner.pubkey().to_string(),
        "market":env.market.to_string(),"portfolio":portfolio.to_string()}),
    );
    let init_cu = send(&mut env, init, &[&owner]).expect("initialize through JS adapter");
    let source = env.actors[0].source_token;
    let destination = env.actors[0].destination_token;
    let source_before = env.token_amount(source);
    let vault_before = env.token_amount(env.vault);
    let supply_before = env.token_supply_observed();
    let amount = 25_000_000u64;

    let p = read(&env, portfolio, owner.pubkey());
    let deposit = build(
        &env,
        "deposit",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":amount.to_string()}),
        custody(&env, portfolio, owner.pubkey(), source),
    );
    let deposit_cu = send(&mut env, deposit, &[&owner]).expect("deposit through JS adapter");
    assert_eq!(env.token_amount(source), source_before - amount);
    assert_eq!(env.token_amount(env.vault), vault_before + amount);
    assert_eq!(
        read(&env, portfolio, owner.pubkey())["capital"],
        amount.to_string()
    );

    let maker_portfolio = env.actors[1].portfolio;
    let size = (percolator::POS_SCALE as i128) / 10;
    let mut trade_cu = Vec::new();
    let initial_position_epoch = read(&env, portfolio, owner.pubkey())["positionEpoch"].clone();
    for (step, (signed_size, expected_position)) in
        [(size, size), (-size / 2, size / 2), (-size / 2, 0)]
            .into_iter()
            .enumerate()
    {
        let a = read(&env, portfolio, owner.pubkey());
        let b = read(&env, maker_portfolio, maker.pubkey());
        let market_id = env.primary_market_state().1.assets[0].market_id;
        let trade_args = json!({
            "takerPortfolioId":a["portfolioId"],"takerPositionEpoch":a["positionEpoch"],
            "makerPortfolioId":b["portfolioId"],"makerPositionEpoch":b["positionEpoch"],
            "assetIndex":0,"marketId":market_id.to_string(),"sizeQ":signed_size.to_string(),
            "execPrice":"150000000","feeBps":"0","backingFeeCapBps":0});
        let trade_accounts = json!({"takerOwner":owner.pubkey().to_string(),"makerOwner":maker.pubkey().to_string(),
                "market":env.market.to_string(),"takerPortfolio":portfolio.to_string(),
                "makerPortfolio":maker_portfolio.to_string()});
        let trade = build(
            &env,
            "tradeNoCpi",
            trade_args.clone(),
            trade_accounts.clone(),
        );
        if step == 1 {
            let before = snapshot(&env, &[portfolio, maker_portfolio]);
            let mut stale_args = trade_args;
            stale_args["takerPositionEpoch"] = initial_position_epoch.clone();
            assert_ne!(a["positionEpoch"], initial_position_epoch);
            let stale = build(&env, "tradeNoCpi", stale_args, trade_accounts);
            rejected(
                send(&mut env, stale, &[&owner, &maker]),
                2,
                PercolatorError::EngineStale,
            );
            assert_unchanged(&env, &before);
        }
        trade_cu.push(
            send(&mut env, trade, &[&owner, &maker]).expect("position change through JS adapter"),
        );
        // Independently inspect the executed program state: a successful no-op
        // must not pass as an opened position or a completed close.
        let taker_state =
            percolator_prog::state::read_portfolio(&env.svm.get_account(&portfolio).unwrap().data)
                .unwrap();
        let maker_state = env.primary_portfolio(1);
        assert_eq!(taker_state.legs[0].basis_pos_q.get(), expected_position);
        assert_eq!(maker_state.legs[0].basis_pos_q.get(), -expected_position);
        let display = js(json!({"operation":"positions",
            "marketAccount":account_json(&env,env.market),
            "marketExpected":{"programId":env.program_id.to_string(),"address":env.market.to_string()},
            "portfolioAccount":account_json(&env,portfolio),
            "portfolioExpected":{"programId":env.program_id.to_string(),"address":portfolio.to_string(),
                "market":env.market.to_string(),"owner":owner.pubkey().to_string()}}));
        if expected_position == 0 {
            assert!(display.as_array().unwrap().is_empty());
        } else {
            assert_eq!(display[0]["effectiveSizeQ"], expected_position.to_string());
        }
    }

    let p = read(&env, portfolio, owner.pubkey());
    assert_eq!(p["pnl"], "0");
    let withdraw = build(
        &env,
        "withdraw",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":amount.to_string()}),
        custody(&env, portfolio, owner.pubkey(), destination),
    );
    let withdraw_cu = send(&mut env, withdraw, &[&owner]).expect("withdraw through JS adapter");
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
    assert_eq!(env.token_amount(destination), amount);
    assert_eq!(
        env.token_amount(source) + env.token_amount(destination),
        source_before
    );
    assert_eq!(env.token_amount(env.vault), vault_before);
    assert_eq!(env.token_supply_observed(), supply_before);
    println!("Native SBF lifecycle CU: init={init_cu}, deposit={deposit_cu}, open={}, reduce={}, close={}, withdraw={withdraw_cu}", trade_cu[0], trade_cu[1], trade_cu[2]);
}

#[test]
fn javascript_cpi_enforces_price_limit_and_revoked_maker_consent() {
    let mut config = MarketConfig::default();
    config.initial_price = 150_000_000;
    let mut env = V16Svm::new_with_asset_count([77; 32], config, 1);
    env.set_matcher_config_with_trade_fee_cap(1, 1, 0).unwrap();
    env.set_matcher_spreads(1, 0, 0).unwrap();
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let taker = env.actors[0].portfolio;
    let maker = env.actors[1].portfolio;
    let a = read(&env, taker, owner.pubkey());
    let b = read(&env, maker, env.actors[1].signer.pubkey());
    let accounts = json!({"takerOwner":owner.pubkey().to_string(),"market":env.market.to_string(),
        "takerPortfolio":taker.to_string(),"makerPortfolio":maker.to_string(),
        "makerOwner":env.actors[1].signer.pubkey().to_string(),"matcherProgram":env.matcher_program.to_string(),
        "matcherContext":env.actors[1].matcher_context.to_string()});
    let mut args = json!({"takerPortfolioId":a["portfolioId"],"takerPositionEpoch":a["positionEpoch"],
        "makerPortfolioId":b["portfolioId"],"makerPositionEpoch":b["positionEpoch"],"makerMatcherSequence":b["expectedSequence"],
        "assetIndex":0,"marketId":"1","sizeQ":"100000","feeBps":"0","backingFeeCapBps":0,"limitPrice":"149000000"});
    let before = snapshot(&env, &[taker, maker, env.actors[1].matcher_context]);
    let tight = build(&env, "tradeCpi", args.clone(), accounts.clone());
    assert!(send(&mut env, tight, &[&owner]).is_err());
    assert_unchanged(&env, &before);
    args["limitPrice"] = json!("150000000");
    let valid = build(&env, "tradeCpi", args.clone(), accounts.clone());
    send(&mut env, valid, &[&owner]).expect("bounded CPI fill with one wallet signer");
    assert_eq!(env.primary_portfolio(0).legs[0].basis_pos_q.get(), 100000);
    assert_eq!(env.primary_portfolio(1).legs[0].basis_pos_q.get(), -100000);
    let a = read(&env, taker, owner.pubkey());
    let b = read(&env, maker, env.actors[1].signer.pubkey());
    args["takerPositionEpoch"] = a["positionEpoch"].clone();
    args["makerPositionEpoch"] = b["positionEpoch"].clone();
    args["makerMatcherSequence"] = b["expectedSequence"].clone();
    let retained = build(&env, "tradeCpi", args, accounts);
    env.set_matcher_config(1, 0).unwrap();
    let before = snapshot(&env, &[taker, maker, env.actors[1].matcher_context]);
    assert!(send(&mut env, retained, &[&owner]).is_err());
    assert_unchanged(&env, &before);
}

#[test]
fn wallet_planner_accounts_for_nonzero_fees_and_atomic_rejections() {
    // At 150.000001 and 37 bps, 0.100001 units cost 55,501 collateral atoms
    // per side. Each partial close rounds separately to 27,751 atoms. A
    // one-micro-unit fill costs one atom, including when the taker is short.
    for (seed, direction, fills) in [
        (
            90,
            1i64,
            vec![
                (100_001i64, 55_501u128),
                (-50_000, 27_751),
                (-50_001, 27_751),
            ],
        ),
        (
            91,
            -1,
            vec![(100_001, 55_501), (-50_000, 27_751), (-50_001, 27_751)],
        ),
        (92, 1, vec![(1, 1), (-1, 1)]),
        (93, -1, vec![(1, 1), (-1, 1)]),
    ] {
        let mut config = MarketConfig::default();
        config.initial_price = 150_000_001;
        let mut env = V16Svm::new_with_asset_count([seed; 32], config, 1);
        env.update_trade_fee_policy(37).unwrap();
        env.set_matcher_config_with_trade_fee_cap(1, 1, 37).unwrap();
        env.set_matcher_spreads(1, 0, 0).unwrap();
        let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
        let maker_owner = env.actors[1].signer.pubkey();
        let maker = env.actors[1].portfolio;
        let context = env.actors[1].matcher_context;
        let source = env.actors[0].source_token;
        let destination = env.actors[0].destination_token;
        let source_before = env.token_amount(source);
        let destination_before = env.token_amount(destination);
        let vault_before = env.token_amount(env.vault);
        let supply_before = env.token_supply_observed();
        let mut input = json!({"operation":"planAction","owner":owner.pubkey().to_string(),
            "profile":{"program":{"address":env.program_id.to_string()},"market":env.market.to_string(),
                "vault":env.vault.to_string(),"collateral":{"mint":env.mint.to_string(),"decimals":6,"symbol":"TEST"},
                "maxOracleAgeSlots":20,"assets":[{"index":0,"symbol":"SOL"}],
                "maker":{"portfolio":maker.to_string(),"owner":maker_owner.to_string(),
                    "program":{"address":env.matcher_program.to_string()},"context":context.to_string(),
                    "feeBps":50,"backingFeeCapBps":0}},
            "marketAccount":account_json(&env,env.market),"action":{"type":"initialize"},
            "rentLamports":Rent::default().minimum_balance(percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN)});
        let init = js(input.clone());
        let portfolio = Pubkey::from_str(init["portfolio"].as_str().unwrap()).unwrap();
        let initialize: Vec<_> = init["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        send_many(&mut env, &initialize, &[&owner]).expect("planned portfolio initialization");
        input["marketAccount"] = account_json(&env, env.market);
        input["portfolioAccount"] = account_json(&env, portfolio);
        input["userToken"] = json!(source.to_string());
        input["tokenAccountExists"] = json!(true);
        input["tokenBalance"] = json!(source_before.to_string());
        input["action"] = json!({"type":"deposit","amount":"25"});
        let deposit = js(input.clone());
        let instructions: Vec<_> = deposit["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        send_many(&mut env, &instructions, &[&owner]).expect("planned collateral deposit");
        let market_before = env.primary_market_state().1;
        let maker_capital = env.primary_portfolio(1).capital.get();
        let custody_before = env.all_token_account_data();
        let mut fees = 0u128;
        let mut position = 0i64;
        for (index, (quantity, expected_fee)) in fills.iter().enumerate() {
            let signed = direction * quantity;
            input["marketAccount"] = account_json(&env, env.market);
            input["portfolioAccount"] = account_json(&env, portfolio);
            input["makerAccount"] = account_json(&env, maker);
            input["slot"] = json!(env.current_slot());
            input["action"] = json!({"type":"trade","side":if signed > 0 {"buy"} else {"sell"},
                "assetIndex":0,"size":format!("0.{:06}", quantity.abs()),"limitPrice":"150.000001"});
            let planned = js(input.clone());
            let instructions: Vec<_> = planned["instructions"]
                .as_array()
                .unwrap()
                .iter()
                .map(from_js_instruction)
                .collect();
            assert_eq!(instructions.len(), 1);
            if index == 0 {
                let a = read(&env, portfolio, owner.pubkey());
                let b = read(&env, maker, maker_owner);
                // Bypass the planner's consent check to exercise the SBF guard.
                let insufficient_fee_cap = build(
                    &env,
                    "tradeCpi",
                    json!({"takerPortfolioId":a["portfolioId"],"takerPositionEpoch":a["positionEpoch"],
                        "makerPortfolioId":b["portfolioId"],"makerPositionEpoch":b["positionEpoch"],
                        "makerMatcherSequence":b["expectedSequence"],"assetIndex":0,"marketId":"1",
                        "sizeQ":signed.to_string(),"feeBps":"36","backingFeeCapBps":0,"limitPrice":"150000001"}),
                    json!({"takerOwner":owner.pubkey().to_string(),"market":env.market.to_string(),
                        "takerPortfolio":portfolio.to_string(),"makerPortfolio":maker.to_string(),
                        "makerOwner":maker_owner.to_string(),"matcherProgram":env.matcher_program.to_string(),
                        "matcherContext":context.to_string()}),
                );
                let before = snapshot(&env, &[portfolio, maker, context]);
                rejected(
                    send(&mut env, insufficient_fee_cap, &[&owner]),
                    2,
                    PercolatorError::InvalidInstruction,
                );
                assert_unchanged(&env, &before);
                // The fill at index 2 must succeed before duplicate initialization
                // fails at index 3. Its fees and positions must also roll back.
                rejected(
                    send_many(
                        &mut env,
                        &[instructions[0].clone(), initialize.last().unwrap().clone()],
                        &[&owner],
                    ),
                    3,
                    PercolatorError::AlreadyInitialized,
                );
                assert_unchanged(&env, &before);
            }
            send_many(&mut env, &instructions, &[&owner]).expect("planned fee-bearing CPI fill");
            fees += expected_fee;
            position += signed;
            let taker_state = read(&env, portfolio, owner.pubkey());
            assert_eq!(taker_state["capital"], (25_000_000 - fees).to_string());
            assert_eq!(taker_state["pnl"], "0");
            assert_eq!(env.primary_portfolio(1).capital.get(), maker_capital - fees);
            let market = env.primary_market_state().1;
            assert_eq!(market.insurance, market_before.insurance + 2 * fees);
            assert_eq!(market.c_tot, market_before.c_tot - 2 * fees);
            assert_eq!(market.vault, market_before.vault);
            assert_eq!(env.all_token_account_data(), custody_before);
            let display = js(json!({"operation":"positions",
                "marketAccount":account_json(&env,env.market),
                "marketExpected":{"programId":env.program_id.to_string(),"address":env.market.to_string()},
                "portfolioAccount":account_json(&env,portfolio),
                "portfolioExpected":{"programId":env.program_id.to_string(),"address":portfolio.to_string(),
                    "market":env.market.to_string(),"owner":owner.pubkey().to_string()}}));
            if position == 0 {
                assert!(display.as_array().unwrap().is_empty());
            } else {
                assert_eq!(display[0]["effectiveSizeQ"], position.to_string());
            }
        }
        let remaining = 25_000_000 - fees;
        let p = read(&env, portfolio, owner.pubkey());
        let excessive = build(
            &env,
            "withdraw",
            json!({"portfolioId":p["portfolioId"],"expectedSequence":p["expectedSequence"],"amount":(remaining + 1).to_string()}),
            custody(&env, portfolio, owner.pubkey(), destination),
        );
        let before = snapshot(&env, &[portfolio, maker, context]);
        rejected(
            send(&mut env, excessive, &[&owner]),
            2,
            PercolatorError::EngineLockActive,
        );
        assert_unchanged(&env, &before);
        input["marketAccount"] = account_json(&env, env.market);
        input["portfolioAccount"] = account_json(&env, portfolio);
        input["userToken"] = json!(destination.to_string());
        input["action"] = json!({"type":"withdraw","amount":format!("{}.{:06}", remaining / 1_000_000, remaining % 1_000_000)});
        let withdrawal = js(input);
        let instructions: Vec<_> = withdrawal["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(from_js_instruction)
            .collect();
        send_many(&mut env, &instructions, &[&owner])
            .expect("withdraw capital net of trading fees");
        assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
        assert_eq!(env.token_amount(source), source_before - 25_000_000);
        assert_eq!(
            env.token_amount(destination),
            destination_before + remaining as u64
        );
        assert_eq!(env.token_amount(env.vault), vault_before + fees as u64);
        assert_eq!(env.token_supply_observed(), supply_before);
    }
}

#[test]
fn javascript_instructions_reject_invalid_identity_authority_and_market_bindings() {
    let mut config = MarketConfig::default();
    config.initial_price = 150_000_000;
    let mut env = V16Svm::new_with_asset_count([74; 32], config, 1);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let maker = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
    let portfolio = env.actors[0].portfolio;
    let maker_portfolio = env.actors[1].portfolio;
    let source = env.actors[0].source_token;
    let destination = env.actors[0].destination_token;
    let p = read(&env, portfolio, owner.pubkey());
    let id: u64 = p["portfolioId"].as_str().unwrap().parse().unwrap();
    let sequence: u64 = p["expectedSequence"].as_str().unwrap().parse().unwrap();
    assert!(sequence > 0, "fixture deposits must advance the sequence");
    let before = snapshot(&env, &[portfolio, maker_portfolio]);
    for (args, expected_error) in [
        (
            json!({"portfolioId":id.to_string(),"expectedSequence":(sequence - 1).to_string(),"amount":"1"}),
            PercolatorError::EngineStale,
        ),
        (
            json!({"portfolioId":(id + 1).to_string(),"expectedSequence":sequence.to_string(),"amount":"1"}),
            PercolatorError::EngineProvenanceMismatch,
        ),
    ] {
        let ix = build(
            &env,
            "deposit",
            args,
            custody(&env, portfolio, owner.pubkey(), source),
        );
        rejected(send(&mut env, ix, &[&owner]), 2, expected_error);
        assert_unchanged(&env, &before);
    }
    let unauthorized = build(
        &env,
        "deposit",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":"1"}),
        custody(&env, portfolio, maker.pubkey(), env.actors[1].source_token),
    );
    rejected(
        send(&mut env, unauthorized, &[&maker]),
        2,
        PercolatorError::Unauthorized,
    );
    assert_unchanged(&env, &before);

    let capital: u128 = p["capital"].as_str().unwrap().parse().unwrap();
    let excessive = build(
        &env,
        "withdraw",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":(capital + 1).to_string()}),
        custody(&env, portfolio, owner.pubkey(), destination),
    );
    rejected(
        send(&mut env, excessive, &[&owner]),
        2,
        PercolatorError::EngineLockActive,
    );
    assert_unchanged(&env, &before);

    let b = read(&env, maker_portfolio, maker.pubkey());
    let market_id = env.primary_market_state().1.assets[0].market_id;
    let args = json!({"takerPortfolioId":p["portfolioId"],"takerPositionEpoch":p["positionEpoch"],
        "makerPortfolioId":b["portfolioId"],"makerPositionEpoch":b["positionEpoch"],
        "assetIndex":0,"marketId":market_id.to_string(),"sizeQ":"100000", "execPrice":"150000000", "feeBps":"0", "backingFeeCapBps":0});
    let accounts = json!({"takerOwner":owner.pubkey().to_string(),"makerOwner":maker.pubkey().to_string(),
        "market":env.market.to_string(),"takerPortfolio":portfolio.to_string(),"makerPortfolio":maker_portfolio.to_string()});
    let mut wrong_market = args.clone();
    wrong_market["marketId"] = json!((market_id + 1).to_string());
    let ix = build(&env, "tradeNoCpi", wrong_market, accounts.clone());
    rejected(
        send(&mut env, ix, &[&owner, &maker]),
        2,
        PercolatorError::AssetGenerationMismatch,
    );
    assert_unchanged(&env, &before);

    let mut unsigned_maker = build(&env, "tradeNoCpi", args, accounts);
    // Intentionally strip the maker signature requirement to exercise the program guard.
    unsigned_maker.accounts[1].is_signer = false;
    rejected(
        send(&mut env, unsigned_maker, &[&owner]),
        2,
        PercolatorError::ExpectedSigner,
    );
    assert_unchanged(&env, &before);
}

#[test]
fn later_rejection_rolls_back_an_earlier_spl_transfer_and_sequence_update() {
    let mut env = V16Svm::new_with_asset_count([75; 32], MarketConfig::default(), 1);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let portfolio = env.actors[0].portfolio;
    let p = read(&env, portfolio, owner.pubkey());
    let sequence: u64 = p["expectedSequence"].as_str().unwrap().parse().unwrap();
    let capital: u128 = p["capital"].as_str().unwrap().parse().unwrap();
    let before = snapshot(&env, &[portfolio]);
    let deposit = build(
        &env,
        "deposit",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":"1"}),
        custody(&env, portfolio, owner.pubkey(), env.actors[0].source_token),
    );
    let withdrawal = build(
        &env,
        "withdraw",
        json!({"portfolioId":p["portfolioId"],
        "expectedSequence":(sequence + 1).to_string(),"amount":(capital + 2).to_string()}),
        custody(
            &env,
            portfolio,
            owner.pubkey(),
            env.actors[0].destination_token,
        ),
    );
    // Index 3 proves that both compute-budget instructions and the deposit at index 2 succeeded.
    rejected(
        send_many(&mut env, &[deposit, withdrawal], &[&owner]),
        3,
        PercolatorError::EngineLockActive,
    );
    assert_unchanged(&env, &before);
}
