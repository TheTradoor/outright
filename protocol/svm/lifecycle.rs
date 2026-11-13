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

fn account_json(env: &V16Svm, address: Pubkey) -> Value {
    match env.svm.get_account(&address) {
        Some(a) => {
            json!({"owner":a.owner.to_string(),"executable":a.executable,"data":a.data,"lamports":a.lamports})
        }
        None => Value::Null,
    }
}

fn keeper_instruction(env: &V16Svm, payer: Pubkey, oracle: Pubkey, feed: [u8; 32]) -> Instruction {
    let target = env.actors[0].portfolio;
    let market_id = env.primary_market_state().1.assets[0].market_id;
    let input = json!({"operation":"planCrank", "slot":env.current_slot(), "discoveryIndex":0,
        "config":{"deployment":{"program":{"address":env.program_id.to_string()},
            "market":env.market.to_string(),"collateral":{"mint":env.mint.to_string()}},
            "feePayer":payer.to_string(),
            "assets":[{"index":0,"marketId":market_id.to_string(),"oracleMode":1,
                "feeds":[{"id":Pubkey::new_from_array(feed).to_string(),"account":oracle.to_string()}]}]},
        "target":{"address":target.to_string(),"owner":env.actors[0].signer.pubkey().to_string()},
        "marketAccount":account_json(env,env.market),"portfolioAccount":account_json(env,target)});
    from_js_instruction(&js(input))
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

    input["marketAccount"] = account_json(&env, env.market);
    input["portfolioAccount"] = account_json(&env, portfolio);
    input["action"] = json!({"type":"withdraw","amount":"2.5"});
    input.as_object_mut().unwrap().remove("userToken");
    input["tokenAccountExists"] = json!(false);
    input["rentLamports"] = json!(Rent::default().minimum_balance(165));
    let withdraw = js(input);
    let instructions: Vec<_> = withdraw["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(from_js_instruction)
        .collect();
    assert_eq!(instructions.len(), 2);
    send_many(&mut env, &instructions, &[&owner])
        .expect("atomic ATA creation and planned withdrawal");
    assert_eq!(env.token_amount(user_ata), 2_500_000);
    assert_eq!(env.token_amount(source), before - 2_500_000);
    assert_eq!(env.token_amount(env.vault), vault_before);
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
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
