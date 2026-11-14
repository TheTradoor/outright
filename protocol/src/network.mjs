// Wallet Standard chain identifiers differ from Solana RPC cluster labels.
const NETWORKS = Object.freeze({
  localnet: Object.freeze({ chain: null, genesisHash: null }),
  devnet: Object.freeze({
    chain: "solana:devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  }),
  "mainnet-beta": Object.freeze({
    chain: "solana:mainnet",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  }),
});
const PUBLIC_GENESIS = new Set([
  NETWORKS.devnet.genesisHash,
  NETWORKS["mainnet-beta"].genesisHash,
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", // testnet
]);

export function walletChain(cluster) {
  if (!Object.hasOwn(NETWORKS, cluster))
    throw new Error(
      "This release supports localnet, devnet and mainnet-beta deployments",
    );
  return NETWORKS[cluster].chain;
}

export function validateRpcUrl(cluster, rpcUrl) {
  walletChain(cluster);
  const url = new URL(rpcUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (cluster === "localnet" && !loopback)
    throw new Error("Localnet profiles require a loopback RPC endpoint");
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (cluster === "localnet" && loopback && url.protocol === "http:")
    )
  )
    throw new Error(
      "Use HTTPS or a local validator RPC URL without embedded credentials",
    );
  return url.href;
}

export function validateNetwork(input) {
  const rpcUrl = validateRpcUrl(input.cluster, input.rpcUrl);
  const expected = NETWORKS[input.cluster].genesisHash;
  if (
    typeof input.genesisHash !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{20,44}$/.test(input.genesisHash) ||
    (expected !== null && input.genesisHash !== expected)
  )
    throw new Error("Invalid network genesis hash");
  if (input.cluster === "localnet" && PUBLIC_GENESIS.has(input.genesisHash))
    throw new Error("Localnet cannot use a public-network genesis hash");
  return { cluster: input.cluster, rpcUrl, genesisHash: input.genesisHash };
}

export function transactionExplorerUrl(profile, signature) {
  walletChain(profile.cluster);
  const url = new URL(
    `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`,
  );
  if (profile.cluster === "devnet") url.searchParams.set("cluster", "devnet");
  if (profile.cluster === "localnet") {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", profile.rpcUrl);
  }
  // Mainnet is the explorer default. Never put a production RPC URL or its
  // provider query parameters in a third-party transaction link.
  return url.href;
}
