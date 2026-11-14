# Candidate current-validator CI evidence

GitHub run: https://github.com/TheTradoor/outright/actions/runs/43523148675
Job: 132222159542. Result: **passed**.

- PR #26 source head: `0c44c9bd9363939ed4fe73501ccd93ec5d475dbc`.
- Tested merge: `f056fb20b2928c446e0b67e806b8ad3996e79730`.
- Tested tree: `900fb80a9462e36b207d83bf113a8ad5de61f57a`.
- Wrapper base: `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`.
- Candidate patch SHA-256: `0b1474d1b0a7ab54b0890b6c121fc9292530ffedbfe0cc414e54afbceb91cfb8`.
- Candidate tree: `6621d5edd799f68ce0864f740ddc6da22e01c701`.
- Engine: `a712af767eeb217876a3d3c50e3849b60ea54462`.
- Tools: cargo-build-sbf 4.6.0, platform-tools v1.58, SBPF v3, Agave 4.4.1.

Both programs built successfully. The RPC lifecycle completed in 25.828 seconds:
portfolio initialization, 100 TEST deposit, long open/close, short open/close,
and 100 TEST withdrawal. All seven distinct signatures have successful confirmed
transaction metadata. An oversized deposit was rejected before signing.
Trader collateral starts and ends at exactly 1,000,000,000 atoms; final portfolio
capital is zero; maker capital is 10,000,000,000 atoms.

Raw wrapper SBF SHA-256:
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
Raw authentication matcher SBF SHA-256:
`042f7cc2e6a7b343da58d511f72abf56f57e044f70f7b695a52aec2cb9d70190`.
The deployed ProgramData payload hashes match these hashes in this run;
upgrade authorities are null. Both deployed binaries were checked before and
after execution. Source identity was checked before and after execution.

Artifact 14083468332, ZIP SHA-256 (verified against GitHub metadata):
`6cd797c898a5dbdcd718ad83b07b519f52cd80dcd9704bc82de1d9a0df05ad24`.
The complete ZIP, selected extracted reports/build logs, complete job log and metadata are retained here. The larger `validator.log` remains inside the ZIP; extract it to `artifact/validator.log` before checking that member against `sha256.json`. Its retained historical SHA-256 is `1967b91aea874f4f39166fe391764c330a0789ab213aa268168598c90ed22db2`.
The README checksum was refreshed when this explanatory documentation changed;
all original log, artifact and source hashes remain unchanged.
Compiler warnings remain visible in the raw build/job logs.

This is preliminary evidence for the exact PR #26 source. It does not cover a
later combined revision until that revision's workflow completes. The market
uses synthetic collateral and a fixed price. It is not a physical-wallet test,
full oracle/Recovery campaign, security audit, production enrollment or mainnet
approval. No deployment profile was exported and no runtime source pin changed.
