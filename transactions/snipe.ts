import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import proxyAxios from "../proxy/proxyAxios";
import { executeGraphQLWithRetry } from "./watch";
import {
  getFunctionCallCount,
  GRAPHQL_URL,
} from "./watch";
import { retrieveSetting } from "../utils/utils";
import { sendTelegramListing } from "../telegram/telegramMessages";
import '../telegram/telegramCommands';
import { storeTokenData, isTokenDuplicate } from "../utils/tokenStorage";
import { fetchAndStoreHopTokens } from '../helpers/listedTokens';
import { addTokenToWatch, isTokenWatched, TokenInfo } from '../helpers/watchCreatorSell';
import { readFileSync } from 'fs';
import path from 'path';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Retrieve the RPC URL and private key from environment variables
const rpcUrl = process.env.HTTPS_ENDPOINT;
const websocketUrl = process.env.WSS_ENDPOINT;
const privateKey: any = process.env.PK1;

// Ensure the environment variables are defined
if (!rpcUrl || !websocketUrl || !privateKey) {
  throw new Error("Environment variables HTTPS_ENDPOINT, WSS_ENDPOINT, or PK1 are not set.");
}

// Initialize the SuiHTTPTransport with the URL
const transport = new SuiHTTPTransport({
  url: rpcUrl,
  websocket: {
    url: websocketUrl,
    reconnectTimeout: 1000,
  },
  rpc: {
    headers: {
      'x-custom-header': 'custom value',
    },
  },
});

const client = new SuiClient({ transport });

export async function getObjectType(objectId: string) {
  try {
    const objectResponse = await client.getObject({
      id: objectId,
      options: {
        showType: true,
        showContent: true,
      },
    });
    return objectResponse.data;
  } catch (error) {
    return null;
  }
}

// Function to get random variation within 20% range
function getRandomVariation(baseAmount: number): number {
    const variation = 0.2; // 20% variation
    const minFactor = 1 - variation;
    const maxFactor = 1 + variation;
    const randomFactor = minFactor + Math.random() * (maxFactor - minFactor);
    // Ensure minimum of 1 and handle decimals
    return Math.max(1, Math.round(baseAmount * randomFactor * 100) / 100);
}

// Function to distribute amount across wallets
function distributeAmount(totalAmount: number, numWallets: number): number[] {
    // Convert to decimal for more precise calculations
    const baseAmount = totalAmount / numWallets;
    
    // Generate random variations
    let amounts = Array(numWallets).fill(0).map(() => getRandomVariation(baseAmount));
    
    // Calculate the current sum
    const sum = amounts.reduce((a, b) => a + b, 0);
    
    // Normalize amounts to ensure they sum to totalAmount while maintaining ratios
    amounts = amounts.map(amount => {
        // Convert to 2 decimal places for SUI amounts
        return Math.max(0.01, Number((amount / sum * totalAmount).toFixed(2)));
    });
    
    // Adjust for any rounding errors to ensure exact total
    const finalSum = amounts.reduce((a, b) => a + b, 0);
    if (Math.abs(finalSum - totalAmount) > 0.01) {
        const diff = totalAmount - finalSum;
        amounts[0] = Number((amounts[0] + diff).toFixed(2));
    }
    
    return amounts;
}

export default async function buyTokens(hexObjectId: string, totalAmount: number) {
    const startTime = Date.now();
    try {
        // Get all private keys upfront
        const privateKeys = [
            process.env.PK1,
            process.env.PK2,
            process.env.PK3,
            process.env.PK4
        ].filter(Boolean) as string[];

        // Pre-fetch object info once instead of for each wallet
        const objectId = hexObjectId.split("::")[0];
        const bondingCurveInfo = await getObjectType(objectId);
        if (!bondingCurveInfo) {
            throw new Error("Bonding curve object not found");
        }

        const typeMatch = bondingCurveInfo.type?.match(/<(.+?)>/);
        const typeArgument = typeMatch ? typeMatch[1] : null;

        if (!typeArgument) {
            throw new Error("Could not extract type argument from bonding curve");
        }

        // Execute all transactions simultaneously
        const results = await Promise.allSettled(
            privateKeys.map(async (pk, index) => {
                const walletStartTime = Date.now();
                try {
                    const tx = new Transaction();
                    const keypair = Ed25519Keypair.fromSecretKey(pk);
                    const amount = getRandomVariation(totalAmount);
                    const suiAmount = Math.floor(amount * 1e9);

                    const splitCoin = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount)]);
                    const bondingCurve = tx.object(hexObjectId);
                    const memeConfig = tx.object(
                        "0xfa6d14378e545d7da62d15f7f1b5ac26ed9b2d7ffa6b232b245ffe7645591e91"
                    );

                    tx.moveCall({
                        target: "0xda79a03bd1cfcd082d713ee615dd7fe5f4574019ddad131466312fa5d1369077::meme::buy",
                        typeArguments: [typeArgument],
                        arguments: [
                            bondingCurve,
                            memeConfig,
                            splitCoin,
                            tx.pure.u64(184467440737095),
                            tx.pure.u64(0),
                            tx.pure.address(keypair.getPublicKey().toSuiAddress()),
                        ],
                    });

                    tx.setGasBudget(50000000);

                    const result = await client.signAndExecuteTransaction({
                        transaction: tx,
                        signer: keypair,
                        requestType: "WaitForLocalExecution",
                        options: {
                            showEffects: true,
                            showEvents: false,
                        }
                    });

                    const duration = Date.now() - walletStartTime;
                    console.log(`Wallet ${index + 1} buy completed in ${duration}ms`);
                    console.log(`View transaction: https://suivision.xyz/txblock/${result.digest}`);
                    
                    return true;
                } catch (error) {
                    console.error(`Error in wallet ${index + 1}:`, error);
                    return false;
                }
            })
        );

        const duration = Date.now() - startTime;
        console.log(`Total buy operation completed in ${duration}ms`);

        // Check if any transactions succeeded
        const success = results.some(result => result.status === 'fulfilled' && result.value === true);
        
        // Add to watched tokens if buy was successful
        if (success) {
            await afterSuccessfulBuy(typeArgument);
        }

        return success;
    } catch (error) {
        console.error("Error in multi-wallet buy:", error);
        return false;
    }
}

function prepareTransaction(
    hexObjectId: string,
    amount: number,
    privateKey: string,
    typeArgument: string
) {
    const tx = new Transaction();
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    const suiAmount = Math.floor(amount * 1e9);

    const splitCoin = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount)]);
    const bondingCurve = tx.object(hexObjectId);
    const memeConfig = tx.object(
        "0xfa6d14378e545d7da62d15f7f1b5ac26ed9b2d7ffa6b232b245ffe7645591e91"
    );

    tx.moveCall({
        target: "0xda79a03bd1cfcd082d713ee615dd7fe5f4574019ddad131466312fa5d1369077::meme::buy",
        typeArguments: [typeArgument],
        arguments: [
            bondingCurve,
            memeConfig,
            splitCoin,
            tx.pure.u64(184467440737095),
            tx.pure.u64(0),
            tx.pure.address(keypair.getPublicKey().toSuiAddress()),
        ],
    });

    tx.setGasBudget(50000000);

    return {
        transaction: tx,
        keypair
    };
}

async function executeTransaction({ transaction, keypair }: { transaction: Transaction, keypair: Ed25519Keypair }) {
    try {
        const result = await client.signAndExecuteTransaction({
            transaction,
            signer: keypair,
            requestType: "WaitForLocalExecution",
            options: {
                showEffects: true,
                showEvents: false,
            }
        });

        const baseUrl = "https://suivision.xyz/txblock/";
        const transactionUrl = `${baseUrl}${result.digest}`;
        console.log(`View transaction on SuiVision: ${transactionUrl}`);

        return true;
    } catch (error) {
        console.error("Error executing transaction:", error);
        return false;
    }
}

// Add retry logic for the main polling function with connection state tracking
async function pollWithRetry(retryCount = 0, maxRetries = Infinity, baseDelay = 2000) {
  try {
    await buyMostRecentToken();
    // Reset retry count on successful poll
    if (retryCount > 0) {
    }
    return 0; // Reset retry count
  } catch (error: any) {
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), 30000); // Max 30 second delay
    
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      await new Promise(resolve => setTimeout(resolve, delay));
      return pollWithRetry(retryCount + 1, maxRetries, baseDelay);
    }
    
    throw error; // Rethrow other errors
  }
}

// Modify the main polling loop to track retry state
async function startPolling(interval = 10000) {
  let currentRetryCount = 0;
  
  while (true) {
    try {
      currentRetryCount = await pollWithRetry(currentRetryCount);
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (error) {
      console.error('Fatal error in polling:', error);
      // Wait before trying to restart the entire polling process
      await new Promise(resolve => setTimeout(resolve, 5000));
      currentRetryCount++;
    }
  }
}

// Replace the setInterval with our new polling mechanism
console.log("Snipe script is successfully running and started.");

// Start both monitors
fetchAndStoreHopTokens()
    .then(() => {
        console.log("Token listing monitor started");
        // Start the regular interval for listing monitoring
        const interval = Math.floor(Math.random() * (30000 - 10000 + 1) + 10000);
        setInterval(fetchAndStoreHopTokens, interval);
    })
    .catch(error => {
        console.error("Error starting token listing monitor:", error);
    });

// Your existing monitoring code
startPolling();

async function buyMostRecentToken() {
  try {
    const query = `{
      transactionBlocks(
        filter: {
          function: "0xda79a03bd1cfcd082d713ee615dd7fe5f4574019ddad131466312fa5d1369077::meme::accept_connector_v3",
        }
        last: 5
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          effects {
            events {
              nodes {
                contents {
                  data
                }
              }
            }
          }
        }
      }
    }`;

    const data = await executeGraphQLWithRetry(query, {});
    
    if (!data?.data?.transactionBlocks?.nodes?.length) {
      return;
    }

    // Process all transaction blocks
    for (const transactionBlockNode of data.data.transactionBlocks.nodes) {
      try {
        const curve_id = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "curve_id"
        )?.value;

        if (!curve_id) {
          console.error("curve_id not found in transaction block data");
          continue;
        }

        const curveHexId = "0x" + Array.from(curve_id.ID)
          .map((b: any) => b.toString(16).padStart(2, "0"))
          .join("");

        // Extract all token data first
        const creator = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "creator"
        )?.value?.Address;

        const creatorAddress = creator
          ? "0x" + Array.from(new Uint8Array(creator))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          : null;

        if (!creatorAddress) {
          console.error("creator address not found in transaction block data");
          continue;
        }

        const coin_name = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "coin_name"
        )?.value?.String;

        const ticker = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "ticker"
        )?.value?.String;

        const description = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "description"
        )?.value?.String;

        const imageUrlStruct = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "image_url"
        );

        // Changed this line to properly access the Option's Struct array
        const image_url = imageUrlStruct?.value?.Option?.Struct?.[0]?.value?.String || "no image";

        const twitter = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "twitter"
        )?.value?.String;

        const website = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "website"
        )?.value?.String;

        const telegram = transactionBlockNode?.effects?.events?.nodes?.[0]?.contents?.data?.Struct?.find(
          (item: any) => item.name === "telegram"
        )?.value?.String;

        // Get token type
        const objectId = curveHexId.split("::")[0];
        const bondingCurveInfo = await getObjectType(objectId);
        const typeMatch = bondingCurveInfo?.type?.match(/<(.+?)>/);
        const typeArgument = typeMatch ? typeMatch[1] : null;

        if (!typeArgument) {
          console.error("Could not extract type argument from bonding curve");
          continue;
        }

        const BondingCurveInfo = {
          curve_id: curveHexId,
          creator: creatorAddress,
          coin_name,
          ticker,
          description,
          image_url,
          twitter,
          website,
          telegram,
        };

        const tokensLaunched = await getFunctionCallCount(
          "0xda79a03bd1cfcd082d713ee615dd7fe5f4574019ddad131466312fa5d1369077::meme::place_dev_order",
          creatorAddress
        ) - 1;

        const deployerSuiBalance = Number(
          (
            await client.getBalance({
              owner: creatorAddress,
              coinType: "0x2::sui::SUI",
            })
          ).totalBalance
        ) / 1e9;

        // Get creator's token balance
        const creatorBalance = BigInt(
          (
            await client.getBalance({
              owner: creatorAddress,
              coinType: typeArgument,
            })
          ).totalBalance
        );

        // Calculate percentage with proper decimal handling
        const totalSupply = BigInt("1000000000000000"); // 1 quadrillion
        const multiplier = BigInt("100000000"); // For 8 decimal places
        const creatorHoldingsPercentage = Number((creatorBalance * BigInt(100) * multiplier) / totalSupply) / Number(multiplier);

        // Send to Telegram first
        await sendTelegramListing(
          BondingCurveInfo,
          tokensLaunched,
          deployerSuiBalance,
          creatorHoldingsPercentage
        );

        // Check for duplicate after sending to Telegram
        if (isTokenDuplicate(curveHexId)) {
          continue;
        }

        // Generate a unique listing ID
        const listingId = Math.random().toString(36).substring(2, 8);

        // Store token data
        storeTokenData(listingId, curveHexId, {
          name: coin_name,
          ticker: ticker,
          type: typeArgument
        });

        // Execute autobuy if enabled
        if (retrieveSetting("AUTOBUY") === "true") {
          await buyTokens(curve_id.ID, 1);
        }

        // After successful purchase:
        await afterSuccessfulBuy(typeArgument);

      } catch (error) {
        console.error("Error processing token:", error);
        continue;
      }
    }

  } catch (error) {
    console.error("Error in buyMostRecentToken:", error);
  }
}

// After successful buy transaction
async function afterSuccessfulBuy(tokenType: string) {
    try {
        // Load tokens.json
        const tokensData = JSON.parse(
            readFileSync(path.join(__dirname, '..', 'data', 'tokens.json'), 'utf-8')
        ) as Record<string, TokenInfo>;
        
        // Find token info by matching the type field
        const foundToken = Object.values(tokensData).find(
            (token) => token.type === tokenType
        );

        if (foundToken) {
            // Check if we're already watching this token
            if (!isTokenWatched(tokenType)) {
                await addTokenToWatch(tokenType, foundToken);
                console.log(`🆕 Added newly bought token to watch list: ${foundToken.name}`);
            } else {
                console.log(`ℹ️ Token ${foundToken.name} is already being watched`);
            }
        } else {
            console.log(`⚠️ Token ${tokenType} not found in database`);
        }
    } catch (error) {
        console.error('Error in afterSuccessfulBuy:', error);
    }
}
