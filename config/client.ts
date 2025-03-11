import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, SuiHTTPTransport } from '@mysten/sui/client';
import dotenv from 'dotenv';
dotenv.config();

// Retrieve the RPC URL and private keys from environment variables
const rpcUrl = process.env.HTTPS_ENDPOINT;
const websocketUrl = process.env.WSS_ENDPOINT;

if (!rpcUrl || !websocketUrl) {
    throw new Error("Environment variables HTTPS_ENDPOINT or WSS_ENDPOINT are not set.");
}

// Initialize the transport
const transport = new SuiHTTPTransport({
    url: rpcUrl,
    websocket: {
        reconnectTimeout: 1000,
        url: websocketUrl,
    }
});

// Initialize the client
export const client = new SuiClient({ transport });

// Initialize keypairs for all wallets
const privateKeys = [
    process.env.PK1,
    process.env.PK2,
    process.env.PK3,
    process.env.PK4
].filter(Boolean) as string[];

export const wallets = privateKeys.map(pk => {
    const keypair = Ed25519Keypair.fromSecretKey(pk);
    return {
        keypair,
        address: keypair.getPublicKey().toSuiAddress()
    };
});

// Export wallet addresses for easy access
export const WALLET_ADDRESSES = wallets.map(wallet => wallet.address);

// Export individual wallet objects if needed
export const [WALLET1, WALLET2, WALLET3, WALLET4] = wallets;

// Helper function to get wallet by index
export function getWallet(index: number) {
    if (index < 0 || index >= wallets.length) {
        throw new Error(`Invalid wallet index: ${index}`);
    }
    return wallets[index];
}

// Package ID for hop.fun
export const HOP_PACKAGE_ID = '0x5c8657a6009556804585cd667be3b43487062195422ff586333721de0f8baeae';

// Export common types
export type SuiTransactionBlockResponse = Awaited<ReturnType<typeof client.executeTransactionBlock>>;