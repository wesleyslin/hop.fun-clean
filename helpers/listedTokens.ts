import fs from 'fs';
import path from 'path';
import proxyAxios from '../proxy/proxyAxios';
import { retrieveEnvVariable } from '../utils/utils';

// Updated interfaces for the new API response
interface HopToken {
    id: string;
    bonding_curve_id: string;
    coin_type: string;
    market_cap_sui: number;
    creator: string;
    coin_name: string;
    ticker: string;
    description: string;
    image_url: string;
    website?: string;
    telegram?: string;
    twitter?: string;
    last_reply: string | null;
    last_trade: string | null;
    replies: number;
    complete: boolean;
    migrated_to?: string;
    migrated_at?: string;
    created_at: string;
}

interface HopResponse extends Array<{
    result: {
        data: {
            json: {
                items: HopToken[];
                nextCursor: string | null;
            },
            meta: {
                values: {
                    [key: string]: string[];
                }
            }
        }
    }
}> {}

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const LISTED_TOKENS_PATH = path.join(dataDir, 'listed_tokens.json');
const DISCORD_WEBHOOK_URL = retrieveEnvVariable('DISCORD_WEBHOOK_URL');

async function fetchTokens(cursor?: string, limit: number = 10): Promise<HopToken[]> {
    try {
        const input = {
            "0": {
                "json": {
                    "sortBy": "completed",
                    "query": "",
                    "cursor": cursor || "6732b0b8356705de8921934f",
                    "direction": "forward"
                }
            }
        };

        const url = `https://fun.hop.ag/api/trpc/public.listCoins?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;

        const response = await proxyAxios.get<HopResponse>(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });

        const items = response.data[0]?.result?.data?.json?.items;
        if (!items) {
            console.error('Unexpected response structure:', response.data);
            return [];
        }

        return items;
    } catch (error: unknown) {
        if (error instanceof Error) {
            const axiosError = error as any;
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                code: axiosError.code,
                response: axiosError.response?.data
            });
        } else {
            console.error('Unknown error:', error);
        }
        return [];
    }
}

async function sendDiscordNotification(token: HopToken) {
    const hopFunLink = `https://hop.ag/fun/${token.coin_type}`;
    const explorerLink = `https://suivision.xyz/token/${token.coin_type}`;

    const formattedMarketCap = token.market_cap_sui.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        useGrouping: true
    });

    const embed = {
        title: `🚀 New Token Launched: ${token.coin_name}`,
        description: `**Symbol:** [${token.ticker}](${hopFunLink})
**Explorer:** [Link](${explorerLink})
**Contract:** [${token.coin_type}](${explorerLink})
**Market Cap:** ${formattedMarketCap} SUI`,
        color: 0xFFFF00,
        timestamp: new Date(token.created_at).toISOString(),
        thumbnail: {
            url: token.image_url
        }
    };

    const payload = {
        embeds: [embed]
    };

    try {
        const response = await proxyAxios.post(DISCORD_WEBHOOK_URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.status !== 200 && response.status !== 204) {
            throw new Error(`Error status: ${response.status}`);
        }
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ Error sending Discord notification:', errorMessage);
    }
}

let isFirstRun = true;

export async function fetchAndStoreHopTokens(): Promise<void> {
    try {
        // Fetch first batch of tokens
        const tokens = await fetchTokens(undefined, 20);

        const existingTokens = getListedTokens();

        let newTokens = tokens.filter(token => 
            !existingTokens.some(existing => existing.id === token.id)
        );

        if (isFirstRun) {
            newTokens.sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            isFirstRun = false;
        } else {
            newTokens.sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
        }

        // Send notifications for new tokens
        if (newTokens.length > 0) {
            for (const token of newTokens) {
                console.log(`\nSending notification for ${token.coin_name} (${token.ticker})`);
                await sendDiscordNotification(token);
            }
        } else {
        }

        // Store all tokens
        fs.writeFileSync(
            LISTED_TOKENS_PATH,
            JSON.stringify({ data: tokens }, null, 2)
        );

    } catch (error) {
        console.error('Error fetching Hop tokens:', error);
    }
}

export function getListedTokens(): HopToken[] {
    try {
        if (!fs.existsSync(LISTED_TOKENS_PATH)) {
            const emptyData = { data: [] };
            fs.writeFileSync(LISTED_TOKENS_PATH, JSON.stringify(emptyData, null, 2));
            return [];
        }
        
        const data = fs.readFileSync(LISTED_TOKENS_PATH, 'utf8');
        if (!data || data.trim() === '') {
            const emptyData = { data: [] };
            fs.writeFileSync(LISTED_TOKENS_PATH, JSON.stringify(emptyData, null, 2));
            return [];
        }

        const response = JSON.parse(data);
        return response.data;
    } catch (error) {
        console.error('Error reading listed tokens:', error);
        const emptyData = { data: [] };
        fs.writeFileSync(LISTED_TOKENS_PATH, JSON.stringify(emptyData, null, 2));
        return [];
    }
}

export function getTokenByAddress(address: string): HopToken | undefined {
    const tokens = getListedTokens();
    return tokens.find(token => token.id.toLowerCase() === address.toLowerCase());
}

function getRandomInterval(): number {
    return Math.floor(Math.random() * (30000 - 10000 + 1) + 10000);
}

function scheduleNextUpdate() {
    const interval = getRandomInterval();
    setTimeout(() => {
        fetchAndStoreHopTokens()
            .then(() => scheduleNextUpdate())
            .catch(() => scheduleNextUpdate());
    }, interval);
}

fetchAndStoreHopTokens()
    .then(() => scheduleNextUpdate());
