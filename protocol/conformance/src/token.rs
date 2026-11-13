//! Classic SPL fixtures come from the program's packer, not the JS reader.
use serde_json::{json, Value};
use solana_program::{program_option::COption, program_pack::Pack, pubkey::Pubkey};
use spl_token::state::{Account, AccountState, Mint};

fn key(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}
fn optional_key(value: COption<Pubkey>) -> Option<String> {
    match value {
        COption::Some(k) => Some(k.to_string()),
        COption::None => None,
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn export() -> Value {
    let mut mints = Vec::new();
    let mut accounts = Vec::new();
    for (i, amount) in [0, 9_007_199_254_740_993, u64::MAX, u64::MAX - 1]
        .into_iter()
        .enumerate()
    {
        let mint = Mint {
            mint_authority: if i & 1 == 1 {
                COption::Some(key(1))
            } else {
                COption::None
            },
            supply: amount,
            decimals: 6,
            is_initialized: i != 0,
            freeze_authority: if i & 2 == 2 {
                COption::Some(key(2))
            } else {
                COption::None
            },
        };
        let mut bytes = vec![0u8; Mint::LEN];
        Mint::pack(mint, &mut bytes).unwrap();
        assert_eq!(Mint::unpack_unchecked(&bytes).unwrap(), mint);
        mints.push(json!({"hex":hex(&bytes),"expected":{
            "mintAuthority":optional_key(mint.mint_authority),
            "supply":mint.supply.to_string(),"decimals":mint.decimals,
            "isInitialized":mint.is_initialized,"freezeAuthority":optional_key(mint.freeze_authority)}}));

        let account = Account {
            mint: key(5),
            owner: key(17),
            amount,
            delegate: if i > 1 {
                COption::Some(key(3))
            } else {
                COption::None
            },
            state: [
                AccountState::Uninitialized,
                AccountState::Initialized,
                AccountState::Frozen,
                AccountState::Initialized,
            ][i],
            is_native: match i {
                2 => COption::Some(u64::MAX),
                3 => COption::Some(0),
                _ => COption::None,
            },
            delegated_amount: amount,
            close_authority: if i > 1 {
                COption::Some(key(4))
            } else {
                COption::None
            },
        };
        let mut bytes = vec![0u8; Account::LEN];
        Account::pack(account, &mut bytes).unwrap();
        assert_eq!(Account::unpack_unchecked(&bytes).unwrap(), account);
        let reserve = match account.is_native {
            COption::Some(n) => Some(n.to_string()),
            COption::None => None,
        };
        accounts.push(json!({"hex":hex(&bytes),"expected":{
            "mint":account.mint.to_string(),"owner":account.owner.to_string(),
            "amount":account.amount.to_string(),"delegate":optional_key(account.delegate),
            "delegatedAmount":account.delegated_amount.to_string(),
            "isInitialized":account.state != AccountState::Uninitialized,
            "isFrozen":account.state == AccountState::Frozen,"isNative":reserve.is_some(),
            "rentExemptReserve":reserve,"closeAuthority":optional_key(account.close_authority)}}));
    }
    json!({"rustVersion":"4.0.3","programId":spl_token::id().to_string(),
        "mintLength":Mint::LEN,"accountLength":Account::LEN,"mints":mints,"accounts":accounts})
}
