import { client, WALLET_ADDRESSES } from '../config/client';

export async function getOurBalance(convertToSui = false) {
    try {
        // Fetch balances for all wallets separately
        const balances = await Promise.all(
            WALLET_ADDRESSES.map(async address => {
                try {
                    const balance = await client.getBalance({
                        owner: address,
                        coinType: "0x2::sui::SUI"
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

        // Only convert to SUI if requested
        if (convertToSui) {
            const totalBalanceInSui = Number(totalBalance) / 1e9;
            console.log('Balances by wallet:', balances.map((b, i) => 
                `Wallet ${i + 1}: ${Number(b) / 1e9} SUI`
            ));
            console.log(`Total balance across all wallets: ${totalBalanceInSui.toFixed(4)} SUI`);

            return {
                totalBalance: totalBalanceInSui,
                balances: balances.map(b => Number(b) / 1e9),
                rawBalances: balances.map(b => b.toString())
            };
        }

        // Return MIST values
        console.log('Balances by wallet (MIST):', balances.map((b, i) => 
            `Wallet ${i + 1}: ${b.toString()} MIST`
        ));
        console.log(`Total balance across all wallets: ${totalBalance.toString()} MIST`);

        return {
            totalBalance,
            balances,
            rawBalances: balances.map(b => b.toString())
        };
    } catch (error) {
        console.error('Error getting balances:', error);
        throw error;
    }
}
