import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import dotenv from 'dotenv';
import { loadWatchedTokens } from '../helpers/watchCreatorSell';
dotenv.config();

const rpcUrl = process.env.HTTPS_ENDPOINT;
const websocketUrl = process.env.WSS_ENDPOINT;

if (!rpcUrl || !websocketUrl) {
    throw new Error("Environment variables HTTPS_ENDPOINT or WSS_ENDPOINT are not set.");
}

const transport = new SuiHTTPTransport({
    url: rpcUrl,
    websocket: {
        reconnectTimeout: 1000,
        url: websocketUrl,
    }
});

const client = new SuiClient({ transport });

async function getWalletBalance(privateKey: string, tokenType: string) {
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    const walletAddress = keypair.getPublicKey().toSuiAddress();
    const balance = await client.getBalance({
        owner: walletAddress,
        coinType: tokenType
    });
    return {
        address: walletAddress,
        balance: BigInt(balance.totalBalance),
        privateKey
    };
}

export default async function sellTokens(curveId: string, percentage: number) {
    const startTime = Date.now();
    try {
        // Get all private keys upfront
        const privateKeys = [
            process.env.PK1,
            process.env.PK2,
            process.env.PK3,
            process.env.PK4
        ].filter(Boolean) as string[];

        // Get token type from curveId - do this once for all wallets
        const objectId = curveId;
        const bondingCurveInfo = await client.getObject({
            id: objectId,
            options: { showType: true }
        });

        const typeMatch = bondingCurveInfo.data?.type?.match(/<(.+?)>/);
        const tokenType = typeMatch?.[1];

        if (!tokenType) {
            throw new Error("Could not determine token type");
        }

        // Execute all sells simultaneously with Promise.allSettled
        const results = await Promise.allSettled(
            privateKeys.map(async (pk, index) => {
                const walletStartTime = Date.now();
                try {
                    const wallet = await getWalletBalance(pk, tokenType);
                    
                    if (wallet.balance <= 0) {
                        console.log(`Wallet ${index + 1} has no balance to sell`);
                        return false;
                    }

                    const amountToSell = (wallet.balance * BigInt(percentage)) / BigInt(100);
                    const result = await executeSellForWallet(
                        curveId,
                        amountToSell,
                        wallet.privateKey,
                        tokenType
                    );

                    const duration = Date.now() - walletStartTime;
                    if (result) {
                        console.log(`✅ Wallet ${index + 1} sell completed in ${duration}ms`);
                    } else {
                        console.log(`❌ Wallet ${index + 1} sell failed after ${duration}ms`);
                    }
                    
                    return result;
                } catch (error) {
                    const duration = Date.now() - walletStartTime;
                    console.error(`Error in wallet ${index + 1} after ${duration}ms:`, error);
                    return false;
                }
            })
        );

        const totalDuration = Date.now() - startTime;
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`\nSell operation summary:`);
        console.log(`Total time: ${totalDuration}ms`);
        console.log(`Success rate: ${successCount}/${results.length} wallets\n`);

        return successCount > 0;
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`Error in sellTokens after ${duration}ms:`, error);
        return false;
    } finally {
        // Run loadWatchedTokens asynchronously to not block the sell operation
        setTimeout(async () => {
            try {
                await loadWatchedTokens();
            } catch (error) {
                console.error('Error updating watched tokens:', error);
            }
        }, 0);
    }
}

async function executeSellForWallet(
    curveId: string, 
    amount: bigint, 
    privateKey: string,
    tokenType: string
): Promise<boolean> {
    const startTime = Date.now();
    try {
        const tx = new Transaction();
        const keypair = Ed25519Keypair.fromSecretKey(privateKey);

        // Get coins and prepare transaction in parallel
        const [coins] = await Promise.all([
            client.getCoins({
                owner: keypair.getPublicKey().toSuiAddress(),
                coinType: tokenType
            })
        ]);

        if (!coins.data?.length) {
            throw new Error("No coins found");
        }

        // Sort coins by balance (highest first)
        const sortedCoins = coins.data.sort((a, b) => 
            Number(BigInt(b.balance) - BigInt(a.balance))
        );

        // Find a single coin that can cover the amount
        const suitableCoin = sortedCoins.find(coin => BigInt(coin.balance) >= amount);
        let coinToUse;

        if (suitableCoin) {
            // Use single coin - fastest path
            coinToUse = tx.object(suitableCoin.coinObjectId);
        } else {
            // Need to merge coins - slower path
            const mergeTx = new Transaction();
            const primaryCoin = mergeTx.object(sortedCoins[0].coinObjectId);
            const otherCoins = sortedCoins.slice(1).map(coin => 
                mergeTx.object(coin.coinObjectId)
            );
            
            mergeTx.mergeCoins(primaryCoin, otherCoins);
            mergeTx.setGasBudget(50000000);

            const mergeResult = await client.signAndExecuteTransaction({
                transaction: mergeTx,
                signer: keypair,
                requestType: "WaitForLocalExecution",
                options: { showEffects: true }
            });

            if (mergeResult.effects?.status?.status === "failure") {
                throw new Error("Failed to merge coins");
            }

            coinToUse = tx.object(sortedCoins[0].coinObjectId);
            // Reduced wait time after merge
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Prepare and execute sell transaction
        const splitCoin = tx.splitCoins(coinToUse, [tx.pure.u64(amount.toString())]);

        tx.moveCall({
            target: "0x0ab2e8efd128ab543e60afc1719108704b960833d47e452b2ffb9bc915ef6dbc::meme::sell",
            typeArguments: [tokenType],
            arguments: [
                tx.object(curveId),
                tx.object("0xfa6d14378e545d7da62d15f7f1b5ac26ed9b2d7ffa6b232b245ffe7645591e91"),
                splitCoin,
                tx.pure.u64(0)
            ],
        });

        tx.setGasBudget(50000000);

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            requestType: "WaitForLocalExecution",
            options: { showEffects: true }
        });

        if (result.effects?.status?.status === "success") {
            console.log(`View sell transaction: https://suivision.xyz/txblock/${result.digest}`);
            return true;
        }
        return false;
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`Sell execution failed after ${duration}ms:`, error);
        return false;
    }
}