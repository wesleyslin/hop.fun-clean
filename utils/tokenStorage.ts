import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(__dirname, '../data/tokens.json');

// Make sure the data directory exists
if (!fs.existsSync(path.dirname(TOKEN_FILE))) {
    console.log("Creating data directory...");
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
}

// Initialize the file if it doesn't exist
if (!fs.existsSync(TOKEN_FILE)) {
    console.log("Initializing tokens.json...");
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({}, null, 2));
}

interface TokenData {
    curveId: string;
    timestamp: number;
    name?: string;
    ticker?: string;
    type: string;
}

export function storeTokenData(listingId: string, curveId: string, data: { name: string, ticker: string, type: string }): void {
    try {
        const tokens = loadTokens();

        // Check if the curveId already exists
        const isDuplicate = Object.values(tokens).some(token => token.curveId === curveId);
        if (isDuplicate) {
            return;
        }

        const tokenData: TokenData = {
            curveId,
            timestamp: Date.now(),
            name: data.name,
            ticker: data.ticker,
            type: data.type,
        };
        
        tokens[listingId] = tokenData;
        
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error('Error storing token data:', error);
    }
}

export function getTokenData(listingId: string): TokenData | undefined {
    try {
        const tokens = loadTokens();
        const tokenData = tokens[listingId];
        return tokenData;
    } catch (error) {
        console.error('Error retrieving token data:', error);
        return undefined;
    }
}

export function isTokenDuplicate(curveId: string): boolean {
    try {
        const tokens = loadTokens();
        
        // Check if this curve ID exists in any entries
        const duplicate = Object.values(tokens).find(token => 
            token.curveId === curveId
        );

        if (duplicate) {
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error checking for duplicate token:', error);
        return false;
    }
}

export function getAllTokens(): Record<string, TokenData> {
    return loadTokens();
}

function loadTokens(): Record<string, TokenData> {
    try {
        const data = fs.readFileSync(TOKEN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading tokens:', error);
        
        // Recreate the file if there's an error loading it
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({}, null, 2));
        return {};
    }
}
