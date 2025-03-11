import { client, WALLET_ADDRESSES } from '../config/client';

export async function getTokenBalance(coinType: string) {
    try {
        
        // Fetch balances for all wallets and sum them
        const balances = await Promise.all(
            WALLET_ADDRESSES.map(async address => {
                try {
                    const balance = await client.getBalance({
                        owner: address,
                        coinType: coinType
                    });
                    return BigInt(balance.totalBalance);
                } catch (error) {
                    console.error(`Error fetching balance for wallet ${address}:`, error);
                    return BigInt(0);
                }
            })
        );

        // Sum up all balances
        const totalBalance = balances.reduce(
            (sum, balance) => sum + balance, 
            BigInt(0)
        );

        // Calculate percentage with proper decimal handling
        const totalSupply = BigInt("1000000000000000"); // 1 quadrillion
        const multiplier = BigInt("100000000"); // For 8 decimal places
        const ownedPercentage = Number((totalBalance * BigInt(100) * multiplier) / totalSupply) / Number(multiplier);
        
        // Format to exactly 2 decimal places
        const formattedPercentage = Number(ownedPercentage.toFixed(2));
        
        return formattedPercentage;
    } catch (error) {
        console.error('Error getting token balances:', error);
        throw error;
    }
}