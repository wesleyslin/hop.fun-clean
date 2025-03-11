import proxyAxios from "../proxy/proxyAxios";

export const GRAPHQL_URL = "https://sui-mainnet.mystenlabs.com/graphql";

/**
 * @returns The date of the first transaction
 */
async function getFirstTransaction(deployerAddress: string): Promise<Date> {
  const query = `{
        address(address: "${deployerAddress}") {
          transactionBlocks(first: 1) {
            nodes {
              effects {
                timestamp
              }
            }
          }
        }
      }`;

  const data = await executeGraphQLWithRetry(query, {});
  const firstTransactionTimestamp =
    data?.data?.address?.transactionBlocks?.nodes[0]?.effects?.timestamp;

  // If no timestamp found, return future date as fallback
  if (!firstTransactionTimestamp) {
    return new Date("2100-01-01");
  }

  // Parse the timestamp and return the date object
  const accountCreationDate = new Date(firstTransactionTimestamp);
  return accountCreationDate;
}

export async function getFunctionCallCount(
  functionId: string,
  deployerAddress: string
): Promise<number> {
  let hasNextPage = true;
  let cursor: string;
  let count = 0;
  
  const initialQuery = `{
    transactionBlocks(
      filter: {
        function: "${functionId}"
        sentAddress: "${deployerAddress}"
      }
      first: 50
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        digest
      }
    }
  }`;

  const data = await executeGraphQLWithRetry(initialQuery, {});
  count += data.data.transactionBlocks.nodes.length;
  hasNextPage = data.data.transactionBlocks.pageInfo.hasNextPage;
  cursor = data.data.transactionBlocks.pageInfo.endCursor;

  while (hasNextPage) {
    const paginatedQuery = `{
      transactionBlocks(
        filter: {
          function: "${functionId}"
          sentAddress: "${deployerAddress}"
        }
        first: 50
        after: "${cursor}"
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          digest
        }
      }
    }`;

    const data = await executeGraphQLWithRetry(paginatedQuery, {});
    count += data.data.transactionBlocks.nodes.length;
    hasNextPage = data.data.transactionBlocks.pageInfo.hasNextPage;
    cursor = data.data.transactionBlocks.pageInfo.endCursor;
  }
  return count;
}

/**
 * @dev This function is too computationally expensive to actually use if they have any sembalance of previous traffic,
 * we will run into 429 rate limit errors.
 * @returns A list of addresses that have sent or received tokens from the deployer address
 */
async function getRelatedAccounts(deployerAddress: string): Promise<string[]> {
  let hasNextPage = true;
  let cursor: string;
  let results: any[] = [];

  const initialQuery = `{
    transactionBlocks(
      filter: {
        affectedAddress: "${deployerAddress}"
      }
      first: 50
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        effects {
          balanceChanges {
            nodes {
              owner {
                address
              }
            }
          }
        }
      }
    }
  }`;

  const data = await executeGraphQLWithRetry(initialQuery, {});
  const addresses = data.data.transactionBlocks.nodes.map((node: any) =>
    node.effects.balanceChanges.nodes.map((node: any) => node.owner.address)
  );
  results = results.concat(addresses);
  hasNextPage = data.data.transactionBlocks.pageInfo.hasNextPage;
  cursor = data.data.transactionBlocks.pageInfo.endCursor;

  while (hasNextPage) {
    const paginatedQuery = `{
      transactionBlocks(
        filter: {
          affectedAddress: "${deployerAddress}"
        }
        first: 50
        after: "${cursor}"
      ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        effects {
          balanceChanges {
            nodes {
              owner {
                address
              }
            }
          }
        }
      }
    }
  }`;

    const data = await executeGraphQLWithRetry(paginatedQuery, {});
    const addresses = data.data.transactionBlocks.nodes.map((node: any) =>
      node.effects.balanceChanges.nodes.map((node: any) => node.owner.address)
    );
    results = results.concat(addresses);
    hasNextPage = data.data.transactionBlocks.pageInfo.hasNextPage;
    cursor = data.data.transactionBlocks.pageInfo.endCursor;
  }
  const uniqueRelatedAddresses = [
    ...new Set(results.filter((addr) => addr !== deployerAddress)),
  ];
  return uniqueRelatedAddresses;
}

async function getLastCallTime(functionId: string, deployerAddress: string) {
  const query = `{
    transactionBlocks(
      filter: {
        function: "${functionId}"
        sentAddress: "${deployerAddress}"
      }
      last: 1
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        effects {
          timestamp
        }
      }
    }
  }`;

  const data = await executeGraphQLWithRetry(query, {});
  const lastTransactionTimestamp =
    data?.data?.transactionBlocks?.nodes[0]?.effects?.timestamp;
  if (!lastTransactionTimestamp) {
    return new Date("2100-01-01");
  }
  return new Date(lastTransactionTimestamp);
}

export async function isSafe(address: string): Promise<boolean> {
  const create_token_functionId =
    "0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a::vaa::parse_and_verify";
  const [tokenDeployCount, accountAge, lastTokenTxTime] = await Promise.all([
    getFunctionCallCount(create_token_functionId, address),
    getFirstTransaction(address),
    getLastCallTime(create_token_functionId, address),
  ]);
  const sus =
    accountAge < new Date("2024-10-31") &&
    lastTokenTxTime < new Date("2024-10-31");
  return !sus && tokenDeployCount < 5;
}

async function main(deployerAddress: string) {
  const create_token_functionId =
    "0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a::vaa::parse_and_verify";
  const tokenDeployCount = await getFunctionCallCount(
    create_token_functionId,
    deployerAddress
  );
  const accountAge = await getFirstTransaction(deployerAddress);
  const lastTokenTxTime = await getLastCallTime(
    create_token_functionId,
    deployerAddress
  );
  const sus =
    accountAge < new Date("2024-10-31") &&
    lastTokenTxTime < new Date("2024-10-31");
  return {
    tokenDeployCount,
    sus,
    lastTokenTxTime,
  };
}

// Add retry logic for GraphQL requests
export async function executeGraphQLWithRetry(query: string, variables: any, maxRetries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await proxyAxios.post(
                'https://sui-mainnet.mystenlabs.com/graphql',
                {
                    query,
                    variables,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000, // 10 second timeout
                }
            );
            return response.data;
        } catch (error: any) {
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.log(`GraphQL request failed (attempt ${attempt}/${maxRetries}):`, error.message);
                if (attempt === maxRetries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
}

export default main;
