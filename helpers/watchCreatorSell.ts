import { client } from '../config/client';
import sellTokens from '../transactions/sell';
import proxyAxios from '../proxy/proxyAxios';
import { getTokenBalance } from './getTokenBalance';
import { GRAPHQL_URL } from '../transactions/watch';
import fs from 'fs';
import path from 'path';
import { wallets } from '../config/client';
import { readFileSync } from 'fs';

const HOP_FUN_PACKAGE = "0xda79a03bd1cfcd082d713ee615dd7fe5f4574019ddad131466312fa5d1369077";
const WATCHED_TOKENS_FILE = path.join(__dirname, '..', 'data', 'watched_tokens.json');

// Update the interfaces at the top
interface StoredTokenInfo {
    creator: string;
    balance: string;
    data: {
        name: string;
        type: string;
    };
}

interface WatchedToken {
    creator: string;
    balance: bigint;
    curveId: string;
    data: {
        name: string;
        type: string;
    };
}

export interface TokenInfo {
    curveId: string;
    timestamp: number;
    name: string;
    ticker: string;
    type: string;
    creator: string;
}

interface TokensMap {
    [key: string]: TokenInfo;
}

// Update the Map type
const ownedTokens = new Map<string, WatchedToken>();

// Add these interfaces at the top with other interfaces
interface AddressOwner {
    AddressOwner: string;
}

interface SharedOwner {
    Shared: { initial_shared_version: string };
}

type ObjectOwner = AddressOwner | SharedOwner;

// Add this interface at the top with other interfaces
interface ListedToken {
    id: string;
    name: string;
    timestamp: string;
}

// Add this interface for the coin type
interface CoinObject {
    coinType: string;
    balance: string;
    digest: string;
    version: string;
    previousTransaction: string;
}

// Load watched tokens from file
async function loadWatchedTokens() {
    try {
        if (fs.existsSync(WATCHED_TOKENS_FILE)) {
            const data = fs.readFileSync(WATCHED_TOKENS_FILE, 'utf-8');
            const tokens = JSON.parse(data) as Record<string, StoredTokenInfo>;
            
            for (const [tokenType, storedInfo] of Object.entries(tokens)) {
                ownedTokens.set(tokenType, {
                    creator: storedInfo.creator,
                    balance: BigInt(storedInfo.balance),
                    curveId: storedInfo.data.type,
                    data: storedInfo.data
                });
            }
            console.log(`Loaded ${ownedTokens.size} tokens to watch`);
        }
    } catch (error) {
        console.error('Error loading watched tokens:', error);
    }
}

// Update saveWatchedTokens to merge instead of overwrite
async function saveWatchedTokens() {
    try {
        // Create data directory if it doesn't exist
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        // Create empty file if it doesn't exist
        if (!fs.existsSync(WATCHED_TOKENS_FILE)) {
            fs.writeFileSync(WATCHED_TOKENS_FILE, JSON.stringify({}, null, 2));
        }

        // Read existing watched tokens
        let currentTokens: Record<string, StoredTokenInfo> = {};
        try {
            const data = fs.readFileSync(WATCHED_TOKENS_FILE, 'utf-8');
            if (data.trim()) {
                currentTokens = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error reading watched tokens file:', error);
            currentTokens = {};
        }

        // Convert current ownedTokens to StoredTokenInfo format
        const newTokens = Object.fromEntries(
            Array.from(ownedTokens.entries()).map(([type, info]) => [
                type,
                {
                    creator: info.creator,
                    balance: info.balance.toString(),
                    curveId: info.curveId,
                    data: info.data
                }
            ])
        );

        // Merge existing and new tokens
        const mergedTokens = {
            ...currentTokens,
            ...newTokens
        };

        // Remove tokens with zero balance
        for (const [type, info] of Object.entries(mergedTokens)) {
            const balance = await getTokenBalance(type);
            if (balance <= 0) {
                delete mergedTokens[type];
                console.log(`Removed ${info.data.name} (${type}) from watch list - zero balance`);
            }
        }

        // Only write if there are changes
        const currentContent = JSON.stringify(currentTokens, null, 2);
        const newContent = JSON.stringify(mergedTokens, null, 2);
        
        if (currentContent !== newContent) {
            fs.writeFileSync(WATCHED_TOKENS_FILE, newContent);
            console.log('Updated watched tokens file');
        }
    } catch (error) {
        console.error('Error saving watched tokens:', error);
    }
}

async function updateOwnedTokens() {
    try {
        let changed = false;
        for (const [tokenType, info] of ownedTokens) {
            const balance = await getTokenBalance(tokenType);
            if (balance > 0) {
                if (balance !== Number(info.balance)) {
                    changed = true;
                    ownedTokens.set(tokenType, {
                        ...info,
                        balance: BigInt(Math.floor(balance))
                    });
                }
            } else {
                changed = true;
                ownedTokens.delete(tokenType);
            }
        }
        if (changed) {
            await saveWatchedTokens();
        }
    } catch (error) {
        console.error('Error updating owned tokens:', error);
    }
}

// Modify addTokenToWatch to be more robust
async function addTokenToWatch(tokenType: string, tokenInfo: TokenInfo) {
    try {
        const balance = await getTokenBalance(tokenType);
        if (balance > 0) {
            const watchedToken: WatchedToken = {
                creator: tokenInfo.creator,
                balance: BigInt(Math.floor(balance)),
                curveId: tokenInfo.curveId,
                data: {
                    name: tokenInfo.name,
                    type: tokenInfo.type
                }
            };
            
            ownedTokens.set(tokenType, watchedToken);
            await saveWatchedTokens();
            console.log(`🔍 Added ${tokenInfo.name} (${tokenType}) to watch list`);
            console.log(`👤 Creator: ${tokenInfo.creator}`);
            console.log(`💰 Balance: ${balance}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error adding token ${tokenType} to watch:`, error);
        return false;
    }
}

// Add a function to check if a token is already being watched
function isTokenWatched(tokenType: string): boolean {
    return ownedTokens.has(tokenType);
}

async function watchCreatorSells() {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    async function attemptQuery(retryCount = 0) {
        try {
            const sellQuery = `{
                transactionBlocks(
                    filter: {
                        function: "${HOP_FUN_PACKAGE}::meme::sell"
                    }
                    last: 15
                ) {
                    nodes {
                        digest
                        sender {
                            address
                        }
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

            const response = await proxyAxios.post(GRAPHQL_URL, { query: sellQuery });

            const transactions = response.data?.data?.transactionBlocks?.nodes;

            if (!transactions?.length) {
                console.log('No transactions found');
                return;
            }

            for (const tx of transactions) {
                const seller = tx.sender?.address;
                
                // Check for creator sells
                for (const [watchedTokenType, info] of ownedTokens) {
                    if (info.creator === seller) {
                        console.log(`🚨 CREATOR SELL DETECTED!`);
                        console.log(`📊 Our Token: ${info.data.name} (${watchedTokenType})`);
                        console.log(`Creator Address: ${info.creator}`);
                        console.log(`Curve ID: ${info.curveId}`);
                        
                        const sellResult = await sellTokens(info.curveId, 100);
                        if (sellResult) {
                            console.log(`✅ Dev sell successful`);
                            ownedTokens.delete(watchedTokenType);
                            await saveWatchedTokens();
                        } else {
                            console.log(`❌ Dev sell failed`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Query Error:', error);
            if (retryCount < maxRetries) {
                console.log(`Connection error, retrying (${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return attemptQuery(retryCount + 1);
            } else {
                console.error('Error in watchCreatorSells after retries:', error);
            }
        }
    }

    await attemptQuery();
    setTimeout(watchCreatorSells, 1000);
}

async function initializeTokenList() {
    try {
        console.log('Initializing token watch list...');
        const processedTokens = new Set<string>();
        
        // Load MovePump tokens database
        const tokensData: TokensMap = JSON.parse(
            readFileSync(path.join(__dirname, '..', 'data', 'tokens.json'), 'utf-8')
        );
        
        
        // Create a map of token types to their info for quick lookup
        const tokenTypesMap = new Map<string, TokenInfo>();
        Object.values(tokensData).forEach(tokenInfo => {
            if (tokenInfo?.type) {  // Make sure we have a valid token type
                tokenTypesMap.set(tokenInfo.type, tokenInfo);
            }
        });
                
        // Only use the first wallet since all wallets have same tokens
        const wallet = wallets[0];
        
        // Get all coins with pagination
        let allCoins: CoinObject[] = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage) {
            const response = await client.getAllCoins({
                owner: wallet.address,
                limit: 100,
                cursor: cursor
            });

            allCoins = allCoins.concat(response.data);
            
            if (response.hasNextPage && response.nextCursor) {
                cursor = response.nextCursor;
            } else {
                hasNextPage = false;
            }
        }

        // Count total unique tokens before filtering
        const uniqueTokens = new Set(allCoins
            .filter(coin => coin.coinType !== '0x2::sui::SUI')
            .map(coin => coin.coinType));


        // Add more detailed logging for each token
        for (const coin of allCoins) {
            const tokenType = coin.coinType;
            if (tokenType === '0x2::sui::SUI' || processedTokens.has(tokenType)) {
                continue;
            }
            
            const balance = await getTokenBalance(tokenType);

            if (balance <= 0) {
                continue;
            }

            processedTokens.add(tokenType);

            const tokenInfo = tokenTypesMap.get(tokenType);
            if (tokenInfo) {
                await addTokenToWatch(tokenType, tokenInfo);
            } else {
            }
        }

        await saveWatchedTokens();
    } catch (error) {
        console.error('Error initializing token list:', error);
    }
}

async function initializeFromWatchedTokens() {
    try {
        // First get all our coins with pagination
        const wallet = wallets[0];
        let allCoins: CoinObject[] = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage) {
            const response = await client.getAllCoins({
                owner: wallet.address,
                limit: 100,
                cursor: cursor
            });

            allCoins = allCoins.concat(response.data);
            
            if (response.hasNextPage && response.nextCursor) {
                cursor = response.nextCursor;
            } else {
                hasNextPage = false;
            }
        }

        // Count unique tokens before filtering
        const uniqueTokens = new Set(allCoins
            .filter(coin => coin.coinType !== '0x2::sui::SUI')
            .map(coin => coin.coinType));
        
        console.log(`Found ${uniqueTokens.size} total unique tokens before balance check`);

        // Load tokens.json
        const tokensData: TokensMap = JSON.parse(
            readFileSync(path.join(__dirname, '..', 'data', 'tokens.json'), 'utf-8')
        );
        
        // Create a map of token types to their info
        const tokenTypesMap = new Map<string, TokenInfo>();
        Object.values(tokensData).forEach(tokenInfo => {
            if (tokenInfo?.type) {
                tokenTypesMap.set(tokenInfo.type, tokenInfo);
            }
        });

        console.log(`Loaded ${tokenTypesMap.size} tokens from database`);

        // Check each coin we own
        for (const coin of allCoins) {
            const tokenType = coin.coinType;
            if (tokenType === '0x2::sui::SUI') continue;

            const balance = await getTokenBalance(tokenType);
            if (balance > 0) {
                const tokenInfo = tokenTypesMap.get(tokenType);
                if (tokenInfo) {
                    ownedTokens.set(tokenType, {
                        creator: tokenInfo.creator,
                        balance: BigInt(Math.floor(balance)),
                        curveId: tokenInfo.curveId,
                        data: {
                            name: tokenInfo.name,
                            type: tokenInfo.type
                        }
                    });
                }
            }
        }

        // Log what we're watching
        if (ownedTokens.size > 0) {
            console.log('\nWatching for creator sells:');
            for (const [tokenType, info] of ownedTokens) {
                console.log(`📊 ${info.data.name} (${tokenType})`);
                console.log(`👤 Creator: ${info.creator}`);
                console.log(`🔄 Curve ID: ${info.curveId}`);
                console.log('------------------------');
            }
        }

        await saveWatchedTokens();
    } catch (error) {
        console.error('Error initializing from watched tokens:', error);
    }
}

// Initialize and start watching
initializeFromWatchedTokens()
    .then(() => {
        watchCreatorSells();
    })
    .catch(error => {
        console.error('Error during initialization:', error);
    });

export { 
    watchCreatorSells, 
    addTokenToWatch,
    isTokenWatched,
    loadWatchedTokens 
}; 