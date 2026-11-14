use percolator_prog::oracle_v16::{read_oracle_price_e6_from_bytes, PYTH_RECEIVER_PROGRAM_ID};
use serde_json::Value;
use solana_program::pubkey::Pubkey;
use std::{collections::HashSet, str::FromStr};

fn hex(value: &str) -> Vec<u8> {
    assert_eq!(value.len() % 2, 0);
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn pyth_inspector_vectors_match_published_wrapper() {
    let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/pyth-oracle.json")).unwrap();
    let lock: Value = serde_json::from_str(include_str!("../../source-lock.json")).unwrap();
    assert_eq!(fixture["wrapperCommit"], lock["program"]["revision"]);
    assert_eq!(fixture["engineCommit"], lock["engine"]["revision"]);
    assert_eq!(percolator::MAX_ORACLE_PRICE, 1_000_000_000_000);
    assert_eq!(PYTH_RECEIVER_PROGRAM_ID.to_string(), "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 31);
    assert_eq!(cases.iter().map(|c| c["name"].as_str().unwrap()).collect::<HashSet<_>>().len(), cases.len());
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let data = hex(case["dataHex"].as_str().unwrap());
        let feed: [u8; 32] = hex(case["feedId"].as_str().unwrap()).try_into().unwrap();
        let result = read_oracle_price_e6_from_bytes(
            &Pubkey::from_str(case["owner"].as_str().unwrap()).unwrap(),
            &Pubkey::new_from_array([9; 32]),
            &data,
            &feed,
            case["nowUnixSeconds"].as_str().unwrap().parse().unwrap(),
            case["maxAgeSeconds"].as_str().unwrap().parse().unwrap(),
            case["maxConfidenceBps"].as_u64().unwrap().try_into().unwrap(),
        );
        if let Some(expected) = case["expected"]["priceE6"].as_str() {
            let (price, time) = result.unwrap_or_else(|error| panic!("{name}: {error:?}"));
            assert_eq!(price.to_string(), expected, "{name}");
            assert_eq!(time.to_string(), case["expected"]["publishTime"].as_str().unwrap(), "{name}");
        } else {
            assert!(case["expected"]["code"].is_string());
            assert!(result.is_err(), "{name}: wrapper accepted a rejected vector");
        }
    }
}
